"use strict";

// The chat-driven scoping path (D19, stories 43/44/47): a scope-changing chat
// message is parsed by the model into a DIFF the user sees applied — never a
// silent mutation — and a concept range must resolve-then-confirm before it can
// generate. The model is stubbed throughout; no network, no real model.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createGemini } = require("../gemini");
const { createGeminiStub, createFakeClock } = require("../gemini/testHarness");
const { createScopeParser } = require("./chatScope");
const { defaultScope, needsConfirmation } = require("./index");

const TOPICS = [
  { label: "Cell structure", pageStart: 1, pageEnd: 4 },
  { label: "Mitosis", pageStart: 5, pageEnd: 9 },
];

function parserWith(reply) {
  const stub = createGeminiStub();
  stub.enqueue({ text: JSON.stringify(reply) });
  const parser = createScopeParser({ gemini: createGemini({ client: stub }) });
  return { parser, stub };
}

test("a scope-changing message is parsed into a diff shown applied, not a silent mutation (stories 43, 44)", async () => {
  const { parser } = parserWith({ count: 20 });
  const scope = defaultScope();

  const out = await parser.parse({ message: "make it 20 questions", scope, topics: TOPICS });

  assert.equal(out.changed, true);
  // The caller gets BOTH the proposed next scope and the visible diff, so the bar
  // can render exactly what changed rather than silently swapping state.
  assert.deepEqual(out.diff.count, { from: scope.count, to: 20 });
  assert.equal(out.scope.count, 20);
  // The scope it was handed is untouched.
  assert.equal(scope.count, defaultScope().count);
});

test("a concept range is resolved against the topics and blocks generation until confirmed (story 47)", async () => {
  const { parser } = parserWith({ range: { kind: "concept", phrase: "up to mitosis" } });

  const out = await parser.parse({ message: "only up to mitosis", scope: defaultScope(), topics: TOPICS });

  // Resolved to a concrete range and SHOWN...
  assert.deepEqual(out.scope.range.resolved, { from: 1, to: 9 });
  assert.deepEqual(out.matchedTopics, ["Cell structure", "Mitosis"]);
  // ...but not yet confirmed, so generation is blocked.
  assert.equal(out.scope.range.confirmed, false);
  assert.equal(needsConfirmation(out.scope), true);
  assert.equal(out.needsConfirmation, true);
});

test("a concept the topics can't place is reported rather than guessed at", async () => {
  const { parser } = parserWith({ range: { kind: "concept", phrase: "quantum tunnelling" } });

  const out = await parser.parse({ message: "up to quantum tunnelling", scope: defaultScope(), topics: TOPICS });

  assert.equal(out.scope.range.resolved, null);
  assert.equal(out.unresolvedConcept, "quantum tunnelling");
  // An unresolved concept still can't generate — it is not silently ignored.
  assert.equal(out.needsConfirmation, true);
});

test("a message that changes nothing reports no change and no model-driven mutation", async () => {
  const { parser } = parserWith({});

  const out = await parser.parse({ message: "thanks!", scope: defaultScope(), topics: TOPICS });

  assert.equal(out.changed, false);
  assert.deepEqual(out.diff, {});
});

test("a malformed model reply leaves scope untouched rather than corrupting it", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: "not json at all" });
  const parser = createScopeParser({ gemini: createGemini({ client: stub }) });
  const scope = defaultScope();

  const out = await parser.parse({ message: "only chapter 2", scope, topics: TOPICS });

  assert.equal(out.changed, false);
  assert.deepEqual(out.scope, scope);
});

test("a structural page range from chat needs no confirmation (story 46)", async () => {
  const { parser } = parserWith({ range: { kind: "pages", from: 2, to: 6 } });

  const out = await parser.parse({ message: "pages 2 to 6", scope: defaultScope(), topics: TOPICS });

  assert.deepEqual(out.scope.range, { kind: "pages", from: 2, to: 6 });
  assert.equal(out.needsConfirmation, false);
});

test("a throttled parse still returns a diff (the working state, story 56)", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: JSON.stringify({ count: 15 }) });
  stub.enqueue({ text: JSON.stringify({ count: 30 }) });
  // One-call budget forces the second parse onto the deferred/working path; the
  // fake clock drains the burst queue so the test asserts the wait without taking it.
  const clock = createFakeClock();
  const gemini = createGemini({ client: stub, clock, perUser: { windowMs: 60000, max: 1 } });
  const parser = createScopeParser({ gemini });

  await parser.parse({ message: "first", scope: defaultScope(), topics: TOPICS, userId: "u1" });

  const pending = parser.parse({ message: "make it 30", scope: defaultScope(), topics: TOPICS, userId: "u1" });
  await clock.tick(60000); // roll into the next window so the queue drains

  assert.equal((await pending).scope.count, 30);
});
