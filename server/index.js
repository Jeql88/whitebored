// API + Socket.IO server.
//
// One Node process = Express REST (/api/*) + Socket.IO (/socket.io).
// Static frontend is served separately from Vercel.

const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { toNodeHandler } = require("better-auth/node");

const compression = require("compression");
const config = require("./config");
const { connectDB, getCollections, client } = require("./db");
const { initSocket } = require("./socket");
const { auth } = require("./auth");
const whiteboardRoutes = require("./routes/whiteboards");
const ocrRoutes = require("./routes/ocr");
const adminRoutes = require("./routes/admin");

const app = express();
// Railway terminates TLS at a proxy; trust it so req.ip reflects the real client
// (needed for rate limiting to key per-user, not per-proxy).
app.set("trust proxy", 1);
const server = http.createServer(app);

// Build the set of allowed origins. Strip trailing slashes so the cors()
// exact-match check doesn't fail on "https://foo.com/" vs "https://foo.com".
const allowedOrigins = [
  config.CLIENT_ORIGIN,
  "http://localhost:5173",
  "http://localhost:4000",
].filter(Boolean).map(o => o.replace(/\/$/, ""));

function corsOriginFn(origin, callback) {
  // Same-origin requests (e.g. curl, server-to-server) have no Origin header.
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  callback(new Error(`CORS: origin not allowed — ${origin}`));
}

const io = new Server(server, {
  cors: { origin: corsOriginFn, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] },
  maxHttpBufferSize: 1e7, // 10 MB
  // Detect ungraceful disconnects (mobile backgrounding, tab crash) faster so a
  // departed user's presence avatar is reaped within ~18s instead of ~45s when
  // the explicit `leaveWhiteboard` signal doesn't fire.
  pingInterval: 10000,
  pingTimeout: 8000,
});

// Skip Express CORS for /api/auth/* — BetterAuth's toNodeHandler sets its own headers.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/auth/")) return next();
  cors({ origin: corsOriginFn, credentials: true })(req, res, next);
});
app.use(compression());

// BetterAuth handler must come BEFORE express.json() — it reads the raw body itself.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "10mb" }));

// Liveness probe — returns 503 if DB is unreachable.
app.get("/healthz", async (req, res) => {
  try {
    await client.db().admin().command({ ping: 1 }, { timeoutMS: 2000 });
    res.sendStatus(200);
  } catch {
    res.sendStatus(503);
  }
});

// REST API.
app.use("/api/admin", adminRoutes());
app.use("/api/whiteboards", whiteboardRoutes(io));
app.use("/api/whiteboards", ocrRoutes());

// Catch-all error handler — prevents unhandled Express errors from leaking stack traces.
app.use((err, req, res, next) => {
  console.error("[error]", err.message);
  if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
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

function shutdown(signal) {
  console.log(`[shutdown] ${signal} — draining connections...`);
  const fallback = setTimeout(() => process.exit(0), 8000).unref();
  server.close(() => {
    io.close(() => {
      client.close().finally(() => {
        clearTimeout(fallback);
        process.exit(0);
      });
    });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
