// Socket.IO wiring: handshake auth, room join + scene hydration, then delegate
// to the scene and presence handler modules.

const { socketAuth } = require("../middleware/auth");
const { registerSceneHandlers, loadScene } = require("./scene");
const { registerPresenceHandlers, getChatHistory } = require("./presence");
const { canAccessBoard, getBoard, toObjectId } = require("../auth/boards");
const { getCollections } = require("../db");

function initSocket(io) {
  io.use(socketAuth);

  io.on("connection", (socket) => {
    socket.on("joinWhiteboard", async (whiteboardId) => {
      if (!whiteboardId) return;

      const { allowed, shareMode } = await canAccessBoard(socket.user, whiteboardId).catch(
        () => ({ allowed: false, shareMode: "edit" })
      );

      if (!allowed) {
        // Tell guest that auth is required for this board.
        socket.emit("accessDenied", {
          whiteboardId,
          reason: socket.user?.isGuest ? "auth_required" : "forbidden",
        });
        return;
      }

      // Attach shareMode to socket so scene handler can enforce view-only.
      socket.shareMode = shareMode;

      socket.join(whiteboardId);
      socket.whiteboardId = whiteboardId;

      // Hydrate this socket with the stored snapshot (or null for a new board).
      try {
        const scene = await loadScene(whiteboardId);
        socket.emit("sceneInit", { ...(scene || {}), shareMode });
      } catch (err) {
        console.error("[socket] sceneInit failed:", err.message);
        socket.emit("sceneInit", { shareMode });
      }

      socket.emit("chatHistory", getChatHistory(whiteboardId));

      // Track authenticated link visitors so the board appears in their
      // "Shared with me" dashboard — but only if they're not the owner or
      // an explicit collaborator (they already have a stronger relationship).
      const uid = socket.user?.userId;
      const _id = toObjectId(whiteboardId);
      if (uid && !socket.user?.isGuest && _id) {
        const { whiteboards } = getCollections();
        whiteboards
          .findOne({ _id }, { projection: { userId: 1, collaborators: 1, editors: 1 } })
          .then((board) => {
            if (!board) return;
            const isOwner = String(board.userId) === String(uid);
            const isCollab =
              (Array.isArray(board.collaborators) && board.collaborators.some((c) => String(c.userId) === String(uid))) ||
              (Array.isArray(board.editors) && board.editors.map(String).includes(String(uid)));
            if (!isOwner && !isCollab) {
              whiteboards.updateOne({ _id }, { $addToSet: { visitors: uid } }).catch(() => {});
            }
          })
          .catch(() => {});
      }
    });

    // Owner can change shareMode live — verify ownership before broadcasting.
    socket.on("shareModeChanged", async ({ whiteboardId, shareMode }) => {
      if (!whiteboardId || !socket.rooms.has(whiteboardId)) return;
      if (!["edit", "view"].includes(shareMode)) return;
      const board = await getBoard(whiteboardId).catch(() => null);
      if (!board || String(board.userId) !== String(socket.user?.userId)) return;
      socket.shareMode = shareMode;
      socket.to(whiteboardId).emit("shareModeChanged", { shareMode });
    });

    registerSceneHandlers(io, socket);
    registerPresenceHandlers(io, socket);
  });
}

module.exports = { initSocket };
