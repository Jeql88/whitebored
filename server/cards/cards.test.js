"use strict";

// Behaviour tests for the flashcards slice (D17/D18). The Gemini call is stubbed
// through the slice-#1 harness — NO network, NO real model. We assert only on
// external behaviour: the card/collection shape, that local verification drops
// un-traceable cards (the required D17 test), that relationship cards come from
// arrows/bindings (story 37), that SM-2 fields are maintained (story 39), that review
// state survives regeneration via matching (the required D18 test, story 40), and
// that the collection persists one-per-board+deck.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  createCardsGenerator,
  questionFingerprint,
  buildRelationshipCards,
} = require("./index");
const { verifyCard, cardSourceText } = require("./verify");
const { freshSchedule, review, isDue } = require("./sm2");
const { createCardsStore } = require("./store");
const { createGemini } = require("../gemini");
const { createGeminiStub, createFakeClock } = require("../gemini/testHarness");

// A Gemini response as the module expects: an SDK-shaped object whose `.text` is the
// JSON the model produced (an array of cards).
function modelResponse(cards) {
  return { text: JSON.stringify(cards) };
}

// A D6 notes record (the source of cards). Only line text + sourceElementIds matter.
function notes(...lines) {
  return {
    boardId: "b1",
    noteType: "lecture",
    lines: lines.map((l) => ({
      text: l.text,
      kind: l.kind || "key-point",
      sourceElementIds: l.ids || [],
      origin: "board",
    })),
  };
}

function makeGenerator(stub, opts = {}) {
  const gemini = createGemini({ client: stub, clock: createFakeClock(), ...opts });
  return createCardsGenerator({ gemini, userId: "u1" });
}

// A fixed clock for deterministic dueDate assertions (2026-09-04, the project date).
const FIXED_NOW = Date.UTC(2026, 8, 4);
const fixedClock = () => FIXED_NOW;

// --- sm2.js (pure scheduling, story 39) -----------------------------------------

test("a fresh schedule starts with SM-2 defaults (ease 2.5, no reps/lapses)", () => {
  const s = freshSchedule();
  assert.equal(s.ease, 2.5);
  assert.equal(s.interval, 0);
  assert.equal(s.lapses, 0);
  assert.equal(s.reps, 0);
  assert.equal(s.dueDate, null); // a never-seen card is due now
});

test("a passing review advances the interval on the SM-2 ladder (1, then 6 days)", () => {
  const first = review(freshSchedule(), 5, { now: fixedClock });
  assert.equal(first.interval, 1);
  assert.equal(first.reps, 1);
  assert.equal(first.dueDate, "2026-09-05");

  const second = review(first, 5, { now: fixedClock });
  assert.equal(second.interval, 6);
  assert.equal(second.reps, 2);
  assert.equal(second.dueDate, "2026-09-10");
});

test("a failed review (grade < 3) is a lapse: interval restarts and lapses increments", () => {
  const graduated = review(review(freshSchedule(), 5, { now: fixedClock }), 5, { now: fixedClock });
  const lapsed = review(graduated, 1, { now: fixedClock });
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.interval, 1); // relearn from one day
  assert.equal(lapsed.reps, 0); // streak reset
  assert.ok(lapsed.ease < graduated.ease, "a failed card eases off");
});

test("ease never drops below the SM-2 floor of 1.3", () => {
  let s = freshSchedule();
  for (let i = 0; i < 10; i++) s = review(s, 0, { now: fixedClock });
  assert.ok(s.ease >= 1.3);
});

test("a never-reviewed card is due; a future dueDate is not", () => {
  assert.equal(isDue(freshSchedule(), { now: fixedClock }), true);
  const scheduled = review(freshSchedule(), 5, { now: fixedClock }); // due 2026-09-05
  assert.equal(isDue(scheduled, { now: fixedClock }), false);
});

// --- verify.js (the local key-terms gate, D17) ----------------------------------

test("verifyCard keeps a card whose answer traces to the notes and a shape", () => {
  const source = cardSourceText(notes({ text: "Approval is the first step", ids: ["f0"] }));
  assert.equal(
    verifyCard(
      { question: "What comes first?", answer: "Approval step", sourceElementIds: ["f0"] },
      source
    ),
    true
  );
});

test("verifyCard drops a card whose answer invents a term not in the notes", () => {
  const source = cardSourceText(notes({ text: "Approval is the first step", ids: ["f0"] }));
  assert.equal(
    verifyCard(
      { question: "What comes first?", answer: "mitosis", sourceElementIds: ["f0"] },
      source
    ),
    false
  );
});

test("verifyCard drops a card that traces to no shape (can't link back to the board)", () => {
  const source = cardSourceText(notes({ text: "Approval step", ids: ["f0"] }));
  assert.equal(
    verifyCard({ question: "First?", answer: "Approval step", sourceElementIds: [] }, source),
    false
  );
});

// --- generator: shape, verification (the required D17 test) ----------------------

