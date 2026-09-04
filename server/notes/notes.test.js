"use strict";

// Behaviour tests for the Notes artifact (Phase 2, D6/D8/D9). The Gemini call is
// stubbed through the slice-#1 harness — NO network, NO real model. We assert only
// on external behaviour: the D6 record/line shape, that local verification drops
// un-traceable lines (the required D9 test), that note type selects the prompt
// template only, that lines stream through the seam, and that the record persists
// one-per-board and drives the socket streaming seam.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  createNotesGenerator,
  NOTE_KINDS,
  NOTE_TYPES,
} = require("./index");
const { verifyLine, transcriptionText } = require("./verify");
const { createNotesStore } = require("./store");
const { registerNotesHandlers } = require("./socketNotes");
const { createGemini } = require("../gemini");
const { createGeminiStub, createFakeClock } = require("../gemini/testHarness");

// A Gemini response as the module expects from the injected client: an SDK-shaped
// object whose `.text` is the JSON the model produced (an array of note lines).
function modelResponse(lines) {
  return { text: JSON.stringify(lines) };
}

// A corrected phase-1 transcription artifact (what TranscriptionReview confirms and
// Phase 2 consumes). Only the segment text matters for verification.
function transcription(...texts) {
  return {
    phase: "transcription",
    hasUnclear: false,
    entries: texts.map((text, i) => ({
      cropId: `c${i}`,
      segments: [{ text, uncertain: false }],
      sourceElementIds: [`f${i}`],
      bbox: { x: 0, y: 0, width: 10, height: 10 },
    })),
  };
}

function makeGenerator(stub, opts = {}) {
  const gemini = createGemini({ client: stub, clock: createFakeClock(), ...opts });
  return createNotesGenerator({ gemini, userId: "u1" });
}

// --- verify.js (the pure D9 gate) -----------------------------------------------

test("verifyLine keeps a line whose key terms all appear in the transcription", () => {
  const text = transcriptionText(transcription("Approval step comes first"));
  assert.equal(verifyLine({ text: "Approval is the first step" }, text), true);
});

test("verifyLine drops a line with a term the transcription never contains", () => {
  const text = transcriptionText(transcription("Approval step comes first"));
  // "mitosis" is nowhere in the board — an invented term → dropped.
  assert.equal(verifyLine({ text: "Approval then mitosis" }, text), false);
});

test("verifyLine ignores casing and punctuation when matching terms", () => {
  const text = transcriptionText(transcription("Budget review, Q3."));
  assert.equal(verifyLine({ text: "BUDGET review — q3" }, text), true);
});

test("verifyLine drops a line that has no key terms (only stopwords)", () => {
  const text = transcriptionText(transcription("Approval step"));
  assert.equal(verifyLine({ text: "and the of to" }, text), false);
});

test("transcriptionText excludes unfilled [unclear] gaps from the haystack", () => {
  const artifact = {
    entries: [
      {
        segments: [
          { text: "budget", uncertain: false },
          { text: "[unclear]", uncertain: true },
        ],
      },
    ],
  };
  const text = transcriptionText(artifact);
  // A note can verify against "budget" but never against the unresolved gap.
  assert.equal(verifyLine({ text: "budget" }, text), true);
  assert.equal(verifyLine({ text: "unclear" }, text), false);
});

// --- generator: shape, types, streaming, verification ---------------------------

test("generate returns the D6 record: lines carry text, kind, sourceElementIds, origin", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "Approval flow", kind: "heading", sourceElementIds: ["f0"] },
    ])
  );
  const gen = makeGenerator(stub);

  const record = await gen.generate({
    transcription: transcription("Approval flow overview"),
    noteType: "lecture",
    boardId: "b1",
  });

  assert.equal(record.boardId, "b1");
  assert.equal(record.noteType, "lecture");
  assert.equal(record.lines.length, 1);
  const line = record.lines[0];
  assert.equal(line.text, "Approval flow");
  assert.equal(line.kind, "heading");
  assert.deepEqual(line.sourceElementIds, ["f0"]);
  assert.equal(line.origin, "board");
});

test("verification drops un-traceable lines with the model stubbed (D9 — the required test)", async () => {
  const stub = createGeminiStub();
  // The model returns three lines; only two trace to the board. The third invents
  // "photosynthesis", a term the transcription never contains.
  stub.enqueue(
    modelResponse([
      { text: "Approval comes first", kind: "key-point", sourceElementIds: ["f0"] },
      { text: "Then review", kind: "key-point", sourceElementIds: ["f1"] },
      { text: "Finally photosynthesis", kind: "key-point", sourceElementIds: ["f2"] },
    ])
  );
  const gen = makeGenerator(stub);

  const record = await gen.generate({
    transcription: transcription("Approval comes first", "then review"),
    boardId: "b1",
  });

  const texts = record.lines.map((l) => l.text);
  assert.deepEqual(texts, ["Approval comes first", "Then review"]);
  assert.ok(
    !texts.some((t) => /photosynthesis/i.test(t)),
    "the invented line is dropped, never persisted"
  );
});

