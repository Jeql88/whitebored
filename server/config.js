// Centralized, fail-fast configuration. All secrets/URLs come from the
// environment — nothing is hardcoded here.

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

const PORT = Number(process.env.PORT) || 4000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "";
const DB_NAME = process.env.DB_NAME || "whiteboard";

function requireVar(name, value) {
  if (!value) {
    console.error(
      `[config] Missing required environment variable: ${name}. ` +
        `Set it in server/.env (dev) or the Render dashboard (prod).`
    );
    process.exit(1);
  }
}

// Always required — the app cannot function without a database or a signing key.
requireVar("MONGO_URI", MONGO_URI);
requireVar("JWT_SECRET", JWT_SECRET);

module.exports = {
  NODE_ENV,
  isProd,
  PORT,
  MONGO_URI,
  JWT_SECRET,
  CLIENT_ORIGIN,
  DB_NAME,
};
