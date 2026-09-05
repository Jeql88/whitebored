"use strict";

// Scope persistence (D19): scope survives reload, so the bar shows the same thing
// the user left it showing. One record per board, mirroring the notes/cards stores.

const { applyDiff, defaultScope } = require("./index");

function createScopeStore({ collection } = {}) {
  if (!collection) throw new Error("createScopeStore: a Mongo collection is required");

  return {
    // Upsert by boardId — a board has exactly one current scope.
    async save({ boardId, scope } = {}) {
      if (!boardId) throw new Error("createScopeStore.save: boardId is required");
      const record = { boardId, scope: applyDiff(scope, {}), updatedAt: new Date() };
      await collection.updateOne({ boardId }, { $set: record }, { upsert: true });
      return record;
    },

    // An unseen board studies everything by default rather than erroring.
    async load(boardId) {
      const found = await collection.findOne({ boardId });
      return found ? applyDiff(found.scope, {}) : defaultScope();
    },
  };
}

module.exports = { createScopeStore };
