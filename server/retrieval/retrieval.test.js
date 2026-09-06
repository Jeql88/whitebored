"use strict";

// Behaviour tests for the retrieval seam (D14, slice #12). Every seam is faked — the
// Gemini client is the stub from the central module's test harness (no network, no
// real model), the chunk store and document source are in-memory fakes. We assert
// observable behaviour through the public interface: chunk+embed+store at upload, and
// cosine top-k scoped retrieval at query time.
//
// The cosine/top-k math is pure and is asserted DIRECTLY (D14 pure seam): given known
// vectors, ranking is exact, deterministic, and involves NO model call.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { cosineSimilarity, rankByCosine } = require("./cosine");
const { chunkPages, splitText } = require("./chunk");
const { createChunkStore, scopeFilter } = require("./store");
const { createRetriever, DEFAULT_TOP_K } = require("./index");
const { createGemini } = require("../gemini");
const { createGeminiStub, createFakeClock } = require("../gemini/testHarness");

// --- pure cosine / top-k (the deterministic seam, no model) -----------------------

test("cosineSimilarity: identical direction scores 1, orthogonal scores 0", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1); // magnitude-invariant
});

test("cosineSimilarity: opposite direction scores -1", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 1], [-1, -1]) - -1) < 1e-9);
});

test("cosineSimilarity: a zero vector scores 0, never NaN (degrade on the foreseen)", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test("cosineSimilarity: a dimension mismatch fails loud", () => {
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]), /dimension mismatch/);
});

test("rankByCosine: returns the top-k chunks nearest the query, best first", () => {
  const chunks = [
    { text: "far", embedding: [0, 1] },
    { text: "closest", embedding: [1, 0] },
    { text: "near", embedding: [0.9, 0.1] },
  ];
  const top2 = rankByCosine([1, 0], chunks, 2);
  assert.deepEqual(top2.map((c) => c.text), ["closest", "near"]);
  assert.ok(top2[0].score > top2[1].score);
});

test("rankByCosine: is deterministic and no model is involved (pure seam)", () => {
  const chunks = [
    { text: "a", embedding: [1, 0, 0] },
    { text: "b", embedding: [0, 1, 0] },
    { text: "c", embedding: [0, 0, 1] },
  ];
  const q = [0.6, 0.3, 0.1];
  const first = rankByCosine(q, chunks, 3).map((c) => c.text);
  const second = rankByCosine(q, chunks, 3).map((c) => c.text);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["a", "b", "c"]);
});

test("rankByCosine: skips chunks with no usable embedding rather than crashing", () => {
  const chunks = [
    { text: "ok", embedding: [1, 0] },
    { text: "broken", embedding: [] },
    { text: "missing" },
  ];
  const ranked = rankByCosine([1, 0], chunks, 5);
  assert.deepEqual(ranked.map((c) => c.text), ["ok"]);
});

test("rankByCosine: k<=0 returns nothing; k beyond size returns all", () => {
  const chunks = [{ text: "a", embedding: [1, 0] }, { text: "b", embedding: [0, 1] }];
  assert.deepEqual(rankByCosine([1, 0], chunks, 0), []);
  assert.equal(rankByCosine([1, 0], chunks, 99).length, 2);
});

// --- pure chunking ----------------------------------------------------------------

test("chunkPages: each chunk keeps its 1-based source page (citation model)", () => {
  const pages = [
    { page: 1, text: "First page sentence." },
    { page: 2, text: "Second page sentence." },
  ];
  const chunks = chunkPages(pages);
  assert.deepEqual(chunks.map((c) => c.page), [1, 2]);
  assert.ok(chunks[0].text.includes("First"));
});

