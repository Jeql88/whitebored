"use strict";

// Coverage report (D16) — reports which document topics the board does and doesn't
// cover, built in TWO steps so the "N topics" count stays trustworthy:
//
//   const coverage = createCoverage({ gemini, retrieve, documents, userId });
//
//   // (1) At document upload/embed time: extract a STABLE topic list ONCE and store
//   //     it with the document. This fixes the denominator so it never wobbles.
//   const { docId, topics } = await coverage.extractTopics(docId);
//
//   // (2) At report time: judge each topic's board coverage SEMANTICALLY (embeddings
//   //     via retrieve, cosine over board content vs. a threshold). Gaps cite the
//   //     topic's page range. Topic identity stays stable across re-runs (reconcile).
//   const { report } = await coverage.report({ boardId, topics, scope, prior });
//
// A TOPIC (extracted once, stored with the document):
//   { label: string, pageStart: number, pageEnd: number }
//
// A COVERAGE-JUDGED TOPIC (what report returns, one per input topic):
//   { id, label, pageStart, pageEnd, status }
//   status ::= "covered" | "gap"
// A gap carries its page range so the UI can deep-link the user to what they missed.
//
// THE COUNT IS THE PROMISE (story 31). The topic list is extracted ONCE at upload and
// re-used for every report, so `total` never wobbles across regenerations. Within a
// report we ALSO reconcile the freshly-judged topics against the prior report through
// the SHARED regeneration primitive (server/regeneration), keyed on a topic
// fingerprint (the label), so each topic keeps its stable id/identity across re-runs.
// This is the same "protect what's yours across regeneration" mechanic notes, cards,
// and fact-check dismissals use — built once, reused here.
//
// GUARD EXACTLY LIKE FACT-CHECK (story 25/32). No document → no report and no model
// call: extractTopics of a text-less / unknown document returns [] without a model
// call, and report over an empty topic list does no retrieval. Gaps are SURFACED as
// data only — the report never mutates the notes (story 32). The tool stays a revision
// aid, not a crutch.
//
// SEMANTIC, NOT KEYWORD (story 30). Coverage is judged by the D14 embeddings, not
// brittle keyword equality: retrieve(topic.label, scope) embeds the topic once and
// ranks the board's own chunks by cosine; the board covers the topic only when its
// nearest chunk clears a similarity threshold. A weak nearest hit is still a gap.
//
// All model access is through the central Gemini module (D2/D23); this module never
// touches the SDK, and a deferred ("working") result is awaited so a throttled call
// still yields topics (story 56). Gemini + retrieve are stubbed in tests — no network.

const { reconcile } = require("../regeneration");

// Cosine similarity above which a topic is judged COVERED by the board. Retrieval
// returns cosine scores in [-1, 1]; a moderately-high floor keeps "covered" honest —
// the board must have content genuinely near the topic, not merely some tenuous
// overlap. Tuned at this one seam (surfaced in the return so callers/tests reason
// about it) rather than scattered through the code.
const DEFAULT_COVERAGE_THRESHOLD = 0.7;

// Grounding fence for the topic-extraction prompt. Server-side grounding, never
// asserted in tests (tests assert on the RESULT). The topic list is the stable
// denominator, so the model is told to produce a compact, non-overlapping set with a
// page range for each — the citation the gap will carry.
const TOPIC_EXTRACT_FENCE =
  "You are indexing a source document into the distinct TOPICS it teaches, so a " +
  "student can later see which topics their own notes cover and which they missed. " +
  "Extract a compact, non-overlapping list of the document's main topics in reading " +
  "order. Return ONLY JSON: an array of topics, each " +
  '{ "label": string (a short topic name), ' +
  '"pageStart": number (1-based first page the topic appears on), ' +
  '"pageEnd": number (1-based last page) }. ' +
  "Prefer a handful of substantial topics over many trivial ones; every topic MUST " +
  "carry a page range drawn from the document.";

// The fingerprint that identifies a topic across re-runs: its label, normalized
// (trimmed + lowercased). Two reports naming the same topic are "the same topic" even
// if the page range shifts (a re-paginated document) — so a topic keeps its identity,
// and the count stays stable, across regeneration. Exposed for the reconcile call and
// for tests to reason about matching identically (mirrors discrepancyFingerprint).
function topicFingerprint(topic) {
  return String(topic && topic.label ? topic.label : "")
    .trim()
    .toLowerCase();
}

// A stable id for a FRESH topic (one with no prior match), derived from its
// fingerprint so it is stable across re-runs AND never collides with a carried prior's
// id (a prior that vanished frees its id, but a new topic must not reuse it). Topics
// are matched across re-runs by fingerprint, not id, so the id is only for React
// keys / bookkeeping; a carried-forward topic keeps its PRIOR id via reconcile.
function topicId(topic) {
  return `topic-${topicFingerprint(topic).replace(/[^a-z0-9]+/g, "-")}`;
}

