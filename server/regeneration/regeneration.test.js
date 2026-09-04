"use strict";

// Behaviour tests for the shared "protect what's yours across regeneration"
// primitive. Everything here is pure and deterministic — no clock, no model, no
// network. We drive the module only through its public `reconcile` interface and
// assert on what it returns, never on how it computes the match.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { reconcile, identityOf } = require("./index");

// A card, to prove the primitive is not notes-specific: different carried state
// (`reviewState`), a different fingerprint (the question), matched the same way.
function card(id, question, sourceElementIds, reviewState) {
  return { id, question, sourceElementIds, reviewState };
}

// A note line, the D6 shape reduced to what matching cares about. Extra fields
// (here `userEdited`, `text`) ride along untouched — the primitive is generic and
// never inspects a consumer's own state.
function noteLine(id, text, sourceElementIds, extra = {}) {
  return { id, text, sourceElementIds, ...extra };
}

test("an item whose shapes and fingerprint are unchanged carries its prior state forward", () => {
  const prior = [noteLine("p1", "Mitosis has four phases", ["shapeA"], { userEdited: true })];
  const next = [noteLine("n1", "Mitosis has four phases", ["shapeA"])];

  const result = reconcile({
    prior,
    next,
    boardElementIds: ["shapeA"],
    fingerprint: (item) => item.text,
  });

  // One matched pair, classified unchanged; the carried state is the PRIOR item
  // (that is what holds the user's edit), not the freshly generated one.
  assert.equal(result.items.length, 1);
  const entry = result.items[0];
  assert.equal(entry.status, "unchanged");
  assert.equal(entry.prior, prior[0]);
  assert.equal(entry.next, next[0]);
  assert.deepEqual(result.retired, []);
});

test("a next item with no matching prior is new (no prior state to carry)", () => {
  const prior = [noteLine("p1", "Mitosis has four phases", ["shapeA"])];
  const next = [
    noteLine("n1", "Mitosis has four phases", ["shapeA"]),
    noteLine("n2", "Meiosis produces gametes", ["shapeB"]),
  ];

  const result = reconcile({
    prior,
    next,
    boardElementIds: ["shapeA", "shapeB"],
    fingerprint: (item) => item.text,
  });

  const fresh = result.items.find((e) => e.next.id === "n2");
  assert.equal(fresh.status, "new");
  assert.equal(fresh.prior, null);
});

test("a prior item with no match in next is retired", () => {
  const prior = [
    noteLine("p1", "Mitosis has four phases", ["shapeA"]),
    noteLine("p2", "An obsolete line", ["shapeZ"]),
  ];
  const next = [noteLine("n1", "Mitosis has four phases", ["shapeA"])];

  const result = reconcile({
    prior,
    next,
    boardElementIds: ["shapeA", "shapeZ"],
    fingerprint: (item) => item.text,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.retired.length, 1);
  assert.equal(result.retired[0], prior[1]);
});

test("a fingerprint match whose board shapes are gone is not carried forward as unchanged", () => {
  // The prior line's shape was deleted from the board. Even though the freshly
  // generated line reads identically, the content no longer traces to anything the
  // user drew, so we must not silently resurrect the old (edited) state under it.
  const prior = [noteLine("p1", "Mitosis has four phases", ["shapeA"], { userEdited: true })];
  const next = [noteLine("n1", "Mitosis has four phases", ["shapeA"])];

  const result = reconcile({
    prior,
    next,
    boardElementIds: [], // shapeA no longer exists
    fingerprint: (item) => item.text,
  });

  assert.equal(result.items[0].status, "new");
  // And the orphaned prior state is retired, not left dangling.
  assert.equal(result.retired[0], prior[0]);
});

test("items come back in next order, one entry per next item", () => {
  const prior = [noteLine("p1", "B", ["shapeB"])];
  const next = [
    noteLine("n1", "A", ["shapeA"]),
    noteLine("n2", "B", ["shapeB"]),
    noteLine("n3", "C", ["shapeC"]),
  ];

  const result = reconcile({
    prior,
    next,
    boardElementIds: ["shapeA", "shapeB", "shapeC"],
    fingerprint: (item) => item.text,
  });

  assert.deepEqual(
    result.items.map((e) => [e.next.id, e.status]),
    [
      ["n1", "new"],
      ["n2", "unchanged"],
      ["n3", "new"],
    ],
  );
});

test("sourceElementIds match regardless of order or duplication", () => {
  // The same shapes drawn/listed in a different order (or repeated) are the same
  // source — a shape reorder on the board must not look like a deletion.
  const prior = [noteLine("p1", "Cycle", ["shapeA", "shapeB"])];
  const next = [noteLine("n1", "Cycle", ["shapeB", "shapeA"])];

  const result = reconcile({
    prior,
    next,
    boardElementIds: ["shapeB", "shapeA"],
    fingerprint: (item) => item.text,
  });

  assert.equal(result.items[0].status, "unchanged");
  assert.equal(result.items[0].prior, prior[0]);
});

test("one prior is claimed by at most one next item; the rest are new", () => {
  // Two next lines share a fingerprint but there is only one prior to carry
  // forward. Exactly one gets the prior state; the other is genuinely new.
  const prior = [noteLine("p1", "Phase", ["shapeA"], { userEdited: true })];
  const next = [
    noteLine("n1", "Phase", ["shapeA"]),
    noteLine("n2", "Phase", ["shapeA"]),
  ];

  const result = reconcile({
    prior,
    next,
    boardElementIds: ["shapeA"],
    fingerprint: (item) => item.text,
  });

  const statuses = result.items.map((e) => e.status).sort();
  assert.deepEqual(statuses, ["new", "unchanged"]);
  const carried = result.items.filter((e) => e.prior !== null);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].prior, prior[0]);
  assert.deepEqual(result.retired, []);
});

test("carried-forward state is the whole prior object, so any consumer field survives", () => {
  // The primitive never reads `reviewState`; it hands back the prior object intact
  // so a card consumer keeps its SM-2 schedule across a regenerate (D18).
  const schedule = { ease: 2.5, interval: 6, dueDate: "2026-09-20", lapses: 0 };
  const prior = [card("p1", "What follows Approval?", ["arrow1"], schedule)];
  const next = [card("n1", "What follows Approval?", ["arrow1"], undefined)];

  const result = reconcile({
    prior,
    next,
    boardElementIds: ["arrow1"],
    fingerprint: (item) => item.question,
  });

  assert.equal(result.items[0].status, "unchanged");
  // Same reference back — no copying, no field inspection by the primitive.
  assert.equal(result.items[0].prior.reviewState, schedule);
});

test("identityOf exposes the fingerprint + normalized source used for matching", () => {
  const item = noteLine("p1", "Mitosis", ["shapeB", "shapeA", "shapeB"]);
  const id = identityOf(item, (i) => i.text);

  assert.equal(id.fingerprint, "Mitosis");
  // De-duplicated and order-normalized, matching how reconcile compares sources.
  assert.deepEqual(id.sourceElementIds, ["shapeA", "shapeB"]);
});

test("a missing fingerprint function fails loud rather than mis-matching silently", () => {
  assert.throws(
    () => reconcile({ prior: [], next: [], boardElementIds: [] }),
    /fingerprint/,
  );
});
