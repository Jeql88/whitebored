"use strict";

// Per-board fact-check flag store (D15: "flags stored per board"). Mirrors the notes
// store's one-record-per-board upsert seam. The Mongo collection is injected (the DB
// seam) and faked in-memory here — no Mongo, no network.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createFactCheckStore } = require("./store");

// In-memory fake faithful to the slice of a Mongo collection the store uses:
// updateOne({filter},{ $set },{upsert}) and findOne({filter}).
function fakeCollection() {
  const docs = [];
  return {
    docs,
    async updateOne(filter, update, opts) {
      const found = docs.find((d) => d.boardId === filter.boardId);
      if (found) {
        Object.assign(found, update.$set);
      } else if (opts && opts.upsert) {
        docs.push({ ...filter, ...update.$set });
      }
    },
    async findOne(filter) {
      return docs.find((d) => d.boardId === filter.boardId) || null;
    },
  };
}

function record(over = {}) {
  return {
    boardId: "b1",
    flags: [
      {
        id: "f0",
        boardClaim: "Mitochondria make proteins",
        sourceClaim: "Mitochondria produce ATP",
        citation: { docId: "d1", page: 3 },
        severity: "high",
        status: "open",
      },
    ],
    ...over,
  };
}

test("requires a Mongo collection", () => {
  assert.throws(() => createFactCheckStore({}), /collection/);
});

test("saves and loads a per-board flags record", async () => {
  const store = createFactCheckStore({ collection: fakeCollection() });
  await store.save(record());
  const loaded = await store.load("b1");
  assert.equal(loaded.boardId, "b1");
  assert.equal(loaded.flags.length, 1);
  assert.equal(loaded.flags[0].sourceClaim, "Mitochondria produce ATP");
});

test("upserts by boardId — a second save overwrites the same board's record", async () => {
  const collection = fakeCollection();
  const store = createFactCheckStore({ collection });
  await store.save(record());
  await store.save(record({ flags: [] }));
  assert.equal(collection.docs.length, 1); // never a second record for the board
  const loaded = await store.load("b1");
  assert.equal(loaded.flags.length, 0);
});

test("save rejects a record with no boardId (fail loud)", async () => {
  const store = createFactCheckStore({ collection: fakeCollection() });
  await assert.rejects(() => store.save({ flags: [] }), /boardId/);
});

test("load of an unknown board returns null", async () => {
  const store = createFactCheckStore({ collection: fakeCollection() });
  assert.equal(await store.load("nope"), null);
});
