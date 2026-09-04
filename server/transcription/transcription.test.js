"use strict";

// Behaviour tests for the Phase-1 transcription seam (D3 phase 1, D4). The Gemini
// call is stubbed through the slice-#1 harness — NO network, NO real model. We
// assert only on the artifact transcribe() returns given crops and a scripted
// model response: the structured `{ text, uncertain }` segment shape, first-class
// [unclear] gaps preserved (never dropped or guessed), and that Phase 1 yields a
// transcription only — no notes.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTranscriber } = require("./index");
const { createGemini } = require("../gemini");
const { createGeminiStub, createFakeClock } = require("../gemini/testHarness");

// A Gemini response as the recognize seam expects from the injected client: the
// SDK response object exposes `.text`, a JSON string keyed by cropId.
function modelResponse(byCropId) {
  return { text: JSON.stringify(byCropId) };
}

function textCrop(cropId, text, ids) {
  return {
    cropId,
    kind: "text",
    text,
    sourceElementIds: ids,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
  };
}
function inkCrop(cropId, ids) {
  return {
    cropId,
    kind: "ink",
    image: "data:image/png;base64,AAAA",
    sourceElementIds: ids,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
  };
}

function makeTranscriber(stub, opts = {}) {
  const gemini = createGemini({ client: stub, clock: createFakeClock() });
  return createTranscriber({ gemini, userId: "u1", ...opts });
}

test("produces a structured transcription artifact: entries carry cropId, segments[{text,uncertain}], sourceElementIds, bbox", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelResponse({ c1: { segments: [{ text: "hello", uncertain: false }] } }));
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([inkCrop("c1", ["f1"])]);

  assert.equal(artifact.entries.length, 1);
  const e = artifact.entries[0];
  assert.equal(e.cropId, "c1");
  assert.deepEqual(e.segments, [{ text: "hello", uncertain: false }]);
  assert.deepEqual(e.sourceElementIds, ["f1"]);
  assert.deepEqual(e.bbox, { x: 0, y: 0, width: 10, height: 10 });
});

test("the artifact is transcription-only — it never carries notes (Phase 1 stops before notes, D3)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelResponse({ c1: { segments: [{ text: "hi", uncertain: false }] } }));
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([inkCrop("c1", ["f1"])]);

  assert.equal(artifact.phase, "transcription");
  assert.ok(!("notes" in artifact), "no notes are generated in Phase 1");
});

test("segments are stored structured, not flattened to a string (enables two-pass later, D4)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse({
      c1: {
        segments: [
          { text: "meet at ", uncertain: false },
          { text: "3pm", uncertain: true },
        ],
      },
    })
  );
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([inkCrop("c1", ["f1"])]);

  const segs = artifact.entries[0].segments;
  assert.ok(Array.isArray(segs), "segments remain a list, never collapsed to text");
  assert.equal(segs.length, 2);
  assert.deepEqual(segs, [
    { text: "meet at ", uncertain: false },
    { text: "3pm", uncertain: true },
  ]);
});

test("illegible ink is a first-class [unclear] gap, preserved verbatim and marked uncertain (story 6)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse({
      c1: {
        segments: [
          { text: "budget ", uncertain: false },
          { text: "[unclear]", uncertain: true },
        ],
      },
    })
  );
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([inkCrop("c1", ["f1"])]);

  const segs = artifact.entries[0].segments;
  const gap = segs.find((s) => s.uncertain);
  assert.ok(gap, "the uncertain gap survives into the artifact");
  assert.equal(gap.text, "[unclear]");
  assert.equal(gap.uncertain, true);
});

test("an uncertain gap is never silently dropped or overwritten with a guess (story 6/7)", async () => {
  const stub = createGeminiStub();
  // The model omits c2 entirely — the recognize seam surfaces it as an [unclear]
  // gap; the artifact must carry that gap, not drop the crop.
  stub.enqueue(modelResponse({ c1: { segments: [{ text: "seen", uncertain: false }] } }));
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([inkCrop("c1", ["f1"]), inkCrop("c2", ["f2"])]);

  const byId = Object.fromEntries(artifact.entries.map((e) => [e.cropId, e]));
  assert.ok(byId.c2, "the unread crop is still in the artifact, not dropped");
  assert.equal(byId.c2.segments.length, 1);
  assert.equal(byId.c2.segments[0].uncertain, true);
  // Any-uncertain rollup lets the review UI badge the artifact without re-scanning.
  assert.equal(artifact.hasUnclear, true);
});

