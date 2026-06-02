// Centralized, fail-fast configuration. All secrets/URLs come from the
// environment — nothing is hardcoded here.

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

const PORT = Number(process.env.PORT) || 4000;
const MONGO_URI = process.env.MONGO_URI;
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || "http://localhost:4000";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "";
const DB_NAME = process.env.DB_NAME || "whiteboard";
// Optional: enables handwriting OCR (Google Cloud Vision). If unset, the OCR
// endpoint degrades gracefully and typed-text search still works.
const GOOGLE_VISION_KEY = process.env.GOOGLE_VISION_KEY || "";

function requireVar(name, value) {
  if (!value) {
    console.error(
      `[config] Missing required environment variable: ${name}. ` +
        `Set it in server/.env (dev) or the Render dashboard (prod).`
    );
    process.exit(1);
  }
}

// Always required — the app cannot function without a database or Clerk.
requireVar("MONGO_URI", MONGO_URI);
requireVar("BETTER_AUTH_SECRET", BETTER_AUTH_SECRET);

module.exports = {
  NODE_ENV,
  isProd,
  PORT,
  MONGO_URI,
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  CLIENT_ORIGIN,
  DB_NAME,
  GOOGLE_VISION_KEY,
};
