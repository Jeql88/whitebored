"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { boardVersion, boardChangedSince } = require("./boardVersion");

const stroke = (id, over = {}) => ({
  id,
  type: "freedraw",
  x: 10,
  y: 20,
  width: 30,
  height: 40,
  points: [[0, 0], [1, 1]],
  ...over,
});

test("the same board yields the same version", () => {
  const a = [stroke("s1"), stroke("s2", { x: 100 })];
  const b = [stroke("s1"), stroke("s2", { x: 100 })];
  assert.equal(boardVersion(a), boardVersion(b));
});

test("re-ordering elements is not a change", () => {
  // Excalidraw re-orders elements when anything is selected. Treating that as a
  // change would re-read the board every time the user clicks a stroke.
  const a = [stroke("s1"), stroke("s2", { x: 100 })];
  const b = [stroke("s2", { x: 100 }), stroke("s1")];
  assert.equal(boardVersion(a), boardVersion(b));
});

test("styling and version churn are not changes", () => {
  // These fields change on nearly every interaction and never alter what the
  // model would read, so including them would defeat the whole check.
  const a = [stroke("s1")];
  const b = [
    stroke("s1", {
      strokeColor: "#ff0000",
      opacity: 40,
      version: 999,
      versionNonce: 12345,
      seed: 42,
      updated: Date.now(),
    }),
  ];
  assert.equal(boardVersion(a), boardVersion(b));
});

test("moving, resizing, adding, deleting or retyping IS a change", () => {
  const base = [stroke("s1"), { id: "t1", type: "text", x: 0, y: 0, width: 50, height: 20, text: "hello" }];
  const v = boardVersion(base);

  assert.notEqual(boardVersion([stroke("s1", { x: 999 }), base[1]]), v, "moved");
  assert.notEqual(boardVersion([stroke("s1", { width: 999 }), base[1]]), v, "resized");
  assert.notEqual(boardVersion([...base, stroke("s3")]), v, "added");
  assert.notEqual(boardVersion([base[1]]), v, "deleted");
  assert.notEqual(
    boardVersion([stroke("s1"), { ...base[1], text: "goodbye" }]),
    v,
    "retyped"
  );
});

test("a deleted element does not count as content", () => {
  const a = [stroke("s1")];
  const b = [stroke("s1"), stroke("gone", { isDeleted: true })];
  assert.equal(boardVersion(a), boardVersion(b));
});

test("a board never read before always needs reading", () => {
  assert.equal(boardChangedSince([stroke("s1")], null), true);
  assert.equal(boardChangedSince([stroke("s1")], undefined), true);
  assert.equal(boardChangedSince([stroke("s1")], ""), true);
});

test("an unchanged board needs no re-read", () => {
  const els = [stroke("s1"), stroke("s2", { y: 500 })];
  assert.equal(boardChangedSince(els, boardVersion(els)), false);
});

test("an empty board is a stable version, not a change every time", () => {
  assert.equal(boardVersion([]), boardVersion([]));
  assert.equal(boardChangedSince([], boardVersion([])), false);
});