test("a dropped line is never streamed (nothing flickers or retracts, story 15)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "traceable point", kind: "key-point", sourceElementIds: ["f0"] },
      { text: "invented xyzzy point", kind: "key-point", sourceElementIds: ["f1"] },
    ])
  );
  const gen = makeGenerator(stub);

  const streamed = [];
  await gen.generate({
    transcription: transcription("a traceable point on the board"),
    boardId: "b1",
    onLine: (line) => streamed.push(line.text),
  });

  // The un-traceable line never reaches the stream — it is dropped before onLine.
  assert.deepEqual(streamed, ["traceable point"]);
});

test("note type selects the prompt template only; all types feed the same line shape (D8)", async () => {
  // Same transcription + same model lines under two different types → identical
  // line shape, differing only in the recorded noteType. The request the module
  // built for each type differs (the template), which is what "type changes the
  // prompt only" means; we assert the observable record, not the prompt string.
  const source = transcription("Step one then step two");
  const lines = [
    { text: "Step one", kind: "sequence-step", sourceElementIds: ["f0"] },
    { text: "Step two", kind: "sequence-step", sourceElementIds: ["f1"] },
  ];

  const stubA = createGeminiStub();
  stubA.enqueue(modelResponse(lines));
  const process = await makeGenerator(stubA).generate({
    transcription: source,
    noteType: "process",
    boardId: "b1",
  });

  const stubB = createGeminiStub();
  stubB.enqueue(modelResponse(lines));
  const freeform = await makeGenerator(stubB).generate({
    transcription: source,
    noteType: "freeform",
    boardId: "b1",
  });

  assert.equal(process.noteType, "process");
  assert.equal(freeform.noteType, "freeform");
  // Same shape out of both types.
  assert.deepEqual(
    process.lines.map((l) => ({ text: l.text, kind: l.kind })),
    freeform.lines.map((l) => ({ text: l.text, kind: l.kind }))
  );
  // The prompt sent to the model actually differed per type (template selection).
  assert.notEqual(
    JSON.stringify(stubA.calls[0].contents),
    JSON.stringify(stubB.calls[0].contents)
  );
});

test("all four note types are known prompt templates", () => {
  for (const type of ["lecture", "meeting", "process", "freeform"]) {
    assert.ok(NOTE_TYPES[type], `${type} has a template`);
  }
});

test("an unknown kind degrades to key-point rather than dropping the line", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "budget item", kind: "nonsense", sourceElementIds: ["f0"] },
    ])
  );
  const gen = makeGenerator(stub);

  const record = await gen.generate({
    transcription: transcription("budget item review"),
    boardId: "b1",
  });

  assert.equal(record.lines[0].kind, "key-point");
  assert.ok(NOTE_KINDS.includes(record.lines[0].kind));
});

test("a malformed model reply yields an empty notes record, not a crash", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: "this is not json" });
  const gen = makeGenerator(stub);

  const record = await gen.generate({
    transcription: transcription("anything"),
    boardId: "b1",
  });

  assert.deepEqual(record.lines, []);
});

test("a throttled (deferred) generation still resolves to a record (story 56)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelResponse([{ text: "first note", sourceElementIds: ["f0"] }]));
  stub.enqueue(modelResponse([{ text: "queued note", sourceElementIds: ["f0"] }]));

  const clock = createFakeClock();
  const gemini = createGemini({
    client: stub,
    clock,
    perUser: { windowMs: 1000, max: 1 },
  });
  const gen = createNotesGenerator({ gemini, userId: "u1" });

  const first = await gen.generate({
    transcription: transcription("first note here"),
    boardId: "b1",
  });
  assert.equal(first.lines[0].text, "first note");

  const pending = gen.generate({
    transcription: transcription("queued note here"),
    boardId: "b1",
  });
  await clock.tick(1000);
  const second = await pending;
  assert.equal(second.lines[0].text, "queued note");
});

test("constructing a generator without a Gemini module fails loud", () => {
  assert.throws(() => createNotesGenerator({}), /gemini/i);
});

// --- store: one record per board -------------------------------------------------

