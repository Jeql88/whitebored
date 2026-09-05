"use strict";

// Coverage report (D16) — behaviour tests through the public interface. The Gemini
// client is stubbed via the shared harness; retrieve is faked/injected; no DB, no
// network. Tests assert on the RESULT (the topic list + coverage statuses), never on
// prompt strings or call counts.
//
// Coverage is TWO steps:
//   1. extractTopics(docId) — one model pass at upload → a STABLE topic list
//      (label + page range) stored with the document. This fixes the "N topics"
//      denominator (story 31).
//   2. report({ boardId, topics, scope, prior }) — judges each topic's board
//      coverage SEMANTICALLY via the retrieval embeddings (cosine over board
//      content, threshold). Gaps cite the topic's page range (story 30). The topic
//      list stays stable across re-runs via a topic fingerprint through reconcile.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createGemini } = require("../gemini");
const { createGeminiStub } = require("../gemini/testHarness");
const {
  createCoverage,
  topicFingerprint,
  reconcileTopics,
  TOPIC_EXTRACT_FENCE,
} = require("./index");

// A document record as the document store's get(docId) returns it (D13): a page
// list of { page, text }.
function doc(over = {}) {
  return {
    _id: "docObjId",
    boardId: "b1",
    kind: "pdf",
    pages: [
      { page: 1, text: "Cell structure: membrane, cytoplasm, nucleus." },
      { page: 2, text: "Mitochondria produce ATP via cellular respiration." },
      { page: 3, text: "Photosynthesis converts light to chemical energy." },
    ],
    ...over,
  };
}

// A documents source faithful to the store seam: get(docId) -> record | null.
function fakeDocuments(record) {
  return { async get(id) { return record && String(record._id) === String(id) ? record : null; } };
}

// A retrieve() fake keyed by query text → hits. Faithful to the seam contract
// (retrieve(query, scope) -> [{docId, boardId, page, text, score}]). A query with
// no entry returns []. Used to simulate "the board has / hasn't content near this
// topic" semantically without any real embedding.
function fakeRetrieveByQuery(map, fallback = []) {
  return async (query) => {
    for (const key of Object.keys(map)) {
      if (query.toLowerCase().includes(key.toLowerCase())) return map[key];
    }
    return fallback;
  };
}

const TOPICS_REPLY = [
  { label: "Cell structure", pageStart: 1, pageEnd: 1 },
  { label: "Mitochondria and ATP", pageStart: 2, pageEnd: 2 },
  { label: "Photosynthesis", pageStart: 3, pageEnd: 3 },
];

function coverageWith({ topicsReply = TOPICS_REPLY, retrieve, documents } = {}) {
  const stub = createGeminiStub();
  if (topicsReply !== null) {
    stub.enqueue({ text: JSON.stringify({ topics: topicsReply }) });
  }
  const gemini = createGemini({ client: stub });
  return {
    stub,
    coverage: createCoverage({
      gemini,
      retrieve: retrieve || (async () => []),
      documents: documents || fakeDocuments(doc()),
      userId: "u1",
    }),
  };
}

// --- topic extraction (story 31) -------------------------------------------------

test("extractTopics returns a stable topic list of {label, pageStart, pageEnd} (story 31)", async () => {
  const { coverage } = coverageWith();
  const { docId, topics } = await coverage.extractTopics("docObjId");
  assert.equal(docId, "docObjId");
  assert.equal(topics.length, 3);
  const t = topics[0];
  assert.equal(t.label, "Cell structure");
  assert.equal(t.pageStart, 1);
  assert.equal(t.pageEnd, 1);
});

test("extractTopics runs NO model call and yields no topics for a document with no text (guard)", async () => {
  const stub = createGeminiStub();
  const gemini = createGemini({ client: stub });
  const coverage = createCoverage({
    gemini,
    retrieve: async () => [],
    documents: fakeDocuments(doc({ pages: [] })),
    userId: "u1",
  });
  const { topics } = await coverage.extractTopics("docObjId");
  assert.equal(topics.length, 0);
  assert.equal(stub.calls.length, 0, "no model call when there is no text to extract from");
});

test("extractTopics of an unknown document yields no topics, no model call", async () => {
  const stub = createGeminiStub();
  const gemini = createGemini({ client: stub });
  const coverage = createCoverage({
    gemini,
    retrieve: async () => [],
    documents: fakeDocuments(doc()),
    userId: "u1",
  });
  const { topics } = await coverage.extractTopics("nope");
  assert.equal(topics.length, 0);
  assert.equal(stub.calls.length, 0);
});

