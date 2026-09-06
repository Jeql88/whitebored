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

test("an ink crop the model omits yields no text, and never a placeholder", async () => {
  const stub = createGeminiStub();
  // Model answers c1 but says nothing about c2.
  stub.enqueue(modelResponse({ c1: { segments: [{ text: "seen", uncertain: false }] } }));
  const recognizer = makeRecognizer(stub);

  const out = await recognizer.recognize([inkCrop("c1", ["f1"]), inkCrop("c2", ["f2"])]);

  const byId = Object.fromEntries(out.map((r) => [r.cropId, r]));
  // The crop is still REPORTED (its shapes are never lost, story 7) — it simply
  // carries no text, so nothing unread can reach the notes as "[unclear]" noise.
  assert.ok(byId.c2, "the unread crop is still returned, not dropped");
  assert.deepEqual(byId.c2.segments, []);
  assert.deepEqual(byId.c2.sourceElementIds, ["f2"]);
  // What WAS read is unaffected.
  assert.equal(byId.c1.segments[0].text, "seen");
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

test("a failed batch call yields empty readings, not a thrown read", async () => {
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
  // The ink crop contributes nothing rather than taking the whole request down —
  // and the caller can tell a failure from an illegible crop via readFailure.
  assert.deepEqual(out[1].segments, []);
  assert.ok(out.readFailure, "the failure reason is reported");
});

test("an ordinary board is read in ONE request, not split into many", async () => {
  // The free tier allows only ~20 generate calls PER DAY. Splitting a board into
  // 12-image requests spent that in one or two clicks: the early chunks read fine
  // and the tail came back 429, which is what a half-empty transcription was.
  // A whole ordinary board must therefore cost exactly one call.
  const stub = createGeminiStub();
  const crops = [];
  const answer = [];
  for (let i = 0; i < 40; i++) {
    crops.push({
      cropId: `c${i}`,
      kind: "ink",
      image: "data:image/png;base64,AAAA",
      sourceElementIds: [`f${i}`],
      bbox: {},
    });
    answer.push({ cropId: `c${i}`, segments: [{ text: `read ${i}`, uncertain: false }] });
  }
  stub.enqueue({ text: JSON.stringify(answer) });

  const out = await createRecognizer({ gemini: createGemini({ client: stub }), userId: "u1" })
    .recognize(crops);

  assert.equal(stub.calls.length, 1, "a 40-crop board must cost a single request");
  assert.equal(out.length, 40);
  assert.equal(out[0].segments[0].text, "read 0");
  assert.equal(out[39].segments[0].text, "read 39");
});

test("a pathological board still splits rather than sending one unbounded request", async () => {
  // The per-request bound is raised, not removed: a board far beyond what one
  // request can carry must still be chunked, keyed correctly and kept in order.
  const stub = createGeminiStub();
  const crops = [];
  for (let i = 0; i < 250; i++) {
    crops.push({
      cropId: `c${i}`,
      kind: "ink",
      image: "data:image/png;base64,AAAA",
      sourceElementIds: [`f${i}`],
      bbox: {},
    });
  }
  // Reply to whatever chunks it chooses, without assuming a chunk size.
  for (let start = 0; start < 250; start += 1) {
    stub.enqueue({
      text: JSON.stringify(
        crops.map((c, i) => ({ cropId: c.cropId, segments: [{ text: `read ${i}` }] }))
      ),
    });
  }

  const out = await createRecognizer({ gemini: createGemini({ client: stub }), userId: "u1" })
    .recognize(crops);

  assert.ok(stub.calls.length > 1, "expected a pathological board to be split");
  assert.equal(out.length, 250);
  assert.equal(out[0].segments[0].text, "read 0");
  assert.equal(out[249].segments[0].text, "read 249");
});

// --- Reply-envelope tolerance -------------------------------------------------
// The bug these cover: a real board came back with EVERY crop's segments empty
// while the call itself reported success and set no readFailure. The model had
// read the board fine — the parser only accepted one exact envelope, so any other
// shape silently produced nothing, which is indistinguishable in the artifact
// from "your handwriting was illegible".

// Drive the recognizer with a raw reply string and return the first crop's segments.
async function segmentsForReply(rawJson) {
  const stub = createGeminiStub();
  stub.enqueue({ text: rawJson });
  const out = await makeRecognizer(stub).recognize([inkCrop("crop-a", ["a"])]);
  return out[0].segments;
}

test("a reply wrapped in a container key is still read", async () => {
  const segs = await segmentsForReply(
    JSON.stringify({ crops: { "crop-a": { segments: [{ text: "mitosis", uncertain: false }] } } })
  );
  assert.deepEqual(segs, [{ text: "mitosis", uncertain: false }]);
});

test("a reply as an array of per-crop objects is still read", async () => {
  const segs = await segmentsForReply(
    JSON.stringify([{ cropId: "crop-a", segments: [{ text: "mitosis", uncertain: true }] }])
  );
  assert.deepEqual(segs, [{ text: "mitosis", uncertain: true }]);
});

test("a reply naming the crop without its 'crop-' prefix is still read", async () => {
  const segs = await segmentsForReply(
    JSON.stringify([{ cropId: "a", segments: [{ text: "mitosis" }] }])
  );
  assert.deepEqual(segs, [{ text: "mitosis", uncertain: false }]);
});

test("a bare string or bare segment list for a crop is still read", async () => {
  assert.deepEqual(await segmentsForReply(JSON.stringify({ "crop-a": "mitosis" })), [
    { text: "mitosis", uncertain: false },
  ]);
  assert.deepEqual(await segmentsForReply(JSON.stringify({ "crop-a": [{ text: "mitosis" }] })), [
    { text: "mitosis", uncertain: false },
  ]);
});

test("a genuinely empty reading stays empty and is not invented", async () => {
  // Tolerance must not become guessing: nothing legible still means no segments.
  assert.deepEqual(await segmentsForReply(JSON.stringify([])), []);
});

test("a board where NO crop reads back reports a readFailure, not a silent blank", async () => {
  // Every crop empty with no error thrown is a systemic failure (an unparsed
  // envelope, a truncated reply, a safety block) — never "nothing was legible".
  // Reported as success it looked like a working feature that found nothing.
  const stub = createGeminiStub();
  stub.enqueue({ text: JSON.stringify({ unrelated: "shape" }) });
  const out = await makeRecognizer(stub).recognize([
    inkCrop("crop-a", ["a"]),
    inkCrop("crop-b", ["b"]),
  ]);

  assert.equal(out.length, 2);
  assert.deepEqual(out[0].segments, []);
  assert.ok(out.readFailure, "an all-empty read must surface a readFailure");
});

test("a partial read does NOT report a failure — some crops are legitimately blank", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: JSON.stringify([{ cropId: "crop-a", segments: [{ text: "read" }] }]) });
  const out = await makeRecognizer(stub).recognize([
    inkCrop("crop-a", ["a"]),
    inkCrop("crop-b", ["b"]),
  ]);

  assert.deepEqual(out[1].segments, []);
  assert.equal(out.readFailure, null);
});

