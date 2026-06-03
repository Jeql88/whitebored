// Monolith entry point.
//
// One Node process = Express REST (/api/*) + Socket.IO (/socket.io) + the
// static React build (client/dist). Deploys as a single Render Web Service.

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { toNodeHandler } = require("better-auth/node");

const config = require("./config");
const { connectDB, getCollections } = require("./db");
const { initSocket } = require("./socket");
const { auth } = require("./auth");
const { toObjectId } = require("./auth/boards");
const whiteboardRoutes = require("./routes/whiteboards");
const ocrRoutes = require("./routes/ocr");
const adminRoutes = require("./routes/admin");

const app = express();
// Render terminates TLS at a proxy; trust it so req.ip reflects the real client
// (needed for rate limiting to key per-user, not per-proxy).
app.set("trust proxy", 1);
const server = http.createServer(app);

// Fall back to localhost in dev; never open wildcard (true) with credentials.
const corsOrigin = config.CLIENT_ORIGIN || "http://localhost:5173";

const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] },
  maxHttpBufferSize: 1e7, // 10 MB
  // Detect ungraceful disconnects (mobile backgrounding, tab crash) faster so a
  // departed user's presence avatar is reaped within ~18s instead of ~45s when
  // the explicit `leaveWhiteboard` signal doesn't fire.
  pingInterval: 10000,
  pingTimeout: 8000,
});

app.use(cors({ origin: corsOrigin, credentials: true }));

// BetterAuth handler must come BEFORE express.json() — it reads the raw body itself.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "10mb" }));

// Liveness probe for Render (registered before the SPA fallback).
app.get("/healthz", (req, res) => res.sendStatus(200));

// REST API.
app.use("/api/admin", adminRoutes());
app.use("/api/whiteboards", whiteboardRoutes(io));
app.use("/api/whiteboards", ocrRoutes());

// Static client build + SPA fallback.
const clientDist = path.join(__dirname, "..", "client", "dist");
const indexHtmlPath = path.join(clientDist, "index.html");

// Dynamic OG meta for whiteboard share links — must come before express.static
// so bots/unfurlers get board-specific titles and thumbnails.
app.get("/whiteboard/:id", async (req, res, next) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return next();
    const { whiteboards } = getCollections();
    const board = await whiteboards.findOne(
      { _id },
      { projection: { name: 1, thumbnail: 1 } }
    );
    if (!board) return next();
    const esc = (s) => String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const name = esc(board.name || "Whiteboard");
    const image = board.thumbnail || `${config.BETTER_AUTH_URL}/og.png`;
    const url = `${config.BETTER_AUTH_URL}/whiteboard/${req.params.id}`;
    const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
    // Inject dynamic tags right after <head> — first og: tag wins in most parsers.
    const html = indexHtml.replace(
      "<head>",
      `<head>
    <meta property="og:title" content="${name} — Whitebored" />
    <meta property="og:description" content="Join ${name} on Whitebored — real-time collaborative whiteboard" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${image}" />
    <meta name="twitter:title" content="${name} — Whitebored" />
    <meta name="twitter:image" content="${image}" />`
    );
    res.type("html").send(html);
  } catch {
    next();
  }
});

app.use(express.static(clientDist));
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  res.sendFile(indexHtmlPath);
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
