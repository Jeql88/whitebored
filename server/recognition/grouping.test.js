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

test("a tall stroke does not chain unrelated content into one giant crop", () => {
  // The merge radius used to scale off the TALLER of two boxes, so a single long
  // arrow gave itself a radius of hundreds of pixels — and because merging is
  // transitive, that pulled a whole board into one crop. A real board then read
  // back as one blob of ~40 disconnected fragments, which no amount of prompting
  // could turn into structured notes.
  const crops = groupCrops([
    inkEl("tall", { x: 500, y: 0, width: 6, height: 400 }), // a long arrow-like stroke
    inkEl("left", { x: 0, y: 10, width: 30, height: 12 }), // separate note, ~470px away
    inkEl("right", { x: 900, y: 10, width: 30, height: 12 }), // separate note, ~400px away
  ]);

  // Three distinct pieces of content stay three crops, not one.
  assert.equal(crops.length, 3);
  const sizes = crops.map((c) => c.sourceElementIds.length).sort();
  assert.deepEqual(sizes, [1, 1, 1]);
});

test("strokes genuinely close together still merge into one crop", () => {
  // The bound must not go so far that letters of the same word split apart.
  const crops = groupCrops([
    inkEl("a", { x: 0, y: 0, width: 10, height: 14 }),
    inkEl("b", { x: 13, y: 0, width: 10, height: 14 }), // 3px gap — same word
  ]);

  assert.equal(crops.length, 1);
  assert.equal(crops[0].sourceElementIds.length, 2);
});

test("a stroke that OVERLAPS unrelated writing does not swallow the board", () => {
  // The real regression behind a 700-element, 2681x1537 crop. Two overlapping
  // boxes have a gap of ZERO on both axes, so the proximity test passed
  // unconditionally — an underline, a bracket or a container outline drawn ACROSS
  // the page therefore merged with every word it spanned, and transitivity then
  // chained the whole board into one crop. Proximity is only meaningful between
  // strokes of comparable scale.
  const crops = groupCrops([
    // A long underline spanning the page, overlapping both words' boxes.
    inkEl("underline", { x: 0, y: 20, width: 900, height: 3 }),
    inkEl("wordA", { x: 10, y: 8, width: 40, height: 16 }),
    inkEl("wordB", { x: 800, y: 8, width: 40, height: 16 }),
  ]);

  // The two words are far apart, so they stay separate — and neither is dragged
  // into the underline's crop.
  assert.equal(crops.length, 3);
  for (const c of crops) assert.equal(c.sourceElementIds.length, 1);
});

test("specks with no readable extent never become crops of their own", () => {
  // A real board carried crops of 0.85x0 and 0x3.4 px — stray taps and lifted-pen
  // artefacts. Rasterizing one scales it ~320x into a blank image, and each still
  // consumed a slot in a 12-image model request, crowding out real handwriting.
  const crops = groupCrops([
    inkEl("real", { x: 0, y: 0, width: 40, height: 16 }),
    inkEl("speck", { x: 600, y: 300, width: 0.85, height: 0 }),
    inkEl("sliver", { x: 700, y: 400, width: 0, height: 3.4 }),
    inkEl("dot", { x: 800, y: 500, width: 5.09, height: 1.69 }),
  ]);

  assert.equal(crops.length, 1);
  assert.deepEqual(crops[0].sourceElementIds, ["real"]);
});

test("a speck sitting inside real writing still rides along with it", () => {
  // Dropping specks must not lose the dot of an i that belongs to a word: it is
  // only dropped when it is ALONE, never when a real stroke claims it.
  const crops = groupCrops([
    inkEl("stem", { x: 0, y: 0, width: 8, height: 16 }),
    inkEl("tittle", { x: 2, y: -4, width: 1.5, height: 1.5 }),
  ]);

  assert.equal(crops.length, 1);
  assert.equal(crops[0].sourceElementIds.length, 2);
});
