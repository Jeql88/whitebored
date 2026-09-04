// Socket.IO wiring: handshake auth, room join + scene hydration, then delegate
// to the scene and presence handler modules.

const { socketAuth } = require("../middleware/auth");
const { registerSceneHandlers, loadScene } = require("./scene");
const { registerPresenceHandlers, getChatHistory } = require("./presence");
const { registerNotesHandlers } = require("../notes/socketNotes");
const { createNotesFromGemini } = require("../notes");
const { createNotesStore } = require("../notes/store");
const { createGeminiFromConfig } = require("../gemini");
const config = require("../config");
const { canAccessBoard, getBoard, toObjectId } = require("../auth/boards");
const { getCollections } = require("../db");

// Max simultaneous Socket.IO connections per IP — prevents a single client
// from opening hundreds of sockets to inflate broadcast traffic or memory.
const MAX_CONNS_PER_IP = 10;
const connsByIp = new Map(); // ip -> Set of socket ids

function initSocket(io) {
  io.use(socketAuth);

  // Build the Notes streaming pipeline once (D6/D9). All Gemini access is through
  // the central module; if no key is configured the generator is null and the
  // notes handler is simply not registered — the feature degrades gracefully
  // (mirrors the OCR route's 503 path) rather than crashing collab.
  const notesGenerator = createNotesFromGemini(createGeminiFromConfig(config));

  io.on("connection", (socket) => {
    // Connection cap per IP.
    const ip = socket.handshake.headers["x-forwarded-for"]?.split(",")[0].trim()
      || socket.handshake.address;
    if (!connsByIp.has(ip)) connsByIp.set(ip, new Set());
    const ipConns = connsByIp.get(ip);
    if (ipConns.size >= MAX_CONNS_PER_IP) {
      socket.disconnect(true);
      return;
    }
    ipConns.add(socket.id);
    socket.on("disconnect", () => {
      ipConns.delete(socket.id);
      if (ipConns.size === 0) connsByIp.delete(ip);
    });
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

    // Notes streaming (D6/D9) — only when Gemini is configured. The store is built
    // per-connection so it picks up collections after connectDB resolved; access is
    // gated through the same canAccessBoard seam the scene handlers use.
    if (notesGenerator) {
      const store = createNotesStore({ collection: getCollections().notes });
      registerNotesHandlers(socket, {
        generator: notesGenerator,
        store,
        canAccess: canAccessBoard,
      });
    }
  });
}

module.exports = { initSocket };