// Flatten a document's normalized pages (D13: [{ page, text }]) into the text the
// topic-extraction pass reads, tagged with page numbers so the model can attribute a
// page range. Pages with no text contribute nothing.
function documentText(pages) {
  return pages
    .filter((p) => p && typeof p.text === "string" && p.text.trim())
    .map((p) => `[p.${p.page}] ${p.text}`)
    .join("\n\n");
}

// Parse the model's JSON into a raw topic array. A malformed reply must not crash the
// pass — it yields no topics (degrade gracefully on the foreseen). Accepts a bare
// array or an object wrapping `topics`. Mirrors fact-check's parseDiscrepancies.
const { listSchema, parseList } = require("../gemini/jsonList");

// An unreadable reply throws rather than yielding [] — "no topics found" and "the
// reply was unreadable" are different answers and must not look identical.
function parseTopics(text) {
  return parseList(text, { key: "topics" });
}

// Normalize a raw model topic into a stored topic. A topic missing a label or a valid
// page range is dropped (null): a half-formed topic can't anchor the denominator or a
// gap citation. Page numbers are coerced; pageEnd degrades to pageStart when absent.
function normalizeTopic(raw) {
  if (!raw || typeof raw.label !== "string" || !raw.label.trim()) return null;
  const pageStart = Number(raw.pageStart);
  if (!Number.isFinite(pageStart)) return null;
  const pageEndRaw = Number(raw.pageEnd);
  const pageEnd = Number.isFinite(pageEndRaw) ? pageEndRaw : pageStart;
  return {
    label: raw.label.trim(),
    pageStart,
    pageEnd: Math.max(pageStart, pageEnd),
  };
}

// Pull JSON text out of a central-module result. { status:"ok", response } now, or
// { status:"deferred", done } when throttled — await the working state so topics still
// come back on a busy moment (story 56). Mirrors fact-check's / notes' textOf.
async function textOf(result) {
  const settled = result.status === "deferred" ? await result.done : result;
  const response = settled.response;
  return typeof response === "string" ? response : response?.text ?? "";
}

