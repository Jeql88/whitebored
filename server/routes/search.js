// Board content search. Mounted at /api/search.
//
// GET /api/search?q=<query>[&limit=<n>]
//   → 200 { query, results: [ { board, matchedFields } ] }
//
// Replaces the old client-side flat `textIndex` filter (D20). Search runs server-side
// over four board fields — name, transcriptionText, typedLabelsText, notesText —
// scoped to boards the caller can access (owner / editor / collaborator / visitor),
// exactly as the dashboard list is. Keyword/substring only, never sent to AI
// (stories 48–50). Each result reports which field matched (story 49).
//
// Exported as a factory for symmetry with the other route modules and so the search
// store (its DB seam) can be injected in a future integration test.

const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { getCollections } = require("../db");
const { createSearchStore, accessibleBoardsScope } = require("../search/store");
const { createSpaceStore } = require("../spaces");

const byUser = (req) => req.user?.userId || req.ip;
// Search is read-only and cheap, but bound it so a hot loop can't hammer Mongo.
const searchLimit = rateLimit({ windowMs: 60_000, max: 120, key: byUser });

module.exports = function searchRoutes() {
  const router = express.Router();

  router.get("/", authMiddleware, searchLimit, async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    // Parse an optional client limit, clamped to a sane ceiling.
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

    const { whiteboards, spaces } = getCollections();
    const store = createSearchStore({ collection: whiteboards });

    try {
      // Widen the D20 scope to the user's Spaces (D21): the SAME search mechanism runs,
      // only the access filter grows to include boards carrying a Space id the user has
      // joined. Membership LAYERS ON TOP of per-board sharing. Fail soft — if the Space
      // lookup errors, fall back to the per-board-sharing scope rather than 500ing search.
      let memberSpaceIds = [];
      try {
        memberSpaceIds = await createSpaceStore({ collection: spaces }).memberSpaceIds(req.user.userId);
      } catch (e) {
        console.error("[search] space scope lookup failed, falling back to own boards:", e.message);
      }
      const scope = accessibleBoardsScope(req.user.userId, memberSpaceIds);

      const results = await store.search({ query, scope, limit });
      res.json({ query: query.trim(), results });
    } catch (err) {
      console.error("[search]", err.message);
      res.status(500).json({ error: "Server error" });
    }
  });

  return router;
};
