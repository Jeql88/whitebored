"use strict";

// Behaviour tests for the study scope system (D19). The scope object, its diffs,
// and concept resolution are pure and deterministic — no model, no network here.
// The Gemini-parsed chat path is tested separately with the stub harness.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultScope,
  applyDiff,
  diffOf,
  resolveConcept,
  needsConfirmation,
  confirmScope,
  decksFor,
  SOURCES,
} = require("./index");

test("a fresh scope is a structured object with every field the bar renders (story 42)", () => {
  const s = defaultScope();

  assert.equal(s.source, "notes");
  assert.deepEqual(s.range, { kind: "all" });
  assert.equal(typeof s.count, "number");
  assert.equal(s.difficulty, "mixed");
  assert.equal(s.format, "flashcards");
  assert.equal(needsConfirmation(s), false);
});

test("a structural range is applied directly — pages need no confirmation (story 46)", () => {
  const next = applyDiff(defaultScope(), { range: { kind: "pages", from: 3, to: 9 } });

  assert.deepEqual(next.range, { kind: "pages", from: 3, to: 9 });
  assert.equal(needsConfirmation(next), false);
});

test("the edit control mutates scope directly (story 45)", () => {
  const next = applyDiff(defaultScope(), { count: 20, difficulty: "hard" });

  assert.equal(next.count, 20);
  assert.equal(next.difficulty, "hard");
  assert.equal(next.source, "notes");
});

test("applyDiff never mutates the scope it was given (the bar renders from state)", () => {
  const before = defaultScope();
  const snapshot = JSON.parse(JSON.stringify(before));
  applyDiff(before, { count: 50 });

  assert.deepEqual(before, snapshot);
});

test("a diff reports only what actually changed, so the bar can show it applied (story 44)", () => {
  const from = defaultScope();
  const to = applyDiff(from, { count: 20, range: { kind: "pages", from: 1, to: 4 } });

  const d = diffOf(from, to);

  assert.deepEqual(Object.keys(d).sort(), ["count", "range"]);
  assert.deepEqual(d.count, { from: from.count, to: 20 });
  assert.deepEqual(d.range.to, { kind: "pages", from: 1, to: 4 });
});

test("an unknown or malformed field in a diff is ignored rather than corrupting scope", () => {
  const next = applyDiff(defaultScope(), { count: -5, difficulty: "impossible", nonsense: 1 });

  assert.equal(next.count, defaultScope().count, "a nonsense count is refused");
  assert.equal(next.difficulty, "mixed", "an unknown difficulty is refused");
  assert.equal(next.nonsense, undefined);
});

test("a concept range resolves to a concrete page range against the topic list (story 47)", () => {
  const topics = [
    { label: "Cell structure", pageStart: 1, pageEnd: 4 },
    { label: "Mitosis", pageStart: 5, pageEnd: 9 },
    { label: "Meiosis", pageStart: 10, pageEnd: 14 },
  ];

  const resolved = resolveConcept({ kind: "concept", phrase: "up to mitosis" }, topics);

  assert.deepEqual(resolved.resolved, { from: 1, to: 9 });
  assert.deepEqual(resolved.matchedTopics, ["Cell structure", "Mitosis"]);
});

test("a concept range BLOCKS generation until the user confirms (story 47)", () => {
  const pending = applyDiff(defaultScope(), {
    range: { kind: "concept", phrase: "mitosis", resolved: { from: 5, to: 9 }, confirmed: false },
  });

  assert.equal(needsConfirmation(pending), true);

  const confirmed = confirmScope(pending);
  assert.equal(needsConfirmation(confirmed), false);
  assert.equal(confirmed.range.confirmed, true);
  assert.deepEqual(confirmed.range.resolved, { from: 5, to: 9 });
});

test("an unresolvable concept is reported, not guessed at", () => {
  const topics = [{ label: "Mitosis", pageStart: 5, pageEnd: 9 }];

  const resolved = resolveConcept({ kind: "concept", phrase: "quantum tunnelling" }, topics);

  assert.equal(resolved.resolved, null);
  assert.deepEqual(resolved.matchedTopics, []);
});

test("notes+documents yields two clearly labelled decks that are never merged (stories 34, 35)", () => {
  const decks = decksFor(applyDiff(defaultScope(), { source: "notes+documents" }));

  assert.equal(decks.length, 2);
  assert.deepEqual(decks.map((d) => d.deck), ["notes", "document"]);
  assert.ok(decks.every((d) => typeof d.label === "string" && d.label.length > 0));
});

test("a single-source scope yields exactly one deck", () => {
  assert.deepEqual(decksFor(defaultScope()).map((d) => d.deck), ["notes"]);
  assert.deepEqual(
    decksFor(applyDiff(defaultScope(), { source: "documents" })).map((d) => d.deck),
    ["document"]
  );
  assert.ok(SOURCES.includes("notes+documents"));
});
