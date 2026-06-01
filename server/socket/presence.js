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

function registerPresenceHandlers(io, socket) {
  // Announce / refresh this user's presence on a board. Dedupe by userId so a
  // user who reconnects or opens multiple tabs shows as ONE avatar (keep the
  // latest socket). Guests get a per-socket id so they remain distinct.
  socket.on("presence", ({ whiteboardId, userId, username }) => {
    if (!whiteboardId) return;
    if (!whiteboardUsers[whiteboardId]) whiteboardUsers[whiteboardId] = [];
    whiteboardUsers[whiteboardId] = whiteboardUsers[whiteboardId].filter(
      (u) => u.socketId !== socket.id && u.userId !== userId
    );
    whiteboardUsers[whiteboardId].push({ userId, username, socketId: socket.id });
    io.to(whiteboardId).emit("whiteboardUsers", whiteboardUsers[whiteboardId]);
  });

  // Live cursor — high-frequency, never persisted, never echoed to sender.
  socket.on("cursorUpdate", (payload) => {
    if (!payload?.whiteboardId) return;
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
    if (!msg?.whiteboardId) return;
    const list = (chatHistory[msg.whiteboardId] ||= []);
    list.push(msg);
    if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
    io.to(msg.whiteboardId).emit("chatMessage", msg);
  });

  // Clean up presence + notify collaborators on disconnect.
  socket.on("disconnect", () => {
    for (const [whiteboardId, users] of Object.entries(whiteboardUsers)) {
      const before = users.length;
      whiteboardUsers[whiteboardId] = users.filter(
        (u) => u.socketId !== socket.id
      );
      if (whiteboardUsers[whiteboardId].length !== before) {
        io.to(whiteboardId).emit(
          "whiteboardUsers",
          whiteboardUsers[whiteboardId]
        );
        // Tell remaining peers to drop this user's cursor.
        io.to(whiteboardId).emit("cursorLeave", { socketId: socket.id });
      }
      if (whiteboardUsers[whiteboardId].length === 0) {
        delete whiteboardUsers[whiteboardId];
      }
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
        delete chatHistory[boardId];
        delete whiteboardUsers[boardId];
      }
    }
  });
}

module.exports = { registerPresenceHandlers, getActiveBoardIds, getChatHistory };