test("chunkPages: a long page splits into several chunks that share its page number", () => {
  const long = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} here.`).join(" ");
  const chunks = chunkPages([{ page: 3, text: long }], { targetChars: 80 });
  assert.ok(chunks.length > 1, "long page should split");
  assert.ok(chunks.every((c) => c.page === 3));
  // Text is preserved verbatim across the split.
  assert.ok(chunks.map((c) => c.text).join(" ").includes("Sentence number 19"));
});

test("chunkPages: pages with no text layer (image/blank) contribute no chunks", () => {
  const chunks = chunkPages([{ page: 1, text: "" }, { page: 2, text: "   " }]);
  assert.deepEqual(chunks, []);
});

test("splitText: a boundary-free run longer than target is hard-split, nothing unbounded", () => {
  const spans = splitText("x".repeat(250), 100);
  assert.ok(spans.every((s) => s.length <= 100));
  assert.equal(spans.join(""), "x".repeat(250));
});

// --- chunk store scoping ----------------------------------------------------------

function fakeChunkCollection() {
  const docs = [];
  return {
    docs,
    async insertMany(records) {
      docs.push(...records);
      return { insertedCount: records.length };
    },
    find(query = {}) {
      const matches = docs.filter((d) => {
        if (query.boardId && query.boardId.$in) return query.boardId.$in.includes(d.boardId);
        if (query.boardId) return d.boardId === query.boardId;
        return true;
      });
      return { async toArray() { return matches; } };
    },
    async deleteMany(query) {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (docs[i].docId === query.docId) docs.splice(i, 1);
      }
      return { deletedCount: before - docs.length };
    },
  };
}

test("scopeFilter: board scope, space (boardIds) scope, and empty scope", () => {
  assert.deepEqual(scopeFilter({ boardId: "b1" }), { boardId: "b1" });
  assert.deepEqual(scopeFilter({ boardIds: ["b1", "b2"] }), { boardId: { $in: ["b1", "b2"] } });
  assert.equal(scopeFilter({}), null, "no scope narrows to nothing, never all boards");
});

test("chunk store: forScope returns only the board's chunks", async () => {
  const store = createChunkStore({ collection: fakeChunkCollection() });
  await store.putMany([
    { docId: "d1", boardId: "b1", page: 1, text: "a", embedding: [1, 0] },
    { docId: "d2", boardId: "b2", page: 1, text: "b", embedding: [0, 1] },
  ]);
  const b1 = await store.forScope({ boardId: "b1" });
  assert.equal(b1.length, 1);
  assert.equal(b1[0].boardId, "b1");
  assert.deepEqual(await store.forScope({}), [], "no scope → no chunks");
});

test("chunk store: forScope with boardIds spans a space's boards (future group-space)", async () => {
  const store = createChunkStore({ collection: fakeChunkCollection() });
  await store.putMany([
    { docId: "d1", boardId: "b1", page: 1, text: "a", embedding: [1, 0] },
    { docId: "d2", boardId: "b2", page: 1, text: "b", embedding: [0, 1] },
    { docId: "d3", boardId: "b3", page: 1, text: "c", embedding: [1, 1] },
  ]);
  const both = await store.forScope({ boardIds: ["b1", "b2"] });
  assert.deepEqual(both.map((c) => c.boardId).sort(), ["b1", "b2"]);
});

test("chunk store: rejects a chunk with no embedding (no silent index hole)", async () => {
  const store = createChunkStore({ collection: fakeChunkCollection() });
  await assert.rejects(
    () => store.putMany([{ docId: "d1", boardId: "b1", page: 1, text: "x" }]),
    /non-empty embedding/
  );
});

test("chunk store: removeDocument drops exactly that document's chunks", async () => {
  const store = createChunkStore({ collection: fakeChunkCollection() });
  await store.putMany([
    { docId: "d1", boardId: "b1", page: 1, text: "a", embedding: [1, 0] },
    { docId: "d1", boardId: "b1", page: 2, text: "b", embedding: [0, 1] },
    { docId: "d2", boardId: "b1", page: 1, text: "c", embedding: [1, 1] },
  ]);
  assert.equal(await store.removeDocument("d1"), 2);
  const left = await store.forScope({ boardId: "b1" });
  assert.deepEqual(left.map((c) => c.docId), ["d2"]);
});

// --- gemini embed seam (embeddings route through the central module) ---------------

test("gemini.embed rides the module's 429 backoff and returns the embeddings", async () => {
  const stub = createGeminiStub();
  stub.enqueueEmbedRateLimit(); // first embed attempt throttled
  stub.enqueueEmbeddings([[0.1, 0.2, 0.3]]); // retry succeeds

  const clock = createFakeClock();
  const gemini = createGemini({ client: stub, clock, backoff: { baseMs: 100, maxRetries: 3 } });

  const pending = gemini.embed({ userId: "u1", texts: ["hello"] });
  await clock.tick(500); // advance past the backoff so the retry fires
  const result = await pending;

  assert.deepEqual(result.embeddings, [[0.1, 0.2, 0.3]]);
  assert.equal(stub.embedCalls.length, 2);
});

test("gemini exposes embed() only when the client supports it (capability contract)", () => {
  const generateOnly = { async generate() { return {}; } };
  const gemini = createGemini({ client: generateOnly, clock: createFakeClock() });
  assert.equal(typeof gemini.embed, "undefined");
});

// --- the retriever: index at upload, cosine top-k at query -----------------------

// A tiny deterministic embedder standing in for the model: maps a text to a 3-dim
// vector by counting three marker terms. Similar texts land near each other, so
// cosine ranking is meaningful without a real model.
function markerEmbedder(text) {
  const t = text.toLowerCase();
  const count = (w) => (t.match(new RegExp(w, "g")) || []).length;
  return [count("photosynthesis"), count("mitochondria"), count("gravity")];
}

function fakeDocuments(map) {
  return { async get(docId) { return map[docId] || null; } };
}

function makeRetriever(docsMap) {
  const stub = createGeminiStub().embedWith(markerEmbedder);
  const gemini = createGemini({ client: stub, clock: createFakeClock() });
  const chunks = createChunkStore({ collection: fakeChunkCollection() });
  const documents = fakeDocuments(docsMap);
  return { retriever: createRetriever({ gemini, chunks, documents }), stub, chunks };
}

test("indexDocument chunks, embeds ONCE, and stores { docId, boardId, page, text, embedding }", async () => {
  const { retriever, stub, chunks } = makeRetriever({
    d1: {
      boardId: "b1",
      pages: [
        { page: 1, text: "Photosynthesis converts light. Photosynthesis needs chlorophyll." },
        { page: 2, text: "Mitochondria make energy." },
      ],
    },
  });

  const summary = await retriever.indexDocument("d1", { userId: "u1" });
  assert.equal(summary.docId, "d1");
  assert.equal(summary.boardId, "b1");
  assert.ok(summary.chunkCount >= 2);

  // Embedding happened at upload — the embed seam was called. Stored records carry
  // the full chunk shape including a page number and an embedding.
  assert.ok(stub.embedCalls.length >= 1);
  const stored = await chunks.forScope({ boardId: "b1" });
  assert.equal(stored.length, summary.chunkCount);
  for (const c of stored) {
    assert.equal(c.docId, "d1");
    assert.equal(c.boardId, "b1");
    assert.ok(typeof c.page === "number");
    assert.ok(Array.isArray(c.embedding) && c.embedding.length > 0);
  }
});

test("retrieve returns cosine top-k scoped to the board, best match first, with citations", async () => {
  const { retriever } = makeRetriever({
    d1: {
      boardId: "b1",
      pages: [
        { page: 1, text: "Photosynthesis converts sunlight into sugar in the leaf." },
        { page: 2, text: "Mitochondria are the powerhouse of the cell." },
        { page: 3, text: "Gravity pulls masses together across space." },
      ],
    },
  });
  await retriever.indexDocument("d1", { userId: "u1" });

  const hits = await retriever.retrieve("tell me about photosynthesis", { boardId: "b1", k: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].page, 1, "cites the page the best chunk came from");
  assert.equal(hits[0].docId, "d1");
  assert.ok(hits[0].text.toLowerCase().includes("photosynthesis"));
  assert.ok(typeof hits[0].score === "number");
  // The returned hit carries the citation + text + score, not the raw embedding.
  assert.equal(hits[0].embedding, undefined);
});

test("retrieve does NOT re-embed chunks at query time — only the query is embedded", async () => {
  const { retriever, stub } = makeRetriever({
    d1: {
      boardId: "b1",
      pages: [
        { page: 1, text: "Photosynthesis one." },
        { page: 2, text: "Mitochondria two." },
      ],
    },
  });
  await retriever.indexDocument("d1", { userId: "u1" });
  const afterIndex = stub.embedCalls.length;

  await retriever.retrieve("photosynthesis?", { boardId: "b1" });
  await retriever.retrieve("mitochondria?", { boardId: "b1" });

  // Each retrieve embeds exactly the query (one text), never the chunks again.
  assert.equal(stub.embedCalls.length, afterIndex + 2);
  const lastTwo = stub.embedCalls.slice(-2);
  assert.ok(lastTwo.every((call) => call.texts.length === 1), "only the query is embedded per call");
});

test("retrieve is scoped: a query on one board never returns another board's chunks", async () => {
  const { retriever } = makeRetriever({
    d1: { boardId: "b1", pages: [{ page: 1, text: "Photosynthesis on board one." }] },
    d2: { boardId: "b2", pages: [{ page: 1, text: "Photosynthesis on board two." }] },
  });
  await retriever.indexDocument("d1");
  await retriever.indexDocument("d2");

  const hits = await retriever.retrieve("photosynthesis", { boardId: "b1" });
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((h) => h.boardId === "b1"), "only board b1's chunks");
});

test("retrieve returns [] for an empty query or an empty scope (no model call needed)", async () => {
  const { retriever, stub } = makeRetriever({
    d1: { boardId: "b1", pages: [{ page: 1, text: "Photosynthesis." }] },
  });
  await retriever.indexDocument("d1");
  const embedsAfterIndex = stub.embedCalls.length;

  assert.deepEqual(await retriever.retrieve("", { boardId: "b1" }), []);
  assert.deepEqual(await retriever.retrieve("photosynthesis", {}), [], "no scope → nothing");
  // Neither degenerate path wasted an embed call.
  assert.equal(stub.embedCalls.length, embedsAfterIndex);
});

test("retrieve defaults to DEFAULT_TOP_K when no k is given", async () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({
    page: i + 1,
    text: `Photosynthesis paragraph ${i} about leaves and light.`,
  }));
  const { retriever } = makeRetriever({ d1: { boardId: "b1", pages } });
  await retriever.indexDocument("d1");

  const hits = await retriever.retrieve("photosynthesis", { boardId: "b1" });
  assert.equal(hits.length, DEFAULT_TOP_K);
});

test("indexDocument on a text-less document stores nothing (image has no text layer)", async () => {
  const { retriever, chunks } = makeRetriever({
    d1: { boardId: "b1", pages: [{ page: 1, text: "" }] },
  });
  const summary = await retriever.indexDocument("d1");
  assert.equal(summary.chunkCount, 0);
  assert.deepEqual(await chunks.forScope({ boardId: "b1" }), []);
});

test("indexDocument is idempotent — re-indexing replaces chunks, no duplicates", async () => {
  const { retriever, chunks } = makeRetriever({
    d1: { boardId: "b1", pages: [{ page: 1, text: "Photosynthesis." }] },
  });
  await retriever.indexDocument("d1");
  await retriever.indexDocument("d1");
  const stored = await chunks.forScope({ boardId: "b1" });
  assert.equal(stored.length, 1, "re-index does not duplicate a document's chunks");
});

test("createRetriever fails loud when a seam is missing", () => {
  const gemini = createGemini({
    client: createGeminiStub().embedWith(markerEmbedder),
    clock: createFakeClock(),
  });
  const chunks = createChunkStore({ collection: fakeChunkCollection() });
  const documents = fakeDocuments({});
  assert.throws(() => createRetriever({ chunks, documents }), /embed\(\) is required/);
  assert.throws(() => createRetriever({ gemini, documents }), /chunk store/);
  assert.throws(() => createRetriever({ gemini, chunks }), /document source/);
});

test("retrieveMany embeds every query in ONE call, and keeps results aligned", async () => {
  // Coverage judges each topic by retrieving for it. One embedding call per topic
  // meant a 20-topic document spent a whole day of a ~20-call-per-day free tier in
  // a single pass, so the batch is the unit that matters.
  const { retriever, stub } = makeRetriever({
    d1: {
      boardId: "b1",
      pages: [
        { page: 1, text: "photosynthesis photosynthesis converts light" },
        { page: 2, text: "mitochondria mitochondria make energy" },
      ],
    },
  });
  await retriever.indexDocument("d1", { userId: "u1" });

  const before = stub.embedCalls.length;
  const results = await retriever.retrieveMany(
    ["photosynthesis", "mitochondria"],
    { boardId: "b1", userId: "u1" }
  );

  assert.equal(stub.embedCalls.length - before, 1, "both queries ride one embed call");
  assert.equal(results.length, 2, "one result list per query, in order");
  // Each query finds its own page, so the batch did not blur the queries together.
  assert.equal(results[0][0].page, 1);
  assert.equal(results[1][0].page, 2);
});

test("retrieveMany holds a slot for a blank query instead of shifting results", async () => {
  // Callers zip results back to the queries they asked for, so a dropped slot would
  // silently misattribute every later topic's coverage.
  const { retriever } = makeRetriever({
    d1: { boardId: "b1", pages: [{ page: 1, text: "photosynthesis photosynthesis" }] },
  });
  await retriever.indexDocument("d1", { userId: "u1" });

  const results = await retriever.retrieveMany(
    ["photosynthesis", "", "photosynthesis"],
    { boardId: "b1", userId: "u1" }
  );
  assert.equal(results.length, 3);
  assert.deepEqual(results[1], [], "a blank query retrieves nothing but keeps its place");
  assert.ok(results[2].length > 0, "the query after a blank one is unaffected");
});

test("retrieve() still works and is the one-query case of retrieveMany", async () => {
  const { retriever } = makeRetriever({
    d1: { boardId: "b1", pages: [{ page: 1, text: "photosynthesis photosynthesis" }] },
  });
  await retriever.indexDocument("d1", { userId: "u1" });

  const hits = await retriever.retrieve("photosynthesis", { boardId: "b1", userId: "u1" });
  assert.ok(hits.length > 0);
  assert.equal(hits[0].page, 1);
});
