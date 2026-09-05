"use strict";

// Per-board coverage store (D16). Mirrors the fact-check store's one-record-per-board
// upsert seam. The Mongo collection is injected (the DB seam) and faked in-memory —
// no Mongo, no network.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createCoverageStore } = require("./store");

function fakeCollection() {
  const docs = [];
  return {
    docs,
    async updateOne(filter, update, opts) {
      const found = docs.find((d) => d.boardId === filter.boardId);
      if (found) Object.assign(found, update.$set);
      else if (opts && opts.upsert) docs.push({ ...filter, ...update.$set });
    },
    async findOne(filter) {
      return docs.find((d) => d.boardId === filter.boardId) || null;
    },
  };
}

function record(over = {}) {
  return {
    boardId: "b1",
    topics: [
      { id: "topic-0", label: "Cell structure", pageStart: 1, pageEnd: 1, status: "covered" },
      { id: "topic-1", label: "Photosynthesis", pageStart: 3, pageEnd: 3, status: "gap" },
    ],
    total: 2,
    coveredCount: 1,
    gapCount: 1,
    ...over,
  };
}

test("requires a Mongo collection", () => {
  assert.throws(() => createCoverageStore({}), /collection/);
});

test("saves and loads a per-board coverage record", async () => {
  const store = createCoverageStore({ collection: fakeCollection() });
  await store.save(record());
  const loaded = await store.load("b1");
  assert.equal(loaded.boardId, "b1");
  assert.equal(loaded.topics.length, 2);
  assert.equal(loaded.coveredCount, 1);
});

test("upserts by boardId — a second save overwrites the same board's record", async () => {
  const collection = fakeCollection();
  const store = createCoverageStore({ collection });
  await store.save(record());
  await store.save(record({ topics: [], total: 0, coveredCount: 0, gapCount: 0 }));
  assert.equal(collection.docs.length, 1);
  const loaded = await store.load("b1");
  assert.equal(loaded.topics.length, 0);
});

test("save rejects a record with no boardId (fail loud)", async () => {
  const store = createCoverageStore({ collection: fakeCollection() });
  await assert.rejects(() => store.save({ topics: [] }), /boardId/);
});

test("load of an unknown board returns null", async () => {
  const store = createCoverageStore({ collection: fakeCollection() });
  assert.equal(await store.load("nope"), null);
});
