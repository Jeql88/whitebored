"use strict";

// Behaviour tests for structure-first crop grouping (D1). Pure and deterministic
// — no clock, model, or network. We drive `groupCrops` only through its public
// interface and assert on the crops it returns (ids, kinds, membership, bbox),
// never on how it decides them.
//
// Excalidraw element shapes are reduced here to the fields grouping reads:
//   text        { type:"text", text, x, y, width, height, containerId? }
//   freedraw    { type:"freedraw", x, y, width, height, groupIds? }
//   rectangle   { type:"rectangle", x, y, width, height }
// Deleted elements carry isDeleted:true and must be ignored.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { groupCrops } = require("./grouping");

function textEl(id, text, box, extra = {}) {
  return { id, type: "text", text, ...box, ...extra };
}
function inkEl(id, box, extra = {}) {
  return { id, type: "freedraw", ...box, ...extra };
}
function rectEl(id, box, extra = {}) {
  return { id, type: "rectangle", ...box, ...extra };
}
function box(x, y, width, height) {
  return { x, y, width, height };
}

// Look up a crop by one of its source element ids.
function cropWith(crops, elementId) {
  return crops.find((c) => c.sourceElementIds.includes(elementId));
}

test("a typed text element becomes its own ground-truth crop, never OCR'd (story 2)", () => {
  const els = [textEl("t1", "Hello", box(0, 0, 50, 20))];

  const crops = groupCrops(els);

  assert.equal(crops.length, 1);
  const crop = crops[0];
  assert.equal(crop.kind, "text");
  assert.equal(crop.text, "Hello");
  assert.deepEqual(crop.sourceElementIds, ["t1"]);
  // Ground-truth crops carry the typed text; there is nothing for the model to read.
  assert.equal(crop.image, undefined);
});

test("a bound text label is grouped with its container, not left as a free crop (story 3)", () => {
  const els = [
    rectEl("r1", box(0, 0, 100, 60)),
    textEl("t1", "Approval", box(10, 20, 60, 20), { containerId: "r1" }),
  ];

  const crops = groupCrops(els);

  const crop = cropWith(crops, "r1");
  assert.ok(crop, "the rectangle's crop exists");
  // The bound label rides with its container in one crop, not a separate one.
  assert.ok(crop.sourceElementIds.includes("t1"));
  assert.equal(crops.length, 1);
});

test("elements sharing a groupId form one crop from the structural signal", () => {
  const els = [
    inkEl("f1", box(0, 0, 30, 30), { groupIds: ["g1"] }),
    inkEl("f2", box(200, 200, 30, 30), { groupIds: ["g1"] }),
  ];

  const crops = groupCrops(els);

  // Despite being far apart, a shared group binds them — structure beats distance.
  assert.equal(crops.length, 1);
  const crop = crops[0];
  assert.equal(crop.kind, "ink");
  assert.deepEqual(crop.sourceElementIds.sort(), ["f1", "f2"]);
});

test("freedraw strokes geometrically inside a rectangle join the rectangle's crop", () => {
  const els = [
    rectEl("r1", box(0, 0, 100, 100)),
    inkEl("f1", box(20, 20, 30, 20)), // fully inside r1
  ];

  const crops = groupCrops(els);

  assert.equal(crops.length, 1);
  const crop = cropWith(crops, "r1");
  assert.ok(crop.sourceElementIds.includes("f1"));
});

test("free-floating strokes with no structure cluster by distance (story 3, clustering)", () => {
  const els = [
    // Two nearby strokes (small gap relative to height) → one cluster.
    inkEl("f1", box(0, 0, 40, 40)),
    inkEl("f2", box(45, 0, 40, 40)),
    // A distant stroke → its own cluster.
    inkEl("f3", box(500, 500, 40, 40)),
  ];

  const crops = groupCrops(els);

  assert.equal(crops.length, 2);
  const near = cropWith(crops, "f1");
  assert.deepEqual(near.sourceElementIds.sort(), ["f1", "f2"]);
  const far = cropWith(crops, "f3");
  assert.deepEqual(far.sourceElementIds, ["f3"]);
});

test("clustering never pulls in structured strokes — only free-floating ones", () => {
  const els = [
    inkEl("g1a", box(0, 0, 40, 40), { groupIds: ["G"] }),
    // A free stroke right next to the grouped one; distance would merge them, but
    // the grouped stroke already has a structural home, so clustering leaves it be.
    inkEl("free", box(45, 0, 40, 40)),
  ];

  const crops = groupCrops(els);

  const grouped = cropWith(crops, "g1a");
  assert.deepEqual(grouped.sourceElementIds, ["g1a"]); // not joined by the free one
  const free = cropWith(crops, "free");
  assert.deepEqual(free.sourceElementIds, ["free"]);
  assert.equal(crops.length, 2);
});

test("deleted elements are ignored", () => {
  const els = [
    textEl("t1", "gone", box(0, 0, 50, 20), { isDeleted: true }),
    inkEl("f1", box(0, 0, 40, 40)),
  ];

  const crops = groupCrops(els);

  assert.equal(crops.length, 1);
  assert.deepEqual(crops[0].sourceElementIds, ["f1"]);
});

test("every crop carries a bbox enclosing its member elements", () => {
  const els = [
    inkEl("f1", box(10, 10, 20, 20)),
    inkEl("f2", box(40, 10, 20, 30)),
  ];

  const crops = groupCrops(els);

  assert.equal(crops.length, 1);
  const { bbox } = crops[0];
  assert.deepEqual(bbox, { x: 10, y: 10, width: 50, height: 30 });
});

test("crop ids are stable and unique", () => {
  const els = [
    inkEl("f1", box(0, 0, 40, 40)),
    inkEl("f2", box(500, 0, 40, 40)),
  ];

  const crops = groupCrops(els);
  const ids = crops.map((c) => c.cropId);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => assert.ok(id, "cropId is present"));
});
