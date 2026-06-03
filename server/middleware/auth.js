const { fromNodeHeaders } = require("better-auth/node");
const { auth } = require("../auth");

// Express middleware: verify BetterAuth session, attach req.user.
async function authMiddleware(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ error: "Not authenticated" });
    req.user = {
      userId: session.user.id,
      username: session.user.username || session.user.name || session.user.email,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}

// Socket.IO handshake auth: verified user, or guest fallback for shared links.
// socket.request is the raw Node.js http.IncomingMessage from the WS upgrade —
// it reliably carries the cookie header. We build a minimal Headers object so
// BetterAuth can verify the session cookie without relying on fromNodeHeaders()
// which doesn't handle Socket.IO's non-standard handshake object.
async function socketAuth(socket, next) {
  try {
    const cookie =
      socket.request?.headers?.cookie ||
      socket.handshake?.headers?.cookie ||
      "";
    const headers = new Headers({ cookie });
    const session = await auth.api.getSession({ headers });
    if (session?.user) {
      socket.user = {
        userId: session.user.id,
        username: session.user.username || session.user.name || session.user.email,
        isGuest: false,
      };
      return next();
    }
  } catch {
    // fall through to guest
  }
  // No valid session — allow as guest (shared-link access).
  socket.user = { userId: socket.id, isGuest: true, username: "Guest" };
  next();
}

// Admin middleware: must follow authMiddleware. Checks userId against the
// comma-separated ADMIN_USER_IDS env var.
const ADMIN_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function adminMiddleware(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (!ADMIN_IDS.includes(req.user.userId)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

module.exports = { authMiddleware, socketAuth, adminMiddleware };
