// Socket.IO wiring: handshake auth, room join + scene hydration, then delegate
// to the scene and presence handler modules.

const { socketAuth } = require("../middleware/auth");
const { registerSceneHandlers, loadScene } = require("./scene");
const { registerPresenceHandlers } = require("./presence");

function initSocket(io) {
  io.use(socketAuth);

  io.on("connection", (socket) => {
    socket.on("joinWhiteboard", async (whiteboardId) => {
      if (!whiteboardId) return;
      socket.join(whiteboardId);
      socket.whiteboardId = whiteboardId;

      // Hydrate this socket with the stored snapshot (or null for a new board).
      try {
        const scene = await loadScene(whiteboardId);
        socket.emit("sceneInit", scene);
      } catch (err) {
        console.error("[socket] sceneInit failed:", err.message);
        socket.emit("sceneInit", null);
      }
    });

    registerSceneHandlers(io, socket);
    registerPresenceHandlers(io, socket);
  });
}

module.exports = { initSocket };
