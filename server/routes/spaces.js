// Spaces API (D21, wiring for slice #18). Mounted at /api/spaces.
//
//   GET  /api/spaces/me            → { space, isMember }  the V1 Space + membership
//   POST /api/spaces/join          → { space, isMember }   join it (idempotent)
//   GET  /api/spaces/:id/boards    → { boards }            the Space's boards
//   POST /api/spaces/:id/paper     → { paper }             combined mock paper
//   PUT  /api/spaces/:id/boards/:boardId    → share a board into the Space
//   DELETE /api/spaces/:id/boards/:boardId  → take it back out
//
// V1 is one Space everyone joins, so `GET /me` ensures it exists and reports
// whether the caller is in it. Membership is what widens search scope (the search
// route already reads memberSpaceIds) and what makes combined study possible —
// until someone joins, memberSpaceIds is [] and everything correctly falls back
// to per-board sharing.
//
// A Space is an ADDITIONAL grouping layer on top of per-board sharing, never a
// replacement: joining grants visibility of Space boards, it does not touch a
// board's own owner/editor/collaborator/visitor lists.

const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { getCollections } = require("../db");
const { createSpaceStore, createCombinedStudy } = require("../spaces");
const { toObjectId } = require("../auth/boards");

// Paper generation reads every Space board's cards; keep it modest per user.
const paperLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  key: (req) => req.user?.userId || req.ip,
});

module.exports = function spaceRoutes() {
  const router = express.Router();

  const store = () => createSpaceStore({ collection: getCollections().spaces });

  // The V1 Space, created on first ask so no migration or seed step is needed.
  router.get("/me", authMiddleware, async (req, res) => {
    const s = store();
    const space = await s.ensureDefaultSpace();
    res.json({
      space: { id: String(space._id), name: space.name },
      isMember: await s.isMember(space._id, req.user.userId),
    });
  });

  router.post("/join", authMiddleware, async (req, res) => {
    const s = store();
    const space = await s.ensureDefaultSpace();
    // Idempotent: joining twice is a no-op, so the client can call it freely.
    await s.join(space._id, req.user.userId);
    res.json({ space: { id: String(space._id), name: space.name }, isMember: true });
  });

  // Members only: the Space's boards are visible BECAUSE of membership, so a
  // non-member gets 403 rather than a filtered list that hints at what is there.
  router.get("/:id/boards", authMiddleware, async (req, res) => {
    const s = store();
    const spaceId = toObjectId(req.params.id);
    if (!spaceId || !(await s.isMember(spaceId, req.user.userId))) {
      return res.status(403).json({ error: "Join the space to see its boards" });
    }
    const { whiteboards } = getCollections();
    // spaceBoardIds returns string ids (its callers compare them as strings), so
    // they are converted back for the _id lookup here.
    const ids = (await s.spaceBoardIds(req.params.id, whiteboards))
      .map(toObjectId)
      .filter(Boolean);
    const boards = await whiteboards
      .find({ _id: { $in: ids } })
      .project({ name: 1, userId: 1, updatedAt: 1, spaceId: 1 })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json({ boards });
  });

  // A mock paper drawn from every Space board's existing verified cards. No model
  // call — it composes cards that were already generated and grounded per board.
  router.post("/:id/paper", authMiddleware, paperLimit, async (req, res) => {
    const s = store();
    const spaceId = toObjectId(req.params.id);
    if (!spaceId || !(await s.isMember(spaceId, req.user.userId))) {
      return res.status(403).json({ error: "Join the space to generate a paper" });
    }

    const { whiteboards, cards } = getCollections();
    const boardIds = await s.spaceBoardIds(req.params.id, whiteboards);
    try {
      const paper = await createCombinedStudy({ cardsCollection: cards }).generatePaper({
        spaceId: req.params.id,
        boardIds,
        deck: req.body?.deck,
        document: req.body?.document || null,
      });
      res.json({ paper });
    } catch (err) {
      console.error("[spaces] paper generation failed:", err.message);
      res.status(500).json({ error: "Couldn't generate a paper" });
    }
  });

  // Share a board into the Space (what actually puts it in the group's scope) or
  // take it back out. Only the board's OWNER decides this: Space membership grants
  // visibility of shared boards, it never grants the right to share someone else's.
  async function setBoardSpace(req, res, spaceIdValue) {
    const s = store();
    const spaceId = toObjectId(req.params.id);
    if (!spaceId || !(await s.isMember(spaceId, req.user.userId))) {
      return res.status(403).json({ error: "Join the space first" });
    }

    const { whiteboards } = getCollections();
    const boardId = toObjectId(req.params.boardId);
    if (!boardId) return res.status(404).json({ error: "Board not found" });

    const board = await whiteboards.findOne({ _id: boardId }, { projection: { userId: 1 } });
    if (!board) return res.status(404).json({ error: "Board not found" });
    if (board.userId !== req.user.userId) {
      return res.status(403).json({ error: "Only the board owner can share it to a space" });
    }

    // Stored as a STRING: memberSpaceIds returns strings and the search scope
    // compares against them, so the types must match or the widening finds nothing.
    await whiteboards.updateOne(
      { _id: boardId },
      spaceIdValue ? { $set: { spaceId: spaceIdValue } } : { $unset: { spaceId: "" } }
    );
    res.json({ boardId: req.params.boardId, spaceId: spaceIdValue || null });
  }

  router.put("/:id/boards/:boardId", authMiddleware, (req, res) =>
    setBoardSpace(req, res, req.params.id)
  );

  router.delete("/:id/boards/:boardId", authMiddleware, (req, res) =>
    setBoardSpace(req, res, null)
  );

  return router;
};
