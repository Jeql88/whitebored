// Monolith entry point.
//
// One Node process = Express REST (/api/*) + Socket.IO (/socket.io) + the
// static React build (client/dist). Deploys as a single Render Web Service.

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const config = require("./config");
const { connectDB } = require("./db");
const { initSocket } = require("./socket");
const authRoutes = require("./routes/auth");
const whiteboardRoutes = require("./routes/whiteboards");

const app = express();
const server = http.createServer(app);

// Same-origin in production; allow the Vite dev origin otherwise. When
// CLIENT_ORIGIN is unset we fall back to `true` (reflect request origin),
// which is fine for a same-origin monolith and a public demo.
const corsOrigin = config.CLIENT_ORIGIN || true;

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ["GET", "POST", "PATCH", "DELETE"] },
  // Boards may include pasted images embedded in the scene payload.
  maxHttpBufferSize: 1e7, // 10 MB
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "10mb" }));

// Liveness probe for Render (registered before the SPA fallback).
app.get("/healthz", (req, res) => res.sendStatus(200));

// REST API.
app.use("/api/auth", authRoutes);
app.use("/api/whiteboards", whiteboardRoutes(io));

// Static client build + SPA fallback.
// Socket.IO owns /socket.io on the http server, so it never reaches Express.
// Express 5 note: `app.get("*")` throws — use a regex that excludes /api.
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

initSocket(io);

async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error("[startup] Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }
  server.listen(config.PORT, () => {
    console.log(
      `[startup] Whiteboard monolith listening on port ${config.PORT} (${config.NODE_ENV})`
    );
  });
}

start();