test("a fully certain transcription reports hasUnclear:false", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse({
      c1: { segments: [{ text: "one", uncertain: false }] },
      c2: { segments: [{ text: "two", uncertain: false }] },
    })
  );
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([inkCrop("c1", ["f1"]), inkCrop("c2", ["f2"])]);

  assert.equal(artifact.hasUnclear, false);
});

test("typed-text crops are transcribed verbatim as certain, without a model call (story 2)", async () => {
  const stub = createGeminiStub();
  // Nothing enqueued: a typed-text-only board must not reach the model (the stub
  // throws when run dry).
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([textCrop("t1", "Approval", ["e1"])]);

  assert.equal(stub.calls.length, 0, "typed text never reaches the model");
  assert.deepEqual(artifact.entries[0].segments, [{ text: "Approval", uncertain: false }]);
  assert.equal(artifact.hasUnclear, false);
});

test("entry order follows crop order so the review UI is stable", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse({
      c2: { segments: [{ text: "two", uncertain: false }] },
      c3: { segments: [{ text: "three", uncertain: false }] },
    })
  );
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([
    textCrop("c1", "one", ["e1"]),
    inkCrop("c2", ["f2"]),
    inkCrop("c3", ["f3"]),
  ]);

  assert.deepEqual(
    artifact.entries.map((e) => e.cropId),
    ["c1", "c2", "c3"]
  );
});

test("an empty board yields an empty transcription artifact with no model call", async () => {
  const stub = createGeminiStub();
  const transcriber = makeTranscriber(stub);

  const artifact = await transcriber.transcribe([]);

  assert.deepEqual(artifact.entries, []);
  assert.equal(artifact.hasUnclear, false);
  assert.equal(stub.calls.length, 0);
});

test("a throttled (deferred) model call still resolves to a transcription artifact (story 56)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelResponse({ c1: { segments: [{ text: "first", uncertain: false }] } }));
  stub.enqueue(modelResponse({ c2: { segments: [{ text: "queued", uncertain: false }] } }));

  const clock = createFakeClock();
  // max:1 per window forces the second transcribe() to defer inside the module.
  const gemini = createGemini({ client: stub, clock, perUser: { windowMs: 1000, max: 1 } });
  const transcriber = createTranscriber({ gemini, userId: "u1" });

  const first = await transcriber.transcribe([inkCrop("c1", ["f1"])]);
  assert.deepEqual(first.entries[0].segments, [{ text: "first", uncertain: false }]);

  const pending = transcriber.transcribe([inkCrop("c2", ["f2"])]);
  await clock.tick(1000);
  const second = await pending;
  assert.deepEqual(second.entries[0].segments, [{ text: "queued", uncertain: false }]);
});

test("a recognizer can be injected at the seam instead of a Gemini module (composition without a model)", async () => {
  // The transcriber accepts a ready-made recognizer, so callers that already hold
  // one need not re-wire Gemini. Here a fake recognizer stands in for the seam.
  const fakeRecognizer = {
    async recognize(crops) {
      return crops.map((c) => ({
        cropId: c.cropId,
        segments: [{ text: "x", uncertain: false }],
        sourceElementIds: c.sourceElementIds,
        bbox: c.bbox,
      }));
    },
  };
  const transcriber = createTranscriber({ recognizer: fakeRecognizer });

  const artifact = await transcriber.transcribe([inkCrop("c1", ["f1"])]);

  assert.equal(artifact.entries[0].segments[0].text, "x");
});

test("constructing a transcriber with neither a recognizer nor a Gemini module fails loud", () => {
  assert.throws(() => createTranscriber({}), /recognizer|gemini/i);
});
