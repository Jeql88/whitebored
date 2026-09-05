"use strict";

// Persistence for the coverage report (D16). ONE record per board, holding the
// stable topic list plus each topic's coverage status and the report totals. Upserted
// by boardId and read back whole — a re-run overwrites the same record with the
// reconciled topics (identities carried forward), so there is never a second coverage
// record for a board. Mirrors createFactCheckStore / createNotesStore exactly.
//
//   const store = createCoverageStore({ collection });   // inject the DB seam
//   await store.save({ boardId, topics, total, coveredCount, gapCount });
//   await store.load(boardId);                            // the record, or null
//
// The Mongo collection is injected (the DB seam) so the store is unit-tested with an
// in-memory fake behaving like a real collection's upsert/findOne, exactly as the
// notes / cards / fact-check stores are. Production wiring passes a real collection.
//
// A record's shape (see ./index.js):
//   { boardId, topics: [ { id, label, pageStart, pageEnd, status } ],
//     total, coveredCount, gapCount }
// The store persists it verbatim plus an updatedAt stamp; it does not judge, verify,
// or reshape topics — that is the coverage module's job. A dumb store keeps the seam
// clean.

function createCoverageStore({ collection } = {}) {
  if (!collection || typeof collection.updateOne !== "function") {
    throw new Error("createCoverageStore: a Mongo collection is required");
  }

  async function save(record) {
    if (!record || !record.boardId) {
      throw new Error("createCoverageStore.save: a record with a boardId is required");
    }
    const { boardId, topics, total, coveredCount, gapCount } = record;
    const safeTopics = Array.isArray(topics) ? topics : [];
    const $set = {
      boardId,
      topics: safeTopics,
      total: Number.isFinite(total) ? total : safeTopics.length,
      coveredCount: Number.isFinite(coveredCount)
        ? coveredCount
        : safeTopics.filter((t) => t.status === "covered").length,
      gapCount: Number.isFinite(gapCount)
        ? gapCount
        : safeTopics.filter((t) => t.status === "gap").length,
      updatedAt: new Date(),
    };
    await collection.updateOne({ boardId }, { $set }, { upsert: true });
    return { boardId, ...$set };
  }

  async function load(boardId) {
    if (!boardId) return null;
    return collection.findOne({ boardId });
  }

  return { save, load };
}

module.exports = { createCoverageStore };
