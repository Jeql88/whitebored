// Socket.IO wiring: handshake auth, room join + scene hydration, then delegate
// to the scene and presence handler modules.

const { socketAuth } = require("../middleware/auth");
const { registerSceneHandlers, loadScene } = require("./scene");
const { registerPresenceHandlers, getChatHistory } = require("./presence");
const { registerNotesHandlers } = require("../notes/socketNotes");
const { createNotesFromGemini } = require("../notes");
const { createNotesStore } = require("../notes/store");
const { createNotesRegenerator } = require("../notes/regenerate");
const { createGeminiFromConfig } = require("../gemini");
const { registerChatHandlers } = require("../aichat/socketChat");
const { createChatResponder } = require("../aichat");
const { createRetriever } = require("../retrieval");
const { createChunkStore } = require("../retrieval/store");
const { createDocumentStore } = require("../documents");
const config = require("../config");
const { canAccessBoard, getBoard, toObjectId } = require("../auth/boards");
const { getCollections, db } = require("../db");

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
  const gemini = createGeminiFromConfig(config);
  const notesGenerator = createNotesFromGemini(gemini);

  // AI-chat responder (D10/D11 — the "Chat" tab). Built once, gated on Gemini being
  // configured (same graceful-degradation contract as notes: no key → no handler,
  // collab still runs). The retriever is the retrieved-document-chunk context bucket
  // (slice #12): it needs embeddings, so it is only wired when the client supports
  // embed(). The chunk collection is accessed via the raw db handle WITHOUT adding an
  // index in db.js (mirrors slice #11's lazy document access). If no chunks are
  // indexed yet, retrieve() simply returns [] and the chat still answers from the
  // board or general knowledge.
  const chatResponder = (() => {
    if (!gemini || typeof gemini.embed !== "function") return null;
    try {
      const documents = createDocumentStore({
        bucket: new (require("mongodb").GridFSBucket)(db, { bucketName: "documents" }),
        collection: db.collection("documents"),
      });
      const chunks = createChunkStore({ collection: db.collection("documentChunks") });
      const retriever = createRetriever({ gemini, chunks, documents });
      return createChatResponder({
        gemini,
        retrieve: (query, scope) => retriever.retrieve(query, scope),
        documents,
      });
    } catch (err) {
      console.error("[aichat] responder wiring failed, AI chat disabled:", err.message);
      return null;
    }
  })();

  // Flatten a board's stored text into the "board" context bucket for the AI chat:
  // the persisted Notes artifact lines plus the board's extracted-text fields (the
  // same fields the D20 search indexes). Read-only; degrades to "" on any miss so a
  // chat still runs (and simply can't earn a board tag) when a board has no text yet.
  async function boardTextFor(boardId) {
    const parts = [];
    try {
      const notes = await getCollections().notes.findOne({ boardId });
      if (notes && Array.isArray(notes.lines)) {
        for (const line of notes.lines) {
          if (line && typeof line.text === "string") parts.push(line.text);
        }
      }
    } catch { /* no notes yet */ }
    try {
      const _id = toObjectId(boardId);
      if (_id) {
        const board = await getCollections().whiteboards.findOne(
          { _id },
          { projection: { transcriptionText: 1, typedLabelsText: 1, notesText: 1 } }
        );
        for (const f of ["transcriptionText", "typedLabelsText", "notesText"]) {
          if (board && typeof board[f] === "string") parts.push(board[f]);
        }
      }
    } catch { /* no board text yet */ }
    return parts.join("\n");
  }

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
        // Regeneration composes the same generator with the shared reconcile
        // primitive, so it is wired wherever generation is (D7).
        regenerator: createNotesRegenerator({ generator: notesGenerator }),
        store,
        canAccess: canAccessBoard,
      });
    }

    // AI-chat channel (D10) — the "Chat" tab, separate from the human "Room" chat.
    // Gated on the responder being wired (Gemini configured with embeddings); access
    // rides the same canAccessBoard seam, board context through boardTextFor.
    if (chatResponder) {
      registerChatHandlers(socket, {
        responder: chatResponder,
        canAccess: canAccessBoard,
        boardText: boardTextFor,
      });
    }
  });
}

module.exports = { initSocket };
