"use strict";

// Persistence for the flashcards collection (D18/story 40): ONE collection per board
// per deck, holding the board's cards. Cards persist — a card's SM-2 schedule is
// long-lived study state, not a scroll-away message — so the collection is upserted
// by (boardId, deck) and read back whole. Regenerate overwrites the same collection
// with reconciled cards; there is never a second cards document for the same
// board+deck. Mirrors createNotesStore's one-record-per-board seam exactly.
//
//   const store = createCardsStore({ collection });   // inject the Mongo seam
//   await store.save(collection);                      // upsert by (boardId, deck)
//   await store.load(boardId, deck);                   // the collection, or null
//
// A collection's shape (see ./index.js):
//   { boardId, deck, cards: [ { id, question, answer, deck, boardId,
//                               sourceElementIds, reviewState } ] }
// The Mongo collection is injected (the DB seam) so the store is unit-tested with an
// in-memory fake behaving like a real collection's upsert/findOne, exactly as the
// notes store is. Production wiring passes a real collection from db.js.

const DEFAULT_DECK = "notes";

function createCardsStore({ collection } = {}) {
  if (!collection || typeof collection.updateOne !== "function") {
    throw new Error("createCardsStore: a Mongo collection is required");
  }

  async function save(coll) {
    if (!coll || !coll.boardId) {
      throw new Error("createCardsStore.save: a collection with a boardId is required");
    }
    const deck = coll.deck || DEFAULT_DECK;
    const cards = Array.isArray(coll.cards) ? coll.cards : [];
    await collection.updateOne(
      { boardId: coll.boardId, deck },
      {
        $set: {
          boardId: coll.boardId,
          deck,
          cards,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return { boardId: coll.boardId, deck, cards };
  }

  async function load(boardId, deck = DEFAULT_DECK) {
    if (!boardId) return null;
    return collection.findOne({ boardId, deck });
  }

  return { save, load };
}

module.exports = { createCardsStore, DEFAULT_DECK };
