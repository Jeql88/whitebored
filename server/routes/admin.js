// Admin REST API — all routes require auth + admin role.
// Mounted at /api/admin in server/index.js.

const express = require("express");
const { ObjectId } = require("mongodb");
const { authMiddleware, adminMiddleware } = require("../middleware/auth");
const { getCollections } = require("../db");
const { getActiveBoardIds, whiteboardUsers } = require("../socket/presence");
const { toObjectId } = require("../auth/boards");

// Both middleware applied to every admin route via router-level use().
const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// Convenience: verify admin identity (used by client AdminRoute guard).
router.get("/me", (req, res) => res.json({ ok: true, userId: req.user.userId }));

// --- Stats ---

router.get("/stats", async (req, res) => {
  try {
    const { whiteboards, users, comments } = getCollections();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeBoardIds = getActiveBoardIds();

    const [totalUsers, totalBoards, totalComments, newBoards, boardsWithOcr] =
      await Promise.all([
        users.countDocuments(),
        whiteboards.countDocuments(),
        comments.countDocuments(),
        whiteboards.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
        whiteboards.countDocuments({ ocrText: { $exists: true, $ne: "" } }),
      ]);

    // Boards created per day for last 7 days
    const dailyPipeline = [
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];
    const dailyBoardsRaw = await whiteboards.aggregate(dailyPipeline).toArray();
    // Fill all 7 days so the chart always has a complete x-axis (missing days = 0).
    const dailyMap = Object.fromEntries(dailyBoardsRaw.map((d) => [d._id, d.count]));
    const dailyBoards = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.now() - (6 - i) * 86_400_000).toISOString().slice(0, 10);
      return { _id: date, count: dailyMap[date] || 0 };
    });

    res.json({
      totalUsers,
      totalBoards,
      totalComments,
      newBoards,
      boardsWithOcr,
      activeBoards: activeBoardIds.length,
      dailyBoards,
    });
  } catch (err) {
    console.error("[admin] stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Users ---

router.get("/users", async (req, res) => {
  try {
    const { users, whiteboards } = getCollections();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const search = (req.query.search?.trim() || "").slice(0, 100);
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const filter = escaped
      ? {
          $or: [
            { email: { $regex: escaped, $options: "i" } },
            { name: { $regex: escaped, $options: "i" } },
          ],
        }
      : {};

    const [total, userList] = await Promise.all([
      users.countDocuments(filter),
      users
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    // Single aggregation to count owned boards per user — avoids N+1 queries.
    const userIds = userList.map((u) => u.id || String(u._id));
    const boardCounts = await whiteboards.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]).toArray();
    const countMap = Object.fromEntries(boardCounts.map((r) => [r._id, r.count]));

    const withCounts = userList.map((u) => {
      const uid = u.id || String(u._id);
      return {
        id: uid,
        name: u.name || u.username || "",
        email: u.email || "",
        emailVerified: !!u.emailVerified,
        createdAt: u.createdAt,
        ownedBoards: countMap[uid] || 0,
      };
    });

    res.json({ users: withCounts, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("[admin] users error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/users/:id", async (req, res) => {
  try {
    const { users } = getCollections();
    const targetId = req.params.id;
    // Prevent self-deletion
    if (targetId === req.user.userId) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    // BetterAuth user docs key on _id (ObjectId), with no separate `id` field.
    // Match by either so deletion works regardless of how the id was passed.
    const oid = (() => { try { return new ObjectId(targetId); } catch { return null; } })();
    await users.deleteOne({ $or: [{ id: targetId }, ...(oid ? [{ _id: oid }] : [])] });
    res.json({ success: true });
  } catch (err) {
    console.error("[admin] delete user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Manually verify a user's email — used when no email sending is available.
router.patch("/users/:id/verify", async (req, res) => {
  try {
    const { users } = getCollections();
    const targetId = req.params.id;
    const oid = toObjectId(targetId);
    const result = await users.updateOne(
      { $or: [{ id: targetId }, ...(oid ? [{ _id: oid }] : [])] },
      { $set: { emailVerified: true } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: "User not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[admin] verify user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Boards ---

router.get("/boards", async (req, res) => {
  try {
    const { whiteboards, users } = getCollections();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const search = req.query.search?.trim() || "";
    const userId = req.query.userId?.trim() || "";

    const filter = {};
    if (search) filter.name = { $regex: search, $options: "i" };
    if (userId) filter.userId = userId;

    const [total, boardList] = await Promise.all([
      whiteboards.countDocuments(filter),
      whiteboards
        .find(filter, {
          projection: {
            name: 1,
            userId: 1,
            createdAt: 1,
            updatedAt: 1,
            editors: 1,
            ocrText: 1,
          },
        })
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    // Attach owner name — query by both `id` (BetterAuth string) and `_id`
    // (ObjectId) so Google OAuth users (keyed only by _id) resolve correctly.
    const ownerIds = [...new Set(boardList.map((b) => b.userId))];
    const owners = await users
      .find(
        { $or: [
          { id: { $in: ownerIds } },
          { _id: { $in: ownerIds.map((v) => toObjectId(v)).filter(Boolean) } },
        ]},
        { projection: { id: 1, name: 1, email: 1 } }
      )
      .toArray();
    const ownerMap = {};
    for (const o of owners) {
      const label = o.name || o.email || String(o._id);
      if (o.id) ownerMap[o.id] = label;
      if (o._id) ownerMap[String(o._id)] = label;
    }

    const result = boardList.map((b) => ({
      id: String(b._id),
      name: b.name,
      userId: b.userId,
      ownerName: ownerMap[b.userId] || "Unknown",
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      editorsCount: (b.editors || []).length,
      hasOcr: !!(b.ocrText),
    }));

    res.json({ boards: result, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("[admin] boards error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/boards/:id", async (req, res) => {
  try {
    const { whiteboards, scenes, comments } = getCollections();
    const boardId = req.params.id;
    let _id;
    try { _id = new ObjectId(boardId); } catch { return res.status(400).json({ error: "Invalid board ID" }); }
    await Promise.all([
      whiteboards.deleteOne({ _id }),
      scenes.deleteOne({ whiteboardId: boardId }),
      comments.deleteMany({ whiteboardId: boardId }),
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("[admin] delete board error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Live activity ---

router.get("/live", async (req, res) => {
  try {
    const { whiteboards } = getCollections();
    const activeBoardIds = getActiveBoardIds();

    if (!activeBoardIds.length) {
      return res.json({ boards: [], totalOnline: 0 });
    }

    const activeBoardDocs = await whiteboards
      .find(
        { _id: { $in: activeBoardIds.map((id) => { try { return new ObjectId(id); } catch { return null; } }).filter(Boolean) } },
        { projection: { name: 1 } }
      )
      .toArray();

    const nameMap = Object.fromEntries(activeBoardDocs.map((b) => [String(b._id), b.name]));

    const boards = activeBoardIds.map((id) => ({
      id,
      name: nameMap[id] || "Untitled",
      users: (whiteboardUsers[id] || []).map((u) => ({
        userId: u.userId,
        username: u.username,
        isGuest: u.userId === u.socketId,
      })),
    }));

    const totalOnline = new Set(
      boards.flatMap((b) => b.users.map((u) => u.userId))
    ).size;

    res.json({ boards, totalOnline });
  } catch (err) {
    console.error("[admin] live error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = () => router;
