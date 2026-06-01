// Presence (avatars), live cursors, and chat relay.
//
// Presence is tracked in-memory per board. This is correct for a single
// process (the Render free tier runs one instance); horizontal scaling would
// require a shared store such as the Socket.IO Redis adapter.

const whiteboardUsers = {}; // { [whiteboardId]: [{ userId, username, socketId }] }

function registerPresenceHandlers(io, socket) {
  // Announce / refresh this user's presence on a board.
  socket.on("presence", ({ whiteboardId, userId, username }) => {
    if (!whiteboardId) return;
    if (!whiteboardUsers[whiteboardId]) whiteboardUsers[whiteboardId] = [];
    whiteboardUsers[whiteboardId] = whiteboardUsers[whiteboardId].filter(
      (u) => u.socketId !== socket.id
    );
    whiteboardUsers[whiteboardId].push({ userId, username, socketId: socket.id });
    io.to(whiteboardId).emit("whiteboardUsers", whiteboardUsers[whiteboardId]);
  });

  // Live cursor — high-frequency, never persisted, never echoed to sender.
  socket.on("cursorUpdate", (payload) => {
    if (!payload?.whiteboardId) return;
    socket.to(payload.whiteboardId).emit("cursorUpdate", payload);
  });

  // Chat relay (broadcast to the whole room, sender included).
  socket.on("chatMessage", (msg) => {
    if (!msg?.whiteboardId) return;
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
    }
  });
}

module.exports = { registerPresenceHandlers };
