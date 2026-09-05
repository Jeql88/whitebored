"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createScopeStore } = require("./store");
const { defaultScope, applyDiff } = require("./index");

// A fake collection faithful to the upsert-by-boardId surface the store uses.
function fakeCollection() {
  const docs = new Map();
  return {
    docs,
    async updateOne(filter, update, options = {}) {
      const existing = docs.get(filter.boardId);
      if (!existing && !options.upsert) return { matchedCount: 0 };
      docs.set(filter.boardId, { ...(existing || {}), ...update.$set });
      return { matchedCount: 1 };
    },
    async findOne(filter) {
      return docs.get(filter.boardId) || null;
    },
  };
}

test("requires a Mongo collection", () => {
  assert.throws(() => createScopeStore({}), /collection is required/);
});

test("scope survives a reload — what was saved is what loads back", async () => {
  const store = createScopeStore({ collection: fakeCollection() });
  const scope = applyDiff(defaultScope(), { count: 25, difficulty: "hard" });

  await store.save({ boardId: "b1", scope });

  assert.deepEqual(await store.load("b1"), scope);
});

test("saving again replaces the board's scope rather than adding a second", async () => {
  const collection = fakeCollection();
  const store = createScopeStore({ collection });

  await store.save({ boardId: "b1", scope: defaultScope() });
  await store.save({ boardId: "b1", scope: applyDiff(defaultScope(), { count: 40 }) });

  assert.equal(collection.docs.size, 1);
  assert.equal((await store.load("b1")).count, 40);
});

test("a board with no saved scope loads the default rather than erroring", async () => {
  const store = createScopeStore({ collection: fakeCollection() });

  assert.deepEqual(await store.load("never-seen"), defaultScope());
});

test("save fails loud without a boardId", async () => {
  const store = createScopeStore({ collection: fakeCollection() });

  await assert.rejects(() => store.save({ scope: defaultScope() }), /boardId is required/);
});
