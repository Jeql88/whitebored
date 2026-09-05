// Cards API (D17/D18, wiring for slices #8/#9). Mounted at /api/whiteboards, so
// every route is board-scoped and reuses the existing board access guard.
//
// Route contract:
//   GET  /:id/cards?deck=notes                 → { cards, deck }
//   POST /:id/cards/generate  { deck }         → { cards, deck }   (re)generate
//   POST /:id/cards/:cardId/grade { grade }    → { reviewState }
//
// This is the endpoint the full-screen study route (/whiteboard/:id/study) fetches
// from. Slice #9 shipped the client already degrading to an empty deck when it 404s,
// so nothing breaks for a board with no cards yet — GET simply returns [].
//
// Scheduling lives ONLY in server/cards/sm2.js: the client sends an SM-2 grade and
// the server computes the next reviewState, so there is one implementation of the
// schedule rather than a client copy that can drift.

const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { getCollections } = require("../db");
const { canAccessBoard } = require("../auth/boards");
const { createCardsStore, DEFAULT_DECK } = require("../cards/store");
const { createCardsFromGemini } = require("../cards");
const { createNotesStore } = require("../notes/store");
const { createGeminiFromConfig } = require("../gemini");
const { review } = require("../cards/sm2");
const config = require("../config");

// Generation is the expensive path (a model call); grading is cheap and frequent.
const generateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  key: (req) => req.user?.userId || req.ip,
});

module.exports = function cardRoutes({ store, notesStore, generator } = {}) {
  const router = express.Router();

  const resolveStore = () =>
    store || createCardsStore({ collection: getCollections().cards });
  const resolveNotesStore = () =>
    notesStore || createNotesStore({ collection: getCollections().notes });
  // Null when no Gemini key is configured — generation then degrades to a 503
  // rather than crashing, mirroring the OCR route's contract.
  const resolveGenerator = () =>
    generator !== undefined ? generator : createCardsFromGemini(createGeminiFromConfig(config));

  async function ensureAccess(req, res) {
    const { allowed } = await canAccessBoard(req.user, req.params.id).catch(
      () => ({ allowed: false })
    );
    if (!allowed) {
      res.status(403).json({ error: "Not authorized for this board" });
      return false;
    }
    return true;
  }

  // A board with no cards yet returns an empty deck, not a 404 — the study view
  // renders "nothing to study" rather than an error (degrade on the foreseen).
  router.get("/:id/cards", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const deck = req.query.deck || DEFAULT_DECK;
    const collection = await resolveStore().load(req.params.id, deck);
    res.json({ cards: collection?.cards || [], deck });
  });

  // Generate (or regenerate) a deck from the board's notes. Regeneration routes
  // through the shared reconcile primitive inside the generator, so a card the
  // user has already reviewed keeps its schedule.
  router.post("/:id/cards/generate", authMiddleware, generateLimit, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;

    const cards = resolveGenerator();
    if (!cards) {
      return res.status(503).json({ error: "Card generation is not configured" });
    }

    const boardId = req.params.id;
    const deck = req.body?.deck || DEFAULT_DECK;
    const notes = await resolveNotesStore().load(boardId);
    if (!notes || !Array.isArray(notes.lines) || notes.lines.length === 0) {
      return res.status(409).json({ error: "Generate notes before making cards" });
    }

    try {
      const store_ = resolveStore();
      const prior = (await store_.load(boardId, deck))?.cards || [];
      const collection = await cards.generate({
        notes,
        boardId,
        deck,
        prior,
        boardElementIds: req.body?.boardElementIds || [],
        elements: req.body?.elements || [],
        userId: req.user.userId,
      });
      await store_.save(collection);
      res.json({ cards: collection.cards, deck });
    } catch (err) {
      console.error("[cards] generation failed:", err.message);
      res.status(500).json({ error: "Card generation failed" });
    }
  });

  // Grade one card. The SM-2 schedule is computed HERE (server/cards/sm2.js) so
  // there is exactly one implementation of it.
  router.post("/:id/cards/:cardId/grade", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;

    const grade = Number(req.body?.grade);
    if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
      return res.status(400).json({ error: "grade must be an integer 0-5" });
    }

    const deck = req.body?.deck || DEFAULT_DECK;
    const store_ = resolveStore();
    const collection = await store_.load(req.params.id, deck);
    const card = collection?.cards?.find((c) => c.id === req.params.cardId);
    if (!card) return res.status(404).json({ error: "Card not found" });

    card.reviewState = review(card.reviewState, grade, { now: new Date() });
    await store_.save(collection);
    res.json({ reviewState: card.reviewState });
  });

  return router;
};