test("extractTopics drops a malformed topic (missing label or page range) rather than crashing", async () => {
  const { coverage } = coverageWith({
    topicsReply: [
      { label: "Good topic", pageStart: 1, pageEnd: 2 },
      { label: "", pageStart: 1, pageEnd: 1 }, // no label → dropped
      { pageStart: 1, pageEnd: 1 }, // no label → dropped
      { label: "No pages" }, // no page range → dropped
    ],
  });
  const { topics } = await coverage.extractTopics("docObjId");
  assert.equal(topics.length, 1);
  assert.equal(topics[0].label, "Good topic");
});

test("a malformed model reply yields no topics rather than crashing (degrade gracefully)", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: "not json" });
  const gemini = createGemini({ client: stub });
  const coverage = createCoverage({
    gemini,
    retrieve: async () => [],
    documents: fakeDocuments(doc()),
    userId: "u1",
  });
  const { topics } = await coverage.extractTopics("docObjId");
  assert.equal(topics.length, 0);
});

// --- semantic coverage at report time (story 30) ---------------------------------

test("report marks a topic COVERED when board content is semantically near it (story 30)", async () => {
  // The board has a chunk scoring above threshold for "Mitochondria" → covered.
  const retrieve = fakeRetrieveByQuery({
    Mitochondria: [{ docId: "d1", boardId: "b1", page: 2, text: "ATP energy", score: 0.86 }],
  });
  const { coverage } = coverageWith({ topicsReply: null, retrieve });
  const { report } = await coverage.report({
    boardId: "b1",
    topics: [{ label: "Mitochondria and ATP", pageStart: 2, pageEnd: 2 }],
  });
  assert.equal(report.topics.length, 1);
  assert.equal(report.topics[0].status, "covered");
});

test("report marks a topic a GAP when no board content is near it, citing its page range (story 30)", async () => {
  // No board chunk near "Photosynthesis" → gap; the gap cites the topic's pages.
  const { coverage } = coverageWith({ topicsReply: null, retrieve: async () => [] });
  const { report } = await coverage.report({
    boardId: "b1",
    topics: [{ label: "Photosynthesis", pageStart: 3, pageEnd: 3 }],
  });
  const topic = report.topics[0];
  assert.equal(topic.status, "gap");
  assert.equal(topic.pageStart, 3);
  assert.equal(topic.pageEnd, 3);
});

test("a below-threshold nearest hit is still a GAP (semantic, not mere presence)", async () => {
  // The board has SOME content but nothing close enough — a weak cosine is a gap,
  // not a spurious 'covered'. This is the semantic threshold, not keyword equality.
  const retrieve = fakeRetrieveByQuery({
    Photosynthesis: [{ docId: "d1", boardId: "b1", page: 9, text: "unrelated", score: 0.21 }],
  });
  const { coverage } = coverageWith({ topicsReply: null, retrieve });
  const { report } = await coverage.report({
    boardId: "b1",
    topics: [{ label: "Photosynthesis", pageStart: 3, pageEnd: 3 }],
  });
  assert.equal(report.topics[0].status, "gap");
});

test("report exposes a stable coveredCount / total so the denominator is trustworthy (story 31)", async () => {
  const retrieve = fakeRetrieveByQuery({
    Mitochondria: [{ docId: "d1", boardId: "b1", page: 2, text: "ATP", score: 0.9 }],
  });
  const { coverage } = coverageWith({ topicsReply: null, retrieve });
  const { report } = await coverage.report({
    boardId: "b1",
    topics: [
      { label: "Mitochondria and ATP", pageStart: 2, pageEnd: 2 }, // covered
      { label: "Photosynthesis", pageStart: 3, pageEnd: 3 }, // gap
    ],
  });
  assert.equal(report.total, 2);
  assert.equal(report.coveredCount, 1);
  assert.equal(report.gapCount, 1);
});

