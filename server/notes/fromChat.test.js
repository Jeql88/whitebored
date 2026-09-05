"use strict";

// Behaviour tests for moving an AI-chat answer into the notes artifact (D11, D12).
// Everything here is pure and deterministic — no model, no clock, no network. We
// drive the module only through its public interface and assert on what it returns.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  lineFromChatMessage,
  isAddable,
  notesDeckLines,
} = require("./fromChat");

// A slice-#13 assistant message, reduced to what the move cares about.
function message(bucket, extra = {}) {
  const source = {
    bucket,
    label: bucket === "general" ? "general knowledge" : "from your board",
    addableToNotes: bucket !== "general",
    ...extra,
  };
  return { role: "assistant", text: "Mitosis has four phases", source };
}

test("a board-sourced answer becomes a chat-origin note line (story 20)", () => {
  const line = lineFromChatMessage(message("board", { sourceElementIds: ["s1"] }));

  assert.equal(line.text, "Mitosis has four phases");
  assert.equal(line.origin, "chat");
  assert.equal(line.kind, "key-point");
  // The board answer traces to shapes, so the line carries them and stays
  // highlightable + card-eligible like any board line.
  assert.deepEqual(line.sourceElementIds, ["s1"]);
  assert.equal(line.citation, undefined);
});

test("a document-sourced answer is stored with origin=document + citation, not shapes (D12)", () => {
  const line = lineFromChatMessage(
    message("document", { docId: "d1", page: 7, label: "from notes.pdf, p.7" })
  );

  assert.equal(line.origin, "document");
  assert.deepEqual(line.citation, { docId: "d1", page: 7 });
  // A document line points at a page, not at ink — it has no board shapes.
  assert.deepEqual(line.sourceElementIds, []);
});

test("a general-knowledge answer is never addable and never becomes a line (story 19)", () => {
  const msg = message("general");

  assert.equal(isAddable(msg), false);
  assert.equal(lineFromChatMessage(msg), null);
});

test("isAddable follows the message's verified provenance, not the caller's say-so", () => {
  assert.equal(isAddable(message("board")), true);
  assert.equal(isAddable(message("document", { docId: "d1", page: 2 })), true);
  assert.equal(isAddable(message("general")), false);
  assert.equal(isAddable(null), false);
  assert.equal(isAddable({ role: "assistant", text: "no source" }), false);
});

test("a user's own message is not addable — only verified answers move", () => {
  assert.equal(isAddable({ role: "user", text: "what is mitosis?" }), false);
});

test("an empty or whitespace answer yields no line rather than an empty note", () => {
  assert.equal(lineFromChatMessage({ role: "assistant", text: "   ", source: { bucket: "board", addableToNotes: true } }), null);
});

test("a document answer missing a usable citation is not addable (evidence, not assertion)", () => {
  const noCite = message("document", { addableToNotes: true });
  assert.equal(isAddable(noCite), false);
  assert.equal(lineFromChatMessage(noCite), null);
});

test("the notes-only deck excludes document-origin lines (D12)", () => {
  const lines = [
    { text: "From the board", kind: "key-point", sourceElementIds: ["s1"], origin: "board" },
    { text: "Added from chat", kind: "key-point", sourceElementIds: ["s2"], origin: "chat" },
    { text: "From the PDF", kind: "key-point", sourceElementIds: [], origin: "document", citation: { docId: "d1", page: 3 } },
  ];

  const deck = notesDeckLines({ boardId: "b1", lines });

  // The notes-only deck stays shapes-only: board and chat lines trace to ink and
  // stay; the document line is allowed in the ARTIFACT but not in this deck.
  assert.deepEqual(deck.map((l) => l.text), ["From the board", "Added from chat"]);
});

test("notesDeckLines tolerates a record with no lines", () => {
  assert.deepEqual(notesDeckLines({ boardId: "b1" }), []);
  assert.deepEqual(notesDeckLines(null), []);
});
