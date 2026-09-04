"use strict";

// Behaviour tests for regenerate-notes (D7): AI reconciliation FENCED by grounding.
//
// Re-running notes generation reconciles the fresh model output against the prior
// (possibly user-edited) notes via the shared slice-#5 `reconcile` primitive, so:
//   - a user's hand-edited / hand-added lines survive the regenerate (stories 11/12),
//   - lines whose board shapes were deleted retire (spec §7),
//   - genuinely new content is added, and
//   - the AI reconciliation is FENCED by grounding: an AI line that does not trace to
//     the transcription is dropped, so a "coherence improvement" can never smuggle in
//     something the user never drew (story 13).
//
// The Gemini call is stubbed through the slice-#1 harness — NO network, NO real
// model. We drive only the public regenerate interface and assert on the returned
// record / streamed lines, never on the prompt string.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createNotesGenerator } = require("./index");
const { createNotesRegenerator } = require("./regenerate");
const { createGemini } = require("../gemini");
const { createGeminiStub, createFakeClock } = require("../gemini/testHarness");

function modelResponse(lines) {
  return { text: JSON.stringify(lines) };
}

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

function makeRegenerator(stub) {
  const gemini = createGemini({ client: stub, clock: createFakeClock() });
  const generator = createNotesGenerator({ gemini, userId: "u1" });
  return createNotesRegenerator({ generator });
}

// A prior notes line in the D6 shape, with the consumer state regenerate protects.
function line(text, sourceElementIds, extra = {}) {
  return {
    text,
    kind: "key-point",
    sourceElementIds,
    origin: "board",
    ...extra,
  };
}

test("a hand-edited prior line survives regeneration unchanged (story 11)", async () => {
  const stub = createGeminiStub();
  // The model, on regenerate, reworded the edited line back to its original wording.
  // The user's edit must win — the prior (edited) object is what's carried forward.
  stub.enqueue(
    modelResponse([
      { text: "Approval comes first", kind: "key-point", sourceElementIds: ["f0"] },
    ])
  );
  const regen = makeRegenerator(stub);

  const prior = [
    line("Approval MUST come first (per policy)", ["f0"], { userEdited: true }),
  ];

  const record = await regen.regenerate({
    transcription: transcription("Approval comes first"),
    boardId: "b1",
    prior,
    boardElementIds: ["f0"],
  });

  const texts = record.lines.map((l) => l.text);
  assert.ok(
    texts.includes("Approval MUST come first (per policy)"),
    "the user's edited wording survives, not the model's reworded version"
  );
  assert.ok(
    !texts.includes("Approval comes first"),
    "the model's competing reword does not duplicate the protected line"
  );
});

test("a genuinely new AI line that traces to the board is added (story 12)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "Approval comes first", kind: "key-point", sourceElementIds: ["f0"] },
      { text: "Then review the budget", kind: "key-point", sourceElementIds: ["f1"] },
    ])
  );
  const regen = makeRegenerator(stub);

  const prior = [line("Approval comes first", ["f0"])];

  const record = await regen.regenerate({
    transcription: transcription("Approval comes first", "then review the budget"),
    boardId: "b1",
    prior,
    boardElementIds: ["f0", "f1"],
  });

  const texts = record.lines.map((l) => l.text);
  assert.ok(texts.includes("Then review the budget"), "new board-traceable content is folded in");
});

test("grounding fences reconciliation: an ungrounded AI line is dropped (story 13)", async () => {
  const stub = createGeminiStub();
  // The model invents a "coherence improvement" that mentions photosynthesis — a
  // term nowhere on the board. Reconciliation must NOT let it survive.
  stub.enqueue(
    modelResponse([
      { text: "Approval comes first", kind: "key-point", sourceElementIds: ["f0"] },
      { text: "Approval enables photosynthesis", kind: "key-point", sourceElementIds: ["f0"] },
    ])
  );
  const regen = makeRegenerator(stub);

  const record = await regen.regenerate({
    transcription: transcription("Approval comes first"),
    boardId: "b1",
    prior: [],
    boardElementIds: ["f0"],
  });

  const texts = record.lines.map((l) => l.text);
  assert.deepEqual(texts, ["Approval comes first"], "the invented line never survives");
  assert.ok(!texts.some((t) => /photosynthesis/i.test(t)));
});