// --- Reusing unchanged ink ----------------------------------------------------
// The free tier allows ~20 generate calls PER DAY. Re-reading a whole board to
// regenerate notes after editing one word spent a call on ink the model had
// already read, which is the difference between a few boards and a day's work.

function inkWithImage(cropId, image) {
  return { cropId, kind: "ink", image, sourceElementIds: [cropId], bbox: {} };
}

test("ink unchanged since the last read is reused, and never re-sent to the model", async () => {
  const stub = createGeminiStub();
  stub.enqueue({
    text: JSON.stringify([
      { cropId: "crop-a", segments: [{ text: "alpha" }] },
      { cropId: "crop-b", segments: [{ text: "beta" }] },
    ]),
  });
  const recognizer = createRecognizer({ gemini: createGemini({ client: stub }), userId: "u1" });

  const crops = [inkWithImage("crop-a", "IMG-A"), inkWithImage("crop-b", "IMG-B")];
  const first = await recognizer.recognize(crops);
  assert.equal(stub.calls.length, 1);

  // Nothing changed: the second read must cost NO model call at all.
  const previous = { entries: first };
  const again = await recognizer.recognize(crops, { previous });
  assert.equal(stub.calls.length, 1, "an unchanged board must not call the model");
  assert.equal(again[0].segments[0].text, "alpha");
  assert.equal(again[1].segments[0].text, "beta");
});