test("report runs no retrieval / no report when there are no topics (no document → nothing to cover)", async () => {
  let retrieveCalls = 0;
  const coverage = createCoverage({
    gemini: createGemini({ client: createGeminiStub() }),
    retrieve: async () => { retrieveCalls++; return []; },
    documents: fakeDocuments(doc()),
    userId: "u1",
  });
  const { report } = await coverage.report({ boardId: "b1", topics: [] });
  assert.equal(report.topics.length, 0);
  assert.equal(report.total, 0);
  assert.equal(retrieveCalls, 0, "no retrieval when there are no topics to judge");
});

test("report NEVER adds gaps to the notes — it returns them as data only (story 32)", async () => {
  // The notes record handed in is not mutated; the report is a separate structure.
  const notes = { boardId: "b1", lines: [{ text: "existing", sourceElementIds: ["x"] }] };
  const { coverage } = coverageWith({ topicsReply: null, retrieve: async () => [] });
  const before = JSON.stringify(notes);
  const { report } = await coverage.report({
    boardId: "b1",
    topics: [{ label: "Photosynthesis", pageStart: 3, pageEnd: 3 }],
    notes,
  });
  assert.equal(JSON.stringify(notes), before, "notes are never mutated by the report");
  assert.ok(Array.isArray(report.topics));
  // The report has no side-channel that writes gaps into notes.
  assert.equal(notes.lines.length, 1);
});

// --- stable topic identity across regeneration (story 31, via reconcile) ---------

test("the topic list stays STABLE across a re-run via fingerprint (story 31)", async () => {
  const topics = [
    { label: "Cell structure", pageStart: 1, pageEnd: 1 },
    { label: "Mitochondria and ATP", pageStart: 2, pageEnd: 2 },
  ];
  const retrieve = fakeRetrieveByQuery({
    Mitochondria: [{ docId: "d1", boardId: "b1", page: 2, text: "ATP", score: 0.9 }],
  });
  const { coverage } = coverageWith({ topicsReply: null, retrieve });

  const first = await coverage.report({ boardId: "b1", topics });
  // The board changes so "Cell structure" is now covered too, but the TOPIC SET must
  // be identical (same labels, same count) — the denominator does not wobble.
  const retrieve2 = fakeRetrieveByQuery({
    Mitochondria: [{ docId: "d1", boardId: "b1", page: 2, text: "ATP", score: 0.9 }],
    Cell: [{ docId: "d1", boardId: "b1", page: 1, text: "membrane nucleus", score: 0.88 }],
  });
  const { coverage: coverage2 } = coverageWith({ topicsReply: null, retrieve: retrieve2 });
  const second = await coverage2.report({ boardId: "b1", topics, prior: first.report.topics });

  assert.equal(second.report.total, first.report.total);
  assert.deepEqual(
    second.report.topics.map((t) => t.label).sort(),
    first.report.topics.map((t) => t.label).sort()
  );
  // Each topic keeps its stable id across the re-run.
  const firstIds = new Map(first.report.topics.map((t) => [t.label, t.id]));
  for (const t of second.report.topics) {
    assert.equal(t.id, firstIds.get(t.label), `topic ${t.label} keeps its id`);
  }
});

test("topicFingerprint keys on the label, not incidental page shifts", () => {
  const a = { label: "Mitochondria and ATP", pageStart: 2, pageEnd: 2 };
  const b = { label: "Mitochondria and ATP", pageStart: 4, pageEnd: 6 }; // re-paginated
  assert.equal(topicFingerprint(a), topicFingerprint(b));
  const c = { label: "Something else", pageStart: 2, pageEnd: 2 };
  assert.notEqual(topicFingerprint(a), topicFingerprint(c));
});

test("reconcileTopics carries a prior topic's identity forward for a matching label", () => {
  const prior = [{ id: "topic-0", label: "Cell structure", pageStart: 1, pageEnd: 1 }];
  const next = [{ label: "Cell structure", pageStart: 1, pageEnd: 1, status: "covered" }];
  const merged = reconcileTopics(prior, next);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "topic-0", "the stable id is carried forward");
  assert.equal(merged[0].status, "covered", "the fresh coverage status wins");
});

test("a genuinely new topic gets a fresh id; a vanished topic does not linger", () => {
  const prior = [{ id: "topic-0", label: "Old topic", pageStart: 1, pageEnd: 1 }];
  const next = [{ label: "Brand new topic", pageStart: 2, pageEnd: 2, status: "gap" }];
  const merged = reconcileTopics(prior, next);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "Brand new topic");
  assert.notEqual(merged[0].id, "topic-0");
});