function buildTopicRequest(userId, pages) {
  return {
    userId,
    contents: [
      {
        role: "user",
        parts: [
          { text: TOPIC_EXTRACT_FENCE },
          { text: `DOCUMENT:\n${documentText(pages)}` },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: listSchema({ topic: { type: "string" } }, ["topic"]),
    },
  };
}

// Reconcile freshly-judged topics against the prior report so each topic keeps its
// stable identity (id) across a re-run (story 31), while the fresh coverage STATUS
// wins. Matches on the topic fingerprint (label) through the shared primitive.
//
// Topics don't trace to board shapes the way notes do — a topic's identity is purely
// its label — so, exactly as fact-check does for flags, we tag each topic with a
// synthetic "shape" derived from its fingerprint that is always on-board, making the
// fingerprint the sole matcher (reconcile only retires a prior on shape deletion,
// which never applies to a topic). Exposed so callers/tests can reconcile a persisted
// prior against a fresh report without re-judging.
function reconcileTopics(prior, next) {
  const tag = (t) => ({ ...t, sourceElementIds: [fingerTag(t)] });
  const boardElementIds = next.concat(prior).map(fingerTag);

  const { items } = reconcile({
    prior: prior.map(tag),
    next: next.map(tag),
    boardElementIds,
    fingerprint: topicFingerprint,
  });

  return items.map((entry) => {
    const { sourceElementIds, ...body } = entry.next;
    // A matched prior lends its stable id; a genuinely new topic gets a fresh
    // fingerprint-derived id (never a vanished prior's positional id).
    const priorId =
      entry.status === "unchanged" && entry.prior ? entry.prior.id : null;
    return { id: priorId || topicId(body), ...body };
  });
}

// A per-topic synthetic "shape id" derived from its fingerprint, so reconcile (which
// only carries a prior forward when its shapes still exist) always sees a topic's
// single shape as present. Keeps topic matching purely fingerprint(label)-based.
function fingerTag(topic) {
  return `fp:${topicFingerprint(topic)}`;
}

// Judge one topic's board coverage semantically. retrieve() embeds the topic label
// once and ranks the board's own chunks by cosine; the topic is COVERED only when the
// nearest chunk's score clears the threshold. No board content near it → a GAP that
// carries the topic's page range for the UI to deep-link. This is the D14 embeddings
// path, not keyword equality — a re-worded board still matches its topic, and a merely
// tangential hit is still a gap.
// Judge one topic from the hits already retrieved for it.
function judgeFromHits(topic, hits, threshold) {
  const best =
    Array.isArray(hits) && hits.length > 0
      ? hits.reduce((m, h) => (h && h.score > m ? h.score : m), -Infinity)
      : -Infinity;
  const covered = Number.isFinite(best) && best >= threshold;
  return {
    label: topic.label,
    pageStart: topic.pageStart,
    pageEnd: topic.pageEnd,
    status: covered ? "covered" : "gap",
  };
}

// Retrieve for every topic at once where the retriever supports it (ONE embedding
// call for the whole pass instead of one per topic), and fall back to independent
// retrievals otherwise. The fallback is kept because `retrieve` is an injected
// seam: tests and other callers may supply a plain one-query function.
async function hitsForTopics(retrieve, retrieveMany, topics, scope) {
  const labels = topics.map((t) => t.label);
  if (typeof retrieveMany === "function") return retrieveMany(labels, scope);
  return Promise.all(labels.map((label) => retrieve(label, scope)));
}

function createCoverage({
  gemini,
  retrieve,
  // Optional batched retrieval: judging N topics costs ONE embedding call instead
  // of N. Absent, the pass still works via `retrieve`.
  retrieveMany,
  documents,
  userId: defaultUserId,
  threshold = DEFAULT_COVERAGE_THRESHOLD,
} = {}) {
  if (!gemini || typeof gemini.generate !== "function") {
    throw new Error("createCoverage: a central Gemini module is required");
  }
  if (typeof retrieve !== "function") {
    throw new Error("createCoverage: a retrieve(query, scope) function is required");
  }
  if (!documents || typeof documents.get !== "function") {
    throw new Error("createCoverage: a document source with get(docId) is required");
  }

  // STEP 1 — extract the stable topic list from a document's text, ONCE, at upload.
  // Guarded exactly like fact-check: an unknown or text-less document yields no
  // topics and makes NO model call (story 25). The returned list is what the caller
  // stores with the document; it is the fixed "N topics" denominator (story 31).
  async function extractTopics(docId, { userId = defaultUserId } = {}) {
    const doc = await documents.get(docId);
    // Unknown document → nothing to extract. No model call.
    if (!doc) return { docId, topics: [] };

    const pages = Array.isArray(doc.pages) ? doc.pages : [];
    const text = documentText(pages);
    // No text layer (e.g. an image with no OCR) → nothing to extract. No model call
    // (mirrors indexDocument's empty-chunk short-circuit and fact-check's guard).
    if (!text.trim()) return { docId, topics: [] };

    const result = await gemini.generate(buildTopicRequest(userId, pages));
    const raw = parseTopics(await textOf(result));

    const topics = [];
    for (const rawTopic of raw) {
      const topic = normalizeTopic(rawTopic);
      if (topic) topics.push(topic);
    }
    return { docId, topics };
  }

  // STEP 2 — judge each topic's board coverage semantically and reconcile against the
  // prior report for stable identity. No topics (no document attached) → an empty
  // report and NO retrieval (story 25/32). Gaps are returned as DATA — this never
  // mutates the notes (story 32).
  async function report({
    boardId,
    topics = [],
    scope,
    prior = [],
    userId = defaultUserId,
    // notes may be passed for context/parity with the other passes; we deliberately
    // do NOT read or mutate it — gaps are surfaced, never auto-added (story 32).
    notes, // eslint-disable-line no-unused-vars
  } = {}) {
    const list = Array.isArray(topics) ? topics : [];
    if (list.length === 0) {
      return { report: { boardId, topics: [], total: 0, coveredCount: 0, gapCount: 0 } };
    }

    // Judge every topic against the board. This used to be a sequential loop of
    // retrieve() calls — one embedding request PER TOPIC — so a 20-topic document
    // cost 20 model calls and could exhaust a whole day's free-tier quota in a
    // single click. The retrievals are independent and share one chunk set, so they
    // run together instead; a batching retriever collapses them into one request,
    // and a plain one is at least no longer serialized.
    const hits = await hitsForTopics(
      retrieve,
      retrieveMany,
      list,
      scope || { boardId, userId }
    );
    const judged = list.map((topic, i) => judgeFromHits(topic, hits[i], threshold));

    // Reconcile against the prior report so each topic keeps its stable id across the
    // re-run (story 31); the freshly-judged status wins.
    const reconciled = reconcileTopics(prior, judged);

    const coveredCount = reconciled.filter((t) => t.status === "covered").length;
    const gapCount = reconciled.length - coveredCount;
    return {
      report: {
        boardId,
        topics: reconciled,
        total: reconciled.length,
        coveredCount,
        gapCount,
      },
    };
  }

  return { extractTopics, report };
}

// Production wiring: build a coverage module from a central Gemini module, a
// retriever, and the document store. Returns null when any is unavailable so the
// feature degrades gracefully (mirrors createFactCheckerFromDeps) rather than crashing
// the server at boot.
function createCoverageFromDeps({ gemini, retriever, documents } = {}) {
  if (!gemini || !retriever || typeof retriever.retrieve !== "function") return null;
  if (!documents || typeof documents.get !== "function") return null;
  // Pass the batched retrieval when the retriever offers it, so a coverage pass
  // costs one embedding call rather than one per topic.
  return createCoverage({
    gemini,
    retrieve: retriever.retrieve,
    retrieveMany: retriever.retrieveMany,
    documents,
  });
}

module.exports = {
  createCoverage,
  createCoverageFromDeps,
  topicFingerprint,
  reconcileTopics,
  TOPIC_EXTRACT_FENCE,
  DEFAULT_COVERAGE_THRESHOLD,
};
