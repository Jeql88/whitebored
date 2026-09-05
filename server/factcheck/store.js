"use strict";

// Persistence for fact-check flags (D15: "flags stored per board"). ONE record per
// board, holding every flag the pass produced for that board plus each flag's
// review state (open / accepted / dismissed). The record is upserted by boardId and
// read back whole — a re-run of the pass overwrites the same record with the
// reconciled flag set (dismissals carried forward), so there is never a second
// flags record for a board. Mirrors createNotesStore's one-record-per-board seam.
//
//   const store = createFactCheckStore({ collection });   // inject the DB seam
//   await store.save({ boardId, flags });                  // upsert by boardId
//   await store.load(boardId);                             // the record, or null
//
// The Mongo collection is injected (the DB seam) so the store is unit-tested with an
// in-memory fake behaving like a real collection's upsert/findOne, exactly as the
// notes and cards stores are. Production wiring passes a real collection from db.js.
//
// A record's shape (see ./index.js):
//   { boardId, flags: [ { id, boardClaim, sourceClaim, citation:{docId,page},
//                         severity, status } ] }
// The store persists it verbatim plus an updatedAt stamp; it does not check, verify,
// or reshape flags — that is the fact-checker's job. Keeping the store dumb keeps the
// one seam clean.

function createFactCheckStore({ collection } = {}) {
  if (!collection || typeof collection.updateOne !== "function") {
    throw new Error("createFactCheckStore: a Mongo collection is required");
  }

  async function save(record) {
    if (!record || !record.boardId) {
      throw new Error("createFactCheckStore.save: a record with a boardId is required");
    }
    const { boardId, flags } = record;
    await collection.updateOne(
      { boardId },
      {
        $set: {
          boardId,
          flags: Array.isArray(flags) ? flags : [],
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return { boardId, flags: Array.isArray(flags) ? flags : [] };
  }

  async function load(boardId) {
    if (!boardId) return null;
    return collection.findOne({ boardId });
  }

  return { save, load };
}

module.exports = { createFactCheckStore };
