const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config");

// Express middleware: require a valid Bearer token, attach req.user.
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// Socket.IO handshake auth: verified user, or a guest fallback so shared links
// work without an account.
function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.user = { userId: socket.id, isGuest: true, username: "Guest" };
    return next();
  }
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    socket.user.isGuest = false;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
}

module.exports = { authMiddleware, socketAuth };