test("generate returns a collection of cards with the spec fields", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([
      { question: "What comes first?", answer: "Approval", sourceElementIds: ["f0"] },
    ])
  );
  const gen = makeGenerator(stub);

  const collection = await gen.generate({
    notes: notes({ text: "Approval comes first", ids: ["f0"] }),
    boardId: "b1",
  });

  assert.equal(collection.boardId, "b1");
  assert.equal(collection.deck, "notes");
  assert.equal(collection.cards.length, 1);
  const card = collection.cards[0];
  assert.equal(card.question, "What comes first?");
  assert.equal(card.answer, "Approval");
  assert.equal(card.deck, "notes");
  assert.equal(card.boardId, "b1");
  assert.deepEqual(card.sourceElementIds, ["f0"]); // links back to the shape (story 36)
  assert.ok(card.reviewState, "a card carries an SM-2 schedule (story 39)");
  assert.equal(card.reviewState.ease, 2.5);
});

test("verification drops un-traceable cards with the model stubbed (D17 — the required test)", async () => {
  const stub = createGeminiStub();
  // Three cards: one traces to the board, one invents a term, one traces to no shape.
  stub.enqueue(
    modelResponse([
      { question: "What is Approval?", answer: "the first step", sourceElementIds: ["f0"] },
      { question: "What about photosynthesis?", answer: "invented", sourceElementIds: ["f1"] },
      { question: "Approval?", answer: "no source", sourceElementIds: [] },
    ])
  );
  const gen = makeGenerator(stub);

  const collection = await gen.generate({
    notes: notes({ text: "Approval is the first step", ids: ["f0"] }),
    boardId: "b1",
  });

  const questions = collection.cards.map((c) => c.question);
  assert.deepEqual(questions, ["What is Approval?"]);
  assert.ok(
    !questions.some((q) => /photosynthesis/i.test(q)),
    "the invented card is dropped, never persisted"
  );
});

test("a malformed model reply yields a collection with no fact cards, not a crash", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: "not json at all" });
  const gen = makeGenerator(stub);

  const collection = await gen.generate({ notes: notes({ text: "x", ids: ["f0"] }), boardId: "b1" });
  assert.deepEqual(collection.cards, []);
});

test("a throttled (deferred) generation still resolves to a collection (story 56)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelResponse([{ question: "Q1?", answer: "Approval", sourceElementIds: ["f0"] }]));
  stub.enqueue(modelResponse([{ question: "Q2?", answer: "flow", sourceElementIds: ["f0"] }]));

  const clock = createFakeClock();
  const gemini = createGemini({ client: stub, clock, perUser: { windowMs: 1000, max: 1 } });
  const gen = createCardsGenerator({ gemini, userId: "u1" });

  const n = notes({ text: "Approval flow", ids: ["f0"] });
  const first = await gen.generate({ notes: n, boardId: "b1" });
  assert.equal(first.cards[0].question, "Q1?");

  const pending = gen.generate({ notes: n, boardId: "b1" });
  await clock.tick(1000);
  const second = await pending;
  assert.equal(second.cards[0].question, "Q2?");
});

test("constructing a generator without a Gemini module fails loud", () => {
  assert.throws(() => createCardsGenerator({}), /gemini/i);
});

// --- relationship cards from arrows/bindings (story 37) --------------------------

// A minimal Excalidraw scene: two labelled boxes joined by a bound arrow.
function flowScene() {
  return [
    { id: "boxA", type: "rectangle", text: "Approval" },
    { id: "boxB", type: "rectangle", text: "Review" },
    {
      id: "arrow1",
      type: "arrow",
      startBinding: { elementId: "boxA" },
      endBinding: { elementId: "boxB" },
    },
  ];
}

test("buildRelationshipCards turns a bound arrow into a directional 'what comes after' card", () => {
  const cards = buildRelationshipCards(flowScene(), "notes");
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.match(card.question, /after "Approval"/i);
  assert.equal(card.answer, "Review");
  // Traces to both endpoints and the arrow, so highlighting lights the relationship.
  assert.deepEqual(card.sourceElementIds.sort(), ["arrow1", "boxA", "boxB"]);
});

test("a dangling arrow (no binding) makes no relationship card", () => {
  const cards = buildRelationshipCards(
    [{ id: "a", type: "arrow", startBinding: { elementId: "boxA" }, endBinding: null }],
    "notes"
  );
  assert.deepEqual(cards, []);
});

test("generate emits relationship cards from the diagram alongside fact cards (story 37)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelResponse([{ question: "What is Approval?", answer: "a step", sourceElementIds: ["boxA"] }])
  );
  const gen = makeGenerator(stub);

  const collection = await gen.generate({
    notes: notes({ text: "Approval then Review", ids: ["boxA"] }),
    boardId: "b1",
    elements: flowScene(),
  });

  const relationship = collection.cards.find((c) => c.relationship);
  assert.ok(relationship, "a relationship card was generated from the arrow");
  assert.match(relationship.question, /after "Approval"/i);
  // A relationship card is a first-class card too: it carries a schedule.
  assert.equal(relationship.reviewState.ease, 2.5);
});

