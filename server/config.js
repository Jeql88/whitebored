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
// Optional: enables the Sketch-to-Notes AI features (Gemini). If unset, the
// central Gemini module has no real client and AI features degrade gracefully.
// The Gemini key, accepted under either name. GEMINI_API_KEY is the intended one,
// but a deployment can end up where that specific variable never reaches the
// process while GOOGLE_*-prefixed ones do (observed on Render: the dashboard row
// showed a value, yet the running process had no GEMINI_* variables at all while
// GOOGLE_VISION_KEY arrived fine). GOOGLE_GEMINI_KEY is a working alias for that
// case — set whichever one your host actually delivers.
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
// Retrieval embeddings (D14). Read here so the deployed value actually reaches
// the client seam; realClient falls back to its own default when this is empty.
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";

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
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_EMBED_MODEL,
};
