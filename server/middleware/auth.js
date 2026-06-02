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
async function socketAuth(socket, next) {
  // Try cookie-based session from the handshake headers.
  try {
    const headers = fromNodeHeaders(socket.handshake.headers);
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

module.exports = { authMiddleware, socketAuth };
