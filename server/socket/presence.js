// Presence (avatars), live cursors, and chat relay.
//
// Presence is tracked in-memory per board. This is correct for a single
// process (the Render free tier runs one instance); horizontal scaling would
// require a shared store such as the Socket.IO Redis adapter.

const whiteboardUsers = {}; // { [whiteboardId]: [{ userId, username, socketId }] }

// In-memory chat history per board. Persists while the board has people; we
// clear it once everyone has left (session-scoped, no DB). Capped per board.
const chatHistory = {}; // { [whiteboardId]: [msg, ...] }
const CHAT_MAX = 200;

// Board ids that currently have at least one distinct user present.
function getActiveBoardIds() {
  const ids = [];
  for (const [boardId, users] of Object.entries(whiteboardUsers)) {
    const distinct = new Set(users.map((u) => u.userId));
    if (distinct.size > 0) ids.push(boardId);
  }
  return ids;
}

function getChatHistory(whiteboardId) {
  return chatHistory[whiteboardId] || [];
}

// Free all in-memory state for a board (called when it's deleted, and as part
// of empty-room cleanup). Also clears the scene merge lock.
function clearBoardState(whiteboardId) {
  delete whiteboardUsers[whiteboardId];
  delete chatHistory[whiteboardId];
  try {
    require("./scene").clearBoardLock(whiteboardId);
  } catch {
    /* scene module may not expose it in some contexts */
  }
}

// Remove a socket from one board's presence list and notify the room. Shared by
// the explicit `leaveWhiteboard` event and the `disconnect` cleanup so both
// paths behave identically. Returns true if the presence list actually changed.
function removeSocketFromBoard(io, socket, whiteboardId) {
  const users = whiteboardUsers[whiteboardId];
  if (!users) return false;
  const before = users.length;
  whiteboardUsers[whiteboardId] = users.filter((u) => u.socketId !== socket.id);
  const changed = whiteboardUsers[whiteboardId].length !== before;
  if (changed) {
    io.to(whiteboardId).emit("whiteboardUsers", whiteboardUsers[whiteboardId]);
    // Tell remaining peers to drop this user's cursor.
    io.to(whiteboardId).emit("cursorLeave", { socketId: socket.id });
  }
  if (whiteboardUsers[whiteboardId].length === 0) {
    delete whiteboardUsers[whiteboardId];
  }
  return changed;
}

function registerPresenceHandlers(io, socket) {
  // Announce / refresh this user's presence on a board. Dedupe by userId so a
  // user who reconnects or opens multiple tabs shows as ONE avatar (keep the
  // latest socket). Guests get a per-socket id so they remain distinct.
  socket.on("presence", ({ whiteboardId, userId, username }) => {
    if (!whiteboardId || typeof whiteboardId !== "string") return;
    if (!socket.rooms.has(whiteboardId)) return; // must have joined first
    const uid = String(socket.user?.userId || socket.id).slice(0, 64);
    const name = String(socket.user?.username || "Guest").slice(0, 60);
    if (!whiteboardUsers[whiteboardId]) whiteboardUsers[whiteboardId] = [];
    whiteboardUsers[whiteboardId] = whiteboardUsers[whiteboardId].filter(
      (u) => u.socketId !== socket.id && u.userId !== uid
    );
    whiteboardUsers[whiteboardId].push({ userId: uid, username: name, socketId: socket.id });
    io.to(whiteboardId).emit("whiteboardUsers", whiteboardUsers[whiteboardId]);
  });

  // Explicit leave (client navigates away / hides the tab) — remove this user's
  // avatar immediately so peers don't wait for the ping timeout to notice.
  socket.on("leaveWhiteboard", (whiteboardId) => {
    if (!whiteboardId || typeof whiteboardId !== "string") return;
    removeSocketFromBoard(io, socket, whiteboardId);
  });

  // Live cursor — high-frequency, never persisted, never echoed to sender.
  socket.on("cursorUpdate", (payload) => {
    if (!payload?.whiteboardId) return;
    if (!socket.rooms.has(payload.whiteboardId)) return;
    socket.to(payload.whiteboardId).emit("cursorUpdate", payload);
  });

  // A late-opening chat panel asks for the current session history.
  socket.on("requestChatHistory", (whiteboardId) => {
    if (!whiteboardId) return;
    socket.emit("chatHistory", getChatHistory(whiteboardId));
  });

  // Chat relay (broadcast to the whole room, sender included) + retain in
  // memory for the session so a reload/reopen sees the history.
  socket.on("chatMessage", (msg) => {
    if (!msg?.whiteboardId || typeof msg.whiteboardId !== "string") return;
    if (!socket.rooms.has(msg.whiteboardId)) return; // must be in the board
    if (typeof msg.text !== "string" || !msg.text.trim()) return;
    // Normalize + cap to keep memory bounded; stamp a stable id for React keys.
    // Use server-authoritative identity — never trust client-supplied user fields.
    const clean = {
      id: `${socket.id}-${Date.now()}-${(chatHistory[msg.whiteboardId] || []).length}`,
      whiteboardId: msg.whiteboardId,
      text: msg.text.slice(0, 2000),
      user: String(socket.user?.username || "Guest").slice(0, 60),
      userId: String(socket.user?.userId || socket.id).slice(0, 64),
      time: new Date().toISOString(),
    };
    const list = (chatHistory[clean.whiteboardId] ||= []);
    list.push(clean);
    if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
    io.to(clean.whiteboardId).emit("chatMessage", clean);
  });

  // Clean up presence + notify collaborators on disconnect.
  socket.on("disconnect", () => {
    // Snapshot board ids first — removeSocketFromBoard can delete entries.
    for (const whiteboardId of Object.keys(whiteboardUsers)) {
      removeSocketFromBoard(io, socket, whiteboardId);
    }

    // Clear session chat once the board's room is truly empty. Room membership
    // (not the presence list) is the authoritative "anyone left?" signal — a
    // socket may join + chat without ever sending a presence event.
    const boardId = socket.whiteboardId;
    if (boardId) {
      // The disconnecting socket is removed from the room by the time
      // 'disconnect' fires, so a missing/zero room means nobody remains.
      const room = io.sockets.adapter.rooms.get(boardId);
      if (!room || room.size === 0) {
        clearBoardState(boardId);
      }
    }
  });
}

module.exports = {
  registerPresenceHandlers,
  getActiveBoardIds,
  getChatHistory,
  clearBoardState,
  whiteboardUsers,
};
