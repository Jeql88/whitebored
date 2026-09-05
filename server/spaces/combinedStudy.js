"use strict";

// Combined study across a Space (D21 / story 53). "Generate a mock paper from the
// combined boards with a document attached, so we can build a revision plan from what
// we collectively missed."
//
//   const study = createCombinedStudy({ cardsCollection });
//   const paper = await study.generatePaper({ spaceId, boardIds, deck, document });
//
// This is the SPACE-LEVEL analogue of a single board's study view (slice #9). Where a
// board study session draws its cards from ONE board's cards collection, a combined
// paper unions the cards of EVERY board in the Space (the `boardIds` the caller resolves
// via spaceBoardIds) into one paper. It reuses the slice-#17 cards records as-is — no
// model call, no new card generation — so a combined paper is instant and free, exactly
// like search (story 50 spirit): it is a re-view of cards already generated per board.
//
// HONESTY (D17). Decks are NEVER merged: a paper is scoped to one `deck` ("notes" by
// default — the shapes-only deck), so a notes-deck paper can never pull in document-deck
// cards. The paper carries the same plain disclaimer the single-board mock exam does
// (story 38): it is built from the group's notes, not a real-exam prediction.
//
// DOCUMENT (story 53). An optional attached document rides along on the paper as a
// reference for building the revision plan (which past-paper topics the combined boards
// do/don't cover). It is a reference the client renders/deep-links (D13), not a source
// the questions are generated from — questions come only from the boards' verified
// cards, keeping the §7 grounding promise. A paper generates fine with no document
// (story 25 spirit: documents are an enhancement, never a requirement).
//
// The cards collection is injected (the DB seam), unit-tested with an in-memory fake —
// no real Mongo, no network. Production wiring passes the real `cards` collection.

const DEFAULT_DECK = "notes";

// The plain honesty disclaimer carried on every mock paper (story 38, D17). A view
// property, not a source of truth — the client renders it verbatim.
const PAPER_DISCLAIMER =
  "This mock paper is generated from the group's notes and is not a prediction of a " +
  "real exam.";

function createCombinedStudy({ cardsCollection } = {}) {
  if (!cardsCollection || typeof cardsCollection.find !== "function") {
    throw new Error("createCombinedStudy: a cards collection is required");
  }

  // Turn a stored card into a paper question — a view of the same card data (D17: the
  // exam and flashcards are two views of one record). Carries the board + source so the
  // client can trace each question back to the shape/board it came from (story 36).
  function toQuestion(card, boardId) {
    return {
      id: card.id,
      boardId,
      question: card.question,
      answer: card.answer,
      deck: card.deck,
      sourceElementIds: Array.isArray(card.sourceElementIds) ? card.sourceElementIds : [],
      ...(card.citation ? { citation: card.citation } : {}),
      ...(card.relationship ? { relationship: true } : {}),
    };
  }

  // generatePaper({ spaceId, boardIds, deck, document })
  //   - spaceId:  stamped on the paper (which Space it summarises)
  //   - boardIds: the combined boards to draw cards from (resolved by the caller via
  //               spaceBoardIds — the Space's boards)
  //   - deck:     which deck to build from ("notes" default — never merged with another)
  //   - document: an optional attached reference { docId, filename, … } or null
  async function generatePaper({ spaceId, boardIds = [], deck = DEFAULT_DECK, document = null } = {}) {
    // No boards → an empty paper, not an error (degrade on the foreseen).
    if (!Array.isArray(boardIds) || boardIds.length === 0) {
      return { spaceId, deck, questions: [], document: document || null, disclaimer: PAPER_DISCLAIMER };
    }

    // Union the per-board cards collections for THIS deck only. The `deck` filter is the
    // honesty constraint enforced as a query (D17) — the query never returns another
    // deck's cards, so a merged list is impossible.
    const collections = await cardsCollection
      .find({ boardId: { $in: boardIds }, deck })
      .toArray();

    const questions = [];
    for (const coll of collections) {
      if (!coll || !Array.isArray(coll.cards)) continue;
      for (const card of coll.cards) {
        if (!card || card.deck !== deck) continue; // defence in depth on the honesty rule
        questions.push(toQuestion(card, coll.boardId));
      }
    }

    return {
      spaceId,
      deck,
      questions,
      document: document || null,
      disclaimer: PAPER_DISCLAIMER,
    };
  }

  return { generatePaper };
}

module.exports = { createCombinedStudy, PAPER_DISCLAIMER, DEFAULT_DECK };
