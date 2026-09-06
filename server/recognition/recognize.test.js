"use strict";

// Behaviour tests for the reading-only recognize() seam (D5). The Gemini call is
// stubbed via the slice-#1 harness — NO network, NO real model. We assert only on
// what recognize() returns given crops and a scripted model response: the D5
// structured shape, the typed-text bypass, per-crop keying, and one batched call.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createRecognizer } = require("./index");
const { createGemini } = require("../gemini");
const { createGeminiStub, createFakeClock } = require("../gemini/testHarness");

// A Gemini response as the seam expects it from the injected client: the SDK
// response object exposes `.text`, a JSON string keyed by cropId.
function modelResponse(byCropId) {
  return { text: JSON.stringify(byCropId) };
}

function textCrop(cropId, text, ids) {
  return { cropId, kind: "text", text, sourceElementIds: ids, bbox: { x: 0, y: 0, width: 10, height: 10 } };
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

function makeRecognizer(stub) {
  const gemini = createGemini({ client: stub, clock: createFakeClock() });
  return createRecognizer({ gemini, userId: "u1" });
}

test("returns the D5 structured shape: cropId, segments[{text,uncertain}], sourceElementIds, bbox", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse({
      c1: { segments: [{ text: "hello", uncertain: false }] },
    })
  );
  const recognizer = makeRecognizer(stub);

  const out = await recognizer.recognize([inkCrop("c1", ["f1"])]);

  assert.equal(out.length, 1);
  const r = out[0];
  assert.equal(r.cropId, "c1");
  assert.deepEqual(r.segments, [{ text: "hello", uncertain: false }]);
  assert.deepEqual(r.sourceElementIds, ["f1"]);
  assert.deepEqual(r.bbox, { x: 0, y: 0, width: 10, height: 10 });
});

test("typed-text crops bypass the model and are transcribed as-is (story 2)", async () => {
  const stub = createGeminiStub();
  // No response enqueued: if a typed-text-only batch called the model, the stub
  // would throw (running dry is a loud failure).
  const recognizer = makeRecognizer(stub);

  const out = await recognizer.recognize([textCrop("t1", "Approval", ["e1"])]);

  assert.equal(stub.calls.length, 0, "typed text never reaches the model");
  assert.equal(out.length, 1);
  assert.equal(out[0].cropId, "t1");
  // The typed text is one certain segment, verbatim, never marked uncertain.
  assert.deepEqual(out[0].segments, [{ text: "Approval", uncertain: false }]);
  assert.deepEqual(out[0].sourceElementIds, ["e1"]);
});

test("all ink crops go out in ONE multi-image request keyed by crop id", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse({
      c1: { segments: [{ text: "one", uncertain: false }] },
      c2: { segments: [{ text: "two", uncertain: false }] },
    })
  );
  const recognizer = makeRecognizer(stub);

  const out = await recognizer.recognize([inkCrop("c1", ["f1"]), inkCrop("c2", ["f2"])]);

  // Exactly one batched call for two crops — per-crop linking without N round-trips.
  assert.equal(stub.calls.length, 1);
  // The request references both crop ids so the model can key its answer per crop.
  const sent = JSON.stringify(stub.calls[0]);
  assert.ok(sent.includes("c1") && sent.includes("c2"));

  assert.deepEqual(out.map((r) => r.cropId).sort(), ["c1", "c2"]);
});

test("typed text and ink mix: ink batched to the model, typed text merged in without a call", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse({
      c2: { segments: [{ text: "read", uncertain: true }] },
    })
  );
  const recognizer = makeRecognizer(stub);

  const out = await recognizer.recognize([textCrop("c1", "Typed", ["e1"]), inkCrop("c2", ["f2"])]);

  assert.equal(stub.calls.length, 1, "only the ink crop triggered a model call");
  const byId = Object.fromEntries(out.map((r) => [r.cropId, r]));
  assert.deepEqual(byId.c1.segments, [{ text: "Typed", uncertain: false }]);
  assert.deepEqual(byId.c2.segments, [{ text: "read", uncertain: true }]);
});

test("no crops → no model call, empty result", async () => {
  const stub = createGeminiStub();
  const recognizer = makeRecognizer(stub);

  const out = await recognizer.recognize([]);

  assert.deepEqual(out, []);
  assert.equal(stub.calls.length, 0);
});

