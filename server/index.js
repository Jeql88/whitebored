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

app.use(cors({ origin: corsOriginFn, credentials: true }));
app.use(compression());

// BetterAuth handler must come BEFORE express.json() — it reads the raw body itself.
app.all("/api/auth/*splat", toNodeHandler(auth));

// GET /api/oauth/google — browser navigates here directly (first-party to Render)
// so the state cookie is set on onrender.com, not via cross-origin fetch.
// callbackURL points to /api/oauth/done on this server so we can generate an OTT
// after BetterAuth sets the session, then redirect to Vercel with ?ott=.
app.get("/api/oauth/google", async (req, res) => {
  const finalCallbackURL = req.query.callbackURL || config.CLIENT_ORIGIN + "/whiteboards";
  const errorCallbackURL = req.query.errorCallbackURL || config.CLIENT_ORIGIN + "/login";
  const doneURL = `${config.BETTER_AUTH_URL}/api/oauth/done?to=${encodeURIComponent(finalCallbackURL)}&err=${encodeURIComponent(errorCallbackURL)}`;
  try {
    const result = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: doneURL, errorCallbackURL },
      headers: new Headers({ "Content-Type": "application/json" }),
      asResponse: true,
    });
    // Forward state cookie to browser (first-party — this IS onrender.com).
    const cookies = result.headers.getSetCookie?.() || [];
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    const body = await result.json();
    if (body?.url) return res.redirect(body.url);
    res.redirect(errorCallbackURL);
  } catch (err) {
    console.error("[oauth/google]", err.message);
    res.redirect(errorCallbackURL);
  }
});

// GET /api/oauth/done — BetterAuth redirects here after completing OAuth.
// The browser arrives with a valid session cookie on onrender.com.
// We generate a one-time-token and redirect to Vercel with ?ott= so the
// frontend can exchange it for a session without needing the cross-origin cookie.
app.get("/api/oauth/done", async (req, res) => {
  const to = req.query.to || config.CLIENT_ORIGIN + "/whiteboards";
  const err = req.query.err || config.CLIENT_ORIGIN + "/login";
  try {
    const headers = new Headers({ cookie: req.headers.cookie || "" });
    const ottResult = await auth.api.generateOneTimeToken({ headers, asResponse: true });
    const body = await ottResult.json();
    const ott = body?.token;
    const dest = new URL(to);
    if (ott) dest.searchParams.set("ott", ott);
    res.redirect(dest.toString());
  } catch (e) {
    console.error("[oauth/done]", e.message);
    res.redirect(err);
  }
});

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