test("a protected line survives even if it would not pass grounding (it is the user's own constraint)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "Approval comes first", kind: "key-point", sourceElementIds: ["f0"] },
    ])
  );
  const regen = makeRegenerator(stub);

  // The user typed a line whose wording does not literally appear in the
  // transcription (their own paraphrase). Grounding fences the AI, not the user —
  // a user-authored/edited line is a fixed constraint, not an AI invention.
  const prior = [
    line("Approval is the gating milestone", ["f0"], { userEdited: true }),
  ];

  const record = await regen.regenerate({
    transcription: transcription("Approval comes first"),
    boardId: "b1",
    prior,
    boardElementIds: ["f0"],
  });

  const texts = record.lines.map((l) => l.text);
  assert.ok(
    texts.includes("Approval is the gating milestone"),
    "the user's own line is preserved regardless of the local key-term gate"
  );
});

test("a protected line whose board shapes were deleted retires (spec §7)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "Approval comes first", kind: "key-point", sourceElementIds: ["f0"] },
    ])
  );
  const regen = makeRegenerator(stub);

  // The user had edited a line tracing to f9, but f9 was erased from the board.
  const prior = [
    line("A note about a deleted shape", ["f9"], { userEdited: true }),
  ];

  const record = await regen.regenerate({
    transcription: transcription("Approval comes first"),
    boardId: "b1",
    prior,
    boardElementIds: ["f0"], // f9 gone
  });

  const texts = record.lines.map((l) => l.text);
  assert.ok(
    !texts.includes("A note about a deleted shape"),
    "an edited line whose shape is gone retires rather than clinging on"
  );
});

test("regenerate returns the D6 record shape and streams each surviving line", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "Approval comes first", kind: "key-point", sourceElementIds: ["f0"] },
      { text: "invented xyzzy line", kind: "key-point", sourceElementIds: ["f0"] },
    ])
  );
  const regen = makeRegenerator(stub);

  const prior = [line("A user point", ["f1"], { userEdited: true })];
  const streamed = [];

  const record = await regen.regenerate({
    transcription: transcription("Approval comes first"),
    boardId: "b1",
    noteType: "lecture",
    prior,
    boardElementIds: ["f0", "f1"],
    onLine: (l) => streamed.push(l.text),
  });

  assert.equal(record.boardId, "b1");
  assert.equal(record.noteType, "lecture");
  for (const l of record.lines) {
    assert.equal(typeof l.text, "string");
    assert.ok(Array.isArray(l.sourceElementIds));
    assert.ok(typeof l.kind === "string" && typeof l.origin === "string");
  }
  // Streamed set equals the surviving lines (the invented one never streams).
  assert.deepEqual(streamed, record.lines.map((l) => l.text));
  assert.ok(!streamed.some((t) => /xyzzy/.test(t)), "an ungrounded line never streams");
});

test("with no prior notes, regenerate behaves like a first generate (fenced by grounding)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { text: "Approval comes first", kind: "key-point", sourceElementIds: ["f0"] },
      { text: "invented nowhere line", kind: "key-point", sourceElementIds: ["f0"] },
    ])
  );
  const regen = makeRegenerator(stub);

  const record = await regen.regenerate({
    transcription: transcription("Approval comes first"),
    boardId: "b1",
    boardElementIds: ["f0"],
  });

  assert.deepEqual(record.lines.map((l) => l.text), ["Approval comes first"]);
});

test("constructing a regenerator without a generator fails loud", () => {
  assert.throws(() => createNotesRegenerator({}), /generator/i);
});
