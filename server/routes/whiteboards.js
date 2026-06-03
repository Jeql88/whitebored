// Whiteboard CRUD + comments. Mounted at /api/whiteboards.
// Exported as a factory because the comment routes emit Socket.IO events.

const express = require("express");
const { ObjectId } = require("mongodb");
const { authMiddleware } = require("../middleware/auth");
const { getCollections } = require("../db");
const { getActiveBoardIds, clearBoardState } = require("../socket/presence");
const { canAccessBoard, toObjectId } = require("../auth/boards");


module.exports = function whiteboardRoutes(io) {
  const router = express.Router();

  // Reusable access guard for board sub-resources (comments, etc.).
  async function ensureAccess(req, res) {
    const { allowed } = await canAccessBoard(req.user, req.params.id).catch(() => ({ allowed: false }));
    if (!allowed) {
      res.status(403).json({ error: "Not authorized for this board" });
      return false;
    }
    return true;
  }

  // List boards owned by, or shared with, the current user.
  router.get("/", authMiddleware, async (req, res) => {
    const { whiteboards } = getCollections();
    const userId = req.user.userId;
    const boards = await whiteboards
      .find({ $or: [{ userId }, { editors: userId }] })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json(boards);
  });

  // Board ids with someone currently present (for the dashboard "live" badge).
  // Registered before /:id so it isn't captured as an id param.
  router.get("/active", authMiddleware, (req, res) => {
    res.json({ active: getActiveBoardIds() });
  });

  // Public board info (no auth) — used by the editor to show board name + access level
  // before the socket connects, including for guests.
  router.get("/:id/info", async (req, res) => {
    const { whiteboards } = getCollections();
    try {
      const board = await whiteboards.findOne(
        { _id: new ObjectId(req.params.id) },
        { projection: { name: 1, shareMode: 1, shareAccess: 1, userId: 1 } }
      );
      if (!board) return res.status(404).json({ error: "Not found" });
      res.json({
        name: board.name,
        shareMode: board.shareMode || "edit",
        shareAccess: board.shareAccess || "anyone",
        ownerId: board.userId,
      });
    } catch {
      res.status(400).json({ error: "Invalid board id" });
    }
  });

  // Update share settings (owner only).
  router.patch("/:id/share", authMiddleware, async (req, res) => {
    const { whiteboards } = getCollections();
    const whiteboardId = req.params.id;
    const userId = req.user.userId;
    const { shareMode, shareAccess } = req.body || {};
    const validModes = ["edit", "view"];
    const validAccess = ["anyone", "auth"];
    if (shareMode && !validModes.includes(shareMode)) return res.status(400).json({ error: "Invalid shareMode" });
    if (shareAccess && !validAccess.includes(shareAccess)) return res.status(400).json({ error: "Invalid shareAccess" });
    try {
      const updates = {};
      if (shareMode) updates.shareMode = shareMode;
      if (shareAccess) updates.shareAccess = shareAccess;
      const result = await whiteboards.updateOne(
        { _id: new ObjectId(whiteboardId), userId },
        { $set: updates }
      );
      if (result.matchedCount === 0) return res.status(404).json({ error: "Not found or unauthorized" });
      res.json({ success: true, shareMode, shareAccess });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Create a board.
  router.post("/", authMiddleware, async (req, res) => {
    const { whiteboards } = getCollections();
    const userId = req.user.userId;

    let name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) name = "Untitled";
    if (name.length > 120) name = name.slice(0, 120);
    const now = new Date();
    const whiteboard = { name, userId, createdAt: now, updatedAt: now };
    const result = await whiteboards.insertOne(whiteboard);
    res.json({ _id: result.insertedId, ...whiteboard });
  });

  // Rename a board (owner only).
  router.patch("/:id", authMiddleware, async (req, res) => {
    const { whiteboards } = getCollections();
    const whiteboardId = req.params.id;
    const userId = req.user.userId;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "New name is required" });

    try {
      const result = await whiteboards.updateOne(
        { _id: new ObjectId(whiteboardId), userId },
        { $set: { name, updatedAt: new Date() } }
      );
      if (result.matchedCount === 0) {
        return res
          .status(404)
          .json({ error: "Whiteboard not found or unauthorized" });
      }
      res.json({ success: true, message: "Whiteboard renamed" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Update a board's thumbnail (a small PNG data URL = last-seen scene).
  // Any editor (owner or collaborator) may set it. Capped to avoid bloat.
  router.put("/:id/thumbnail", authMiddleware, async (req, res) => {
    const { whiteboards } = getCollections();
    const whiteboardId = req.params.id;
    const userId = req.user.userId;
    const { thumbnail } = req.body || {};
    if (typeof thumbnail !== "string" || !thumbnail.startsWith("data:image/")) {
      return res.status(400).json({ error: "Invalid thumbnail" });
    }
    if (thumbnail.length > 200_000) {
      return res.status(413).json({ error: "Thumbnail too large" });
    }
    try {
      const result = await whiteboards.updateOne(
        { _id: new ObjectId(whiteboardId), $or: [{ userId }, { editors: userId }] },
        { $set: { thumbnail } }
      );
      if (result.matchedCount === 0) {
        return res.status(403).json({ error: "Not authorized for this board" });
      }
      res.json({ success: true });
    } catch {
      res.status(400).json({ error: "Could not save thumbnail" });
    }
  });

  // Delete a board + its scene snapshot + comments (owner only).
  router.delete("/:id", authMiddleware, async (req, res) => {
    const { whiteboards, scenes, comments } = getCollections();
    const whiteboardId = req.params.id;
    const userId = req.user.userId;

    try {
      const result = await whiteboards.deleteOne({
        _id: new ObjectId(whiteboardId),
        userId,
      });
      if (result.deletedCount === 0) {
        return res
          .status(404)
          .json({ error: "Whiteboard not found or unauthorized" });
      }
      await Promise.all([
        scenes.deleteOne({ whiteboardId }),
        comments.deleteMany({ whiteboardId }),
      ]);
      clearBoardState(whiteboardId); // free in-memory locks/presence/chat
      res.json({ success: true, message: "Whiteboard deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Duplicate a board (owner only) — copies metadata and scene snapshot.
  router.post("/:id/duplicate", authMiddleware, async (req, res) => {
    const { whiteboards, scenes } = getCollections();
    const userId = req.user.userId;
    const srcId = req.params.id;

    try {
      const src = await whiteboards.findOne({ _id: new ObjectId(srcId), userId });
      if (!src) return res.status(404).json({ error: "Whiteboard not found or unauthorized" });

      const now = new Date();
      const copy = {
        name: `${src.name} copy`,
        userId,
        createdAt: now,
        updatedAt: now,
        ...(src.thumbnail ? { thumbnail: src.thumbnail } : {}),
      };
      const result = await whiteboards.insertOne(copy);
      const newId = result.insertedId.toString();

      // Copy scene snapshot if one exists.
      const srcScene = await scenes.findOne({ whiteboardId: srcId });
      if (srcScene) {
        const { _id: _ignored, whiteboardId: _wid, ...sceneData } = srcScene;
        await scenes.insertOne({ ...sceneData, whiteboardId: newId });
      }

      res.json({ _id: result.insertedId, ...copy });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // --- Comments ---

  router.get("/:id/comments", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const { comments } = getCollections();
    const whiteboardId = req.params.id;
    const result = await comments
      .find({ whiteboardId })
      .sort({ createdAt: 1 })
      .toArray();
    res.json(result);
  });

  router.post("/:id/comments", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const { comments } = getCollections();
    const whiteboardId = req.params.id;
    const { text } = req.body;
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "No comment text" });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: "Comment too long" });
    }

    const userName = req.user.username || "Anonymous";

    const comment = {
      whiteboardId,
      userId: req.user.userId,
      userName,
      text,
      createdAt: new Date(),
    };
    const result = await comments.insertOne(comment);
    const payload = { ...comment, _id: result.insertedId };
    res.json(payload);
    io.to(whiteboardId).emit("newComment", payload);
  });

  router.delete(
    "/:id/comments/:commentId",
    authMiddleware,
    async (req, res) => {
      const { comments } = getCollections();
      const { id: whiteboardId, commentId } = req.params;
      const userId = req.user.userId;
      const result = await comments.deleteOne({
        _id: new ObjectId(commentId),
        whiteboardId,
        userId,
      });
      if (result.deletedCount === 0) {
        return res
          .status(404)
          .json({ error: "Comment not found or unauthorized" });
      }
      res.json({ success: true });
      io.to(whiteboardId).emit("deleteComment", { _id: commentId });
    }
  );

  return router;
};
