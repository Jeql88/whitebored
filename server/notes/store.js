"use strict";

// Persistence for the Notes artifact (D6/story 8): ONE editable record per board.
// Notes persist — they are not a chat message that scrolls away — so the record is
// upserted by boardId and read back whole. Regenerate (slice #7) and edits later
// overwrite the same record; there is never a second notes record for a board.
//
//   const store = createNotesStore({ collection });   // inject the seam
//   await store.save(record);                          // upsert by boardId
//   await store.load(boardId);                         // the record, or null
//
// The Mongo collection is injected (the DB seam), so the store is unit-tested with
// an in-memory fake that behaves like a real collection's upsert/findOne. The
// production wiring passes a real collection from db.js.
//
// A record's shape is the D6 artifact (see ./index.js): { boardId, noteType,
// lines: [{ text, kind, sourceElementIds, origin }] }. The store persists it
// verbatim plus an updatedAt stamp; it does not generate, verify, or reshape —
// that is the generator's job. Keeping the store dumb keeps the one seam clean.

function createNotesStore({ collection } = {}) {
  if (!collection || typeof collection.updateOne !== "function") {
    throw new Error("createNotesStore: a Mongo collection is required");
  }

  async function save(record) {
    if (!record || !record.boardId) {
      throw new Error("createNotesStore.save: a record with a boardId is required");
    }
    const { boardId, noteType, lines } = record;
    await collection.updateOne(
      { boardId },
      {
        $set: {
          boardId,
          noteType,
          lines: Array.isArray(lines) ? lines : [],
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return record;
  }

  async function load(boardId) {
    if (!boardId) return null;
    return collection.findOne({ boardId });
  }

  return { save, load };
}

module.exports = { createNotesStore };
