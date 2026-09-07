"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseCommand, COMMANDS } = require("./commands");

test("every advertised command resolves to an action", () => {
  // The input lists these to the user; one that does not resolve would be a
  // suggestion that does nothing when clicked.
  for (const cmd of COMMANDS) {
    const { action } = parseCommand(cmd.name);
    assert.notEqual(action, "answer", `${cmd.name} should not fall through`);
    assert.notEqual(action, "unknown", `${cmd.name} should be recognised`);
  }
});

test("slash commands route exactly", () => {
  assert.equal(parseCommand("/generate-notes").action, "notes");
  assert.equal(parseCommand("/generate-flashcards").action, "cards");
  assert.equal(parseCommand("/read-board").action, "read");
});

test("a slash command is case-insensitive and may carry an argument", () => {
  const r = parseCommand("/Generate-Notes focus on the diagram");
  assert.equal(r.action, "notes");
  assert.equal(r.argument, "focus on the diagram");
});

test("an unknown slash command is reported, not silently answered", () => {
  // Guessing would hide a typo: the user clearly meant to invoke something.
  const r = parseCommand("/generat-notes");
  assert.equal(r.action, "unknown");
  assert.equal(r.attempted, "/generat-notes");
});

test("prose works without knowing the commands", () => {
  assert.equal(parseCommand("generate notes from my board").action, "notes");
  assert.equal(parseCommand("make me some flashcards").action, "cards");
  assert.equal(parseCommand("re-read the board").action, "read");
});

test("cards beat notes when a message names both", () => {
  assert.equal(parseCommand("make flashcards from my notes").action, "cards");
});

test("a question about an artifact is answered, never acted on", () => {
  // The rule that protects the user's work: naming "notes" is not asking for
  // them to be rewritten.
  for (const msg of [
    "what do my notes say?",
    "how many flashcards do I have",
    "are my notes any good",
    "why does this note mention mitosis?",
  ]) {
    assert.equal(parseCommand(msg).action, "answer", msg);
  }
});

test("an ordinary question is answered", () => {
  for (const msg of ["what is on my board?", "explain the diagram", "who is the antagonist"]) {
    assert.equal(parseCommand(msg).action, "answer", msg);
  }
});

test("an empty message is answered rather than guessed at", () => {
  assert.equal(parseCommand("").action, "answer");
  assert.equal(parseCommand("   ").action, "answer");
});