test("only the crop whose ink actually changed is re-read", async () => {
  const stub = createGeminiStub();
  stub.enqueue({
    text: JSON.stringify([
      { cropId: "crop-a", segments: [{ text: "alpha" }] },
      { cropId: "crop-b", segments: [{ text: "beta" }] },
    ]),
  });
  const recognizer = createRecognizer({ gemini: createGemini({ client: stub }), userId: "u1" });
  const first = await recognizer.recognize([
    inkWithImage("crop-a", "IMG-A"),
    inkWithImage("crop-b", "IMG-B"),
  ]);

  stub.enqueue({ text: JSON.stringify([{ cropId: "crop-b", segments: [{ text: "beta v2" }] }]) });
  const out = await recognizer.recognize(
    [inkWithImage("crop-a", "IMG-A"), inkWithImage("crop-b", "IMG-B-EDITED")],
    { previous: { entries: first } }
  );

  // The second request carried ONLY the edited crop.
  const sent = stub.calls[1].contents[0].parts
    .filter((p) => typeof p.text === "string" && p.text.startsWith("cropId:"))
    .map((p) => p.text.replace("cropId: ", ""));
  assert.deepEqual(sent, ["crop-b"], "only changed ink should be re-sent");
  assert.equal(out[0].segments[0].text, "alpha", "the untouched crop keeps its reading");
  assert.equal(out[1].segments[0].text, "beta v2");
});

test("redrawn ink under the SAME cropId is re-read, never served stale", async () => {
  // cropIds derive from element ids, which survive the user redrawing that stroke.
  // Keying reuse on the id would hand back a reading of ink that no longer exists,
  // so reuse is keyed on the image itself.
  const stub = createGeminiStub();
  stub.enqueue({ text: JSON.stringify([{ cropId: "crop-a", segments: [{ text: "before" }] }]) });
  const recognizer = createRecognizer({ gemini: createGemini({ client: stub }), userId: "u1" });
  const first = await recognizer.recognize([inkWithImage("crop-a", "IMG-BEFORE")]);

  stub.enqueue({ text: JSON.stringify([{ cropId: "crop-a", segments: [{ text: "after" }] }]) });
  const out = await recognizer.recognize([inkWithImage("crop-a", "IMG-AFTER")], {
    previous: { entries: first },
  });

  assert.equal(stub.calls.length, 2, "changed ink must reach the model");
  assert.equal(out[0].segments[0].text, "after");
});

test("a fully reused board is not mistaken for an empty read", async () => {
  // The all-empty guard must not fire when every crop was answered from cache: no
  // model call happened, and that is success, not a failure to read.
  const stub = createGeminiStub();
  stub.enqueue({ text: JSON.stringify([{ cropId: "crop-a", segments: [{ text: "alpha" }] }]) });
  const recognizer = createRecognizer({ gemini: createGemini({ client: stub }), userId: "u1" });
  const first = await recognizer.recognize([inkWithImage("crop-a", "IMG-A")]);

  const out = await recognizer.recognize([inkWithImage("crop-a", "IMG-A")], {
    previous: { entries: first },
  });
  assert.equal(out.readFailure, null, "a fully cached read is not a failure");
});