// --- regeneration: review state survives (the required D18 test, story 40) --------

test("review state survives regeneration for an unchanged card (D18 — the required test)", async () => {
  const stub = createGeminiStub();
  const cardLine = { question: "What comes first?", answer: "Approval", sourceElementIds: ["f0"] };
  // Two generations return the SAME card (same question + shape).
  stub.enqueue(modelResponse([cardLine]));
  stub.enqueue(modelResponse([cardLine]));
  const gen = makeGenerator(stub);
  const n = notes({ text: "Approval comes first", ids: ["f0"] });

  const firstGen = await gen.generate({ notes: n, boardId: "b1", boardElementIds: ["f0"] });
  // Simulate the user studying the card: it now has a real schedule.
  const studied = review(firstGen.cards[0].reviewState, 5, { now: fixedClock });
  const prior = {
    ...firstGen,
    cards: [{ ...firstGen.cards[0], reviewState: studied }],
  };

  const regen = await gen.generate({
    notes: n,
    boardId: "b1",
    boardElementIds: ["f0"],
    prior,
  });

  assert.equal(regen.cards.length, 1);
  // The regenerated card kept the studied schedule — its review history rode along.
  assert.deepEqual(regen.cards[0].reviewState, studied);
  assert.notEqual(regen.cards[0].reviewState.dueDate, null);
});

test("a card whose shape was deleted retires; a genuinely new card starts fresh (story 40)", async () => {
  const stub = createGeminiStub();
  // Prior had a card on shape f-old; regeneration produces a new card on shape f-new,
  // and f-old is no longer on the board.
  const priorCard = {
    id: "notes-0",
    boardId: "b1",
    question: "Old question about Approval?",
    answer: "old",
    deck: "notes",
    sourceElementIds: ["f-old"],
    reviewState: review(freshSchedule(), 5, { now: fixedClock }),
  };
  stub.enqueue(
    modelResponse([{ question: "What is the new Review step?", answer: "new", sourceElementIds: ["f-new"] }])
  );
  const gen = makeGenerator(stub);

  const regen = await gen.generate({
    notes: notes({ text: "Review is the new step", ids: ["f-new"] }),
    boardId: "b1",
    boardElementIds: ["f-new"], // f-old is gone
    prior: { boardId: "b1", deck: "notes", cards: [priorCard] },
  });

  assert.equal(regen.cards.length, 1);
  const card = regen.cards[0];
  assert.equal(card.question, "What is the new Review step?");
  // A brand-new card starts on a fresh schedule, not the retired card's.
  assert.equal(card.reviewState.dueDate, null);
  assert.equal(card.reviewState.reps, 0);
});

test("questionFingerprint matches the same question regardless of case/whitespace", () => {
  assert.equal(
    questionFingerprint({ question: "  What Comes After Approval? " }),
    questionFingerprint({ question: "what comes after approval?" })
  );
});

// --- store: one collection per board+deck ----------------------------------------

// In-memory fake faithful to a Mongo collection's upsert-by-filter + findOne, keyed
// by the (boardId, deck) compound the store upserts on.
function fakeCollection() {
  const docs = new Map(); // key -> doc
  const keyOf = (f) => `${f.boardId}::${f.deck}`;
  return {
    docs,
    async updateOne(filter, update, opts = {}) {
      const key = keyOf(filter);
      const existing = docs.get(key);
      if (!existing && !opts.upsert) return { matchedCount: 0 };
      docs.set(key, { ...(existing || {}), ...update.$set });
      return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 };
    },
    async findOne(filter) {
      return docs.get(keyOf(filter)) || null;
    },
  };
}

test("store persists ONE collection per board+deck (upsert overwrites, never duplicates)", async () => {
  const collection = fakeCollection();
  const store = createCardsStore({ collection });

  await store.save({ boardId: "b1", deck: "notes", cards: [{ question: "a" }] });
  await store.save({ boardId: "b1", deck: "notes", cards: [{ question: "b" }] });

  assert.equal(collection.docs.size, 1, "still one collection for the board+deck");
  const loaded = await store.load("b1", "notes");
  assert.equal(loaded.cards[0].question, "b");
  assert.ok(loaded.updatedAt instanceof Date);
});

test("store keeps different decks for the same board separate", async () => {
  const collection = fakeCollection();
  const store = createCardsStore({ collection });
  await store.save({ boardId: "b1", deck: "notes", cards: [{ question: "n" }] });
  await store.save({ boardId: "b1", deck: "document", cards: [{ question: "d" }] });
  assert.equal(collection.docs.size, 2);
  assert.equal((await store.load("b1", "notes")).cards[0].question, "n");
  assert.equal((await store.load("b1", "document")).cards[0].question, "d");
});

test("store.load returns null for a board with no cards yet", async () => {
  const store = createCardsStore({ collection: fakeCollection() });
  assert.equal(await store.load("nope"), null);
});