test("an ink crop the model omits comes back as an [unclear] gap, never dropped (story 6/7)", async () => {
  const stub = createGeminiStub();
  // Model answers c1 but says nothing about c2.
  stub.enqueue(modelResponse({ c1: { segments: [{ text: "seen", uncertain: false }] } }));
  const recognizer = makeRecognizer(stub);

  const out = await recognizer.recognize([inkCrop("c1", ["f1"]), inkCrop("c2", ["f2"])]);

  const byId = Object.fromEntries(out.map((r) => [r.cropId, r]));
  assert.ok(byId.c2, "the unread crop is still returned, not dropped");
  assert.equal(byId.c2.segments.length, 1);
  assert.equal(byId.c2.segments[0].uncertain, true);
});

test("a deferred (throttled) model call still resolves to a reading (story 56)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelResponse({ c1: { segments: [{ text: "first", uncertain: false }] } }));
  stub.enqueue(modelResponse({ c2: { segments: [{ text: "queued", uncertain: false }] } }));

  const clock = createFakeClock();
  // max:1 per window forces the second recognize() to defer inside the module.
  const gemini = createGemini({ client: stub, clock, perUser: { windowMs: 1000, max: 1 } });
  const recognizer = createRecognizer({ gemini, userId: "u1" });

  const first = await recognizer.recognize([inkCrop("c1", ["f1"])]);
  assert.deepEqual(first[0].segments, [{ text: "first", uncertain: false }]);

  // Second call is over budget → the module defers; recognize must await `done`
  // and still return a reading rather than failing.
  const pending = recognizer.recognize([inkCrop("c2", ["f2"])]);
  await clock.tick(1000);
  const second = await pending;
  assert.deepEqual(second[0].segments, [{ text: "queued", uncertain: false }]);
});

test("an ink crop is sent as inlineData the API accepts, not a raw data URL", async () => {
  // The Gemini API rejects `{ image: "data:image/png;base64,…" }` with a 400:
  // a part must carry `inlineData: { mimeType, data }` where data is BARE base64.
  // This asserts the wire format, which the crop-id tests never looked at.
  const stub = createGeminiStub();
  stub.enqueue({ text: JSON.stringify({ c1: { segments: [{ text: "hi", uncertain: false }] } }) });
  const recognizer = createRecognizer({ gemini: createGemini({ client: stub }), userId: "u1" });

  await recognizer.recognize([
    {
      cropId: "c1",
      kind: "ink",
      image: "data:image/png;base64,AAAA",
      sourceElementIds: ["s1"],
      bbox: { x: 0, y: 0, width: 1, height: 1 },
    },
  ]);

  const parts = stub.calls[0].contents[0].parts;
  const imagePart = parts.find((p) => p.inlineData);
  assert.ok(imagePart, "expected an inlineData part");
  assert.equal(imagePart.inlineData.mimeType, "image/png");
  // The data: prefix must be stripped — the API wants base64 only.
  assert.equal(imagePart.inlineData.data, "AAAA");
  assert.ok(!parts.some((p) => "image" in p), "no part should use the invalid `image` key");
});

test("a failed batch call degrades every ink crop to [unclear], not a thrown read", async () => {
  // The API rejects the whole batch if ONE image is unreadable ("Unable to process
  // input image"), and a safety block or transient fault does the same. Losing the
  // entire read — including the typed text that never went to the model — is worse
  // than reporting the ink as unclear, which is exactly what the user can then fix.
  const stub = createGeminiStub();
  stub.enqueueError(Object.assign(new Error("Unable to process input image"), { status: 400 }));
  const recognizer = createRecognizer({ gemini: createGemini({ client: stub }), userId: "u1" });

  const out = await recognizer.recognize([
    { cropId: "t1", kind: "text", text: "Photosynthesis", sourceElementIds: ["a"], bbox: {} },
    { cropId: "i1", kind: "ink", image: "data:image/png;base64,AAAA", sourceElementIds: ["b"], bbox: {} },
  ]);

  assert.equal(out.length, 2);
  // Typed text is ground truth and never depended on the model — it must survive.
  assert.equal(out[0].segments[0].text, "Photosynthesis");
  assert.equal(out[0].segments[0].uncertain, false);
  // The ink crop reports honestly rather than taking the whole request down.
  assert.equal(out[1].segments[0].text, "[unclear]");
  assert.equal(out[1].segments[0].uncertain, true);
});
