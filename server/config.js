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
// The Gemini key, resolved from the first source that actually has it.
//
// Normally this is just GEMINI_API_KEY. The other two sources exist because a
// host can fail to deliver a specific env var: on this project's Render service,
// the dashboard showed a saved GEMINI_API_KEY yet the running process had no
// GEMINI_* variable at all, while pre-existing GOOGLE_* ones arrived fine — and a
// GOOGLE_GEMINI_KEY alias failed the same way, so it was not the name.
//
// A SECRET FILE is the reliable way out without recreating the service: Render
// mounts secret files through a different mechanism than environment variables,
// so it does not depend on the env path that is broken. Create a secret file
// named gemini_key (contents: just the key) and it is picked up here.
function readSecretFile() {
  // Render mounts secret files at the project root in production and at
  // /etc/secrets; check both plus an explicit override path.
  const candidates = [
    process.env.GEMINI_KEY_FILE,
    "/etc/secrets/gemini_key",
    require("path").join(process.cwd(), "gemini_key"),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      const value = require("fs").readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // Absent or unreadable is the normal case — try the next candidate. Only a
      // present, readable file should win, so nothing is logged here.
    }
  }
  return "";
}

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_KEY || readSecretFile();
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
// Retrieval embeddings (D14). Read here so the deployed value actually reaches
// the client seam; realClient falls back to its own default when this is empty.
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
// Calls per user per day before the app refuses locally rather than spending one to
// be told 429. Matches the free tier's real constraint, which is a DAILY cap, not
// the per-minute burst the throttle smooths. Unset (0) disables the check.
const GEMINI_DAILY_BUDGET = Number(process.env.GEMINI_DAILY_BUDGET) || 0;

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
  GEMINI_DAILY_BUDGET,
};
