// Monolith entry point.
//
// One Node process = Express REST (/api/*) + Socket.IO (/socket.io) + the
// static React build (client/dist). Deploys as a single Render Web Service.

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { toNodeHandler } = require("better-auth/node");

const config = require("./config");
const { connectDB } = require("./db");
const { initSocket } = require("./socket");
const { auth } = require("./auth");
const whiteboardRoutes = require("./routes/whiteboards");
const ocrRoutes = require("./routes/ocr");

const app = express();
// Render terminates TLS at a proxy; trust it so req.ip reflects the real client
// (needed for rate limiting to key per-user, not per-proxy).
app.set("trust proxy", 1);
const server = http.createServer(app);

const corsOrigin = config.CLIENT_ORIGIN || true;

const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] },
  maxHttpBufferSize: 1e7, // 10 MB
});

app.use(cors({ origin: corsOrigin, credentials: true }));

// BetterAuth handler must come BEFORE express.json() — it reads the raw body itself.
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json({ limit: "10mb" }));

// Liveness probe for Render (registered before the SPA fallback).
app.get("/healthz", (req, res) => res.sendStatus(200));

// REST API.
app.use("/api/whiteboards", whiteboardRoutes(io));
app.use("/api/whiteboards", ocrRoutes());

// Static client build + SPA fallback.
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
