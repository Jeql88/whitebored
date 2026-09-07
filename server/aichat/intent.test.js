"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { classifyIntent } = require("./intent");

test("asking for notes routes to notes", () => {
  for (const msg of [
    "generate notes",
    "make clean notes from my board",
    "write up my board as notes",
    "summarise this board",
    "can you create a summary of my board",
  ]) {
    assert.equal(classifyIntent(msg), "notes", msg);
  }
});

test("asking for practice material routes to cards", () => {
  for (const msg of [
    "make flashcards",
    "generate a quiz from this",
    "create practice questions",
    "give me a mock exam",
    "make some study questions from my board",
  ]) {
    assert.equal(classifyIntent(msg), "cards", msg);
  }
});

test("cards beat notes when a message names both", () => {
  // "flashcards from my notes" is a request for cards; treating it as a notes
  // request would regenerate the notes and never produce the cards asked for.
  assert.equal(classifyIntent("make flashcards from my notes"), "cards");
});

test("a question about an artifact is answered, not acted on", () => {
  // Naming "notes" must not be enough to trigger generation — that would
  // overwrite the user's work in response to a question about it.
  for (const msg of [
    "what do my notes say about mitosis?",
    "how many flashcards do I have",
    "why is this note wrong?",
    "are my notes complete",
  ]) {
    assert.equal(classifyIntent(msg), "answer", msg);
  }
});

test("an ordinary question is answered", () => {
  for (const msg of [
    "what is on my board?",
    "explain the diagram",
    "who is the antagonist",
    "tell me about the hive leader",
  ]) {
    assert.equal(classifyIntent(msg), "answer", msg);
  }
});

test("an empty or unclear message is answered rather than guessed at", () => {
  // Answering is the cheapest action and the only one that cannot destroy work,
  // so it is the right default when intent is unclear.
  assert.equal(classifyIntent(""), "answer");
  assert.equal(classifyIntent("   "), "answer");
  assert.equal(classifyIntent("hmm"), "answer");
});