// In-memory fake faithful to a Mongo collection's upsert-by-filter + findOne. One
// stored doc per boardId is the invariant the store depends on (story 8).
function fakeCollection() {
  const docs = new Map(); // boardId -> doc
  return {
    docs,
    async updateOne(filter, update, opts = {}) {
      const key = filter.boardId;
      const existing = docs.get(key);
      if (!existing && !opts.upsert) return { matchedCount: 0 };
      docs.set(key, { ...(existing || {}), ...update.$set });
      return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 };
    },
    async findOne(filter) {
      return docs.get(filter.boardId) || null;
    },
  };
}

test("store persists ONE record per board (upsert overwrites, never duplicates)", async () => {
  const collection = fakeCollection();
  const store = createNotesStore({ collection });

  await store.save({ boardId: "b1", noteType: "lecture", lines: [{ text: "a" }] });
  await store.save({ boardId: "b1", noteType: "process", lines: [{ text: "b" }] });

  assert.equal(collection.docs.size, 1, "still one record for the board");
  const loaded = await store.load("b1");
  assert.equal(loaded.noteType, "process");
  assert.equal(loaded.lines[0].text, "b");
  assert.ok(loaded.updatedAt instanceof Date);
});

test("store.load returns null for a board with no notes yet", async () => {
  const store = createNotesStore({ collection: fakeCollection() });
  assert.equal(await store.load("nope"), null);
});

// --- socket streaming seam -------------------------------------------------------

// A fake socket faithful to the Socket.IO surface these handlers touch: on()
// registers a handler, emit() records an outgoing event, and fire() lets the test
// deliver an incoming event (what a real client would send).
function fakeSocket(user = { userId: "u1" }) {
  const handlers = new Map();
  const emitted = [];
  return {
    user,
    emitted,
    on(event, fn) {
      handlers.set(event, fn);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    async fire(event, payload) {
      const fn = handlers.get(event);
      if (fn) await fn(payload);
    },
  };
}

test("socket seam streams a notesLine per verified line, then notesDone with the persisted record", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "one point", kind: "key-point", sourceElementIds: ["f0"] },
      { text: "invented qqq point", kind: "key-point", sourceElementIds: ["f1"] },
      { text: "two point", kind: "key-point", sourceElementIds: ["f2"] },
    ])
  );
  const generator = makeGenerator(stub);
  const collection = fakeCollection();
  const store = createNotesStore({ collection });

  const socket = fakeSocket();
  registerNotesHandlers(socket, { generator, store });

  await socket.fire("generateNotes", {
    boardId: "b1",
    transcription: transcription("one point and two point on the board"),
    noteType: "lecture",
  });

  const lineEvents = socket.emitted.filter((e) => e.event === "notesLine");
  assert.deepEqual(
    lineEvents.map((e) => e.payload.line.text),
    ["one point", "two point"],
    "only verified lines stream; the invented one never emits"
  );

  const done = socket.emitted.find((e) => e.event === "notesDone");
  assert.ok(done, "notesDone fires when generation completes");
  assert.equal(done.payload.record.lines.length, 2);

  // Persisted one-per-board, retrievable after done.
  const loaded = await store.load("b1");
  assert.equal(loaded.lines.length, 2);
});

test("socket seam denies generation for a board the user can't access", async () => {
  const stub = createGeminiStub();
  // No response enqueued: generation must never run, so the stub is never called.
  const generator = makeGenerator(stub);

  const socket = fakeSocket();
  registerNotesHandlers(socket, {
    generator,
    canAccess: async () => false,
  });

  await socket.fire("generateNotes", {
    boardId: "b1",
    transcription: transcription("secret board"),
  });

  assert.equal(stub.calls.length, 0, "generator never runs without access");
  const err = socket.emitted.find((e) => e.event === "notesError");
  assert.ok(err, "an access failure is surfaced, not silent");
  assert.equal(err.payload.error, "forbidden");
});

test("socket seam surfaces a generation failure as notesError (fail loud)", async () => {
  const stub = createGeminiStub();
  stub.enqueueError(new Error("model exploded"));
  const generator = makeGenerator(stub);

  const socket = fakeSocket();
  registerNotesHandlers(socket, { generator });

  await socket.fire("generateNotes", {
    boardId: "b1",
    transcription: transcription("anything"),
  });

  const err = socket.emitted.find((e) => e.event === "notesError");
  assert.ok(err, "the failure reaches the client");
  assert.equal(err.payload.error, "generation_failed");
});

test("socket seam ignores a generateNotes with no boardId", async () => {
  const stub = createGeminiStub();
  const generator = makeGenerator(stub);
  const socket = fakeSocket();
  registerNotesHandlers(socket, { generator });

  await socket.fire("generateNotes", { transcription: transcription("x") });

  assert.equal(stub.calls.length, 0);
  assert.equal(socket.emitted.length, 0);
});
