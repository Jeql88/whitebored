// Whiteboard CRUD + comments. Mounted at /api/whiteboards.
// Exported as a factory because the comment routes emit Socket.IO events.

const express = require("express");
const { ObjectId } = require("mongodb");
const { authMiddleware } = require("../middleware/auth");
const { getCollections } = require("../db");

module.exports = function whiteboardRoutes(io) {
  const router = express.Router();

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

  // Create a board.
  router.post("/", authMiddleware, async (req, res) => {
    const { whiteboards } = getCollections();
    const { name } = req.body;
    const now = new Date();
    const whiteboard = {
      name,
      userId: req.user.userId,
      createdAt: now,
      updatedAt: now,
    };
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

  // Delete a board + its scene snapshot (owner only).
  router.delete("/:id", authMiddleware, async (req, res) => {
    const { whiteboards, scenes } = getCollections();
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
      await scenes.deleteOne({ whiteboardId });
      res.json({ success: true, message: "Whiteboard deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // --- Comments ---

  router.get("/:id/comments", authMiddleware, async (req, res) => {
    const { comments } = getCollections();
    const whiteboardId = req.params.id;
    const result = await comments
      .find({ whiteboardId })
      .sort({ createdAt: 1 })
      .toArray();
    res.json(result);
  });

  router.post("/:id/comments", authMiddleware, async (req, res) => {
    const { comments, users } = getCollections();
    const whiteboardId = req.params.id;
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No comment text" });

    let userName = "Anonymous";
    try {
      const user = await users.findOne({ _id: new ObjectId(req.user.userId) });
      userName = user?.username || user?.name || "Anonymous";
    } catch {
      // Guests / non-ObjectId ids — fall back to the token username.
      userName = req.user.username || "Anonymous";
    }

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
