// Phase-1 transcription API (D3/D4, wiring for slices #2/#3). Mounted at
// /api/whiteboards, board-scoped, behind the usual board access guard.
//
//   POST /:id/transcription  { crops }  → the phase-1 artifact
//   GET  /:id/transcription             → the last stored artifact
//   PUT  /:id/transcription  { artifact } → persist the user's corrections
//
// The client groups the board into crops (server/recognition/grouping.js runs
// there too — it is pure) and rasterizes each ink crop to a data URL, because the
// browser is what already renders Excalidraw. The server reads them through the
// recognize() seam and returns the STRUCTURED artifact the review UI corrects:
//
//   { phase:"transcription", hasUnclear, entries:[{ cropId, segments, ... }] }
//
// This is deliberately separate from the older /ocr route: that one uses Google
// Vision and returns flat text for the search index, which has no per-crop
// structure and no notion of an uncertain read, so it cannot drive the review
// step. Notes generation is gated on the artifact this produces.
//
// Degrades: with no Gemini key configured the route reports 503 and the client
// keeps its existing plain-text OCR path.

const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { getCollections } = require("../db");
const { canAccessBoard } = require("../auth/boards");
const { createTranscriber } = require("../transcription");
const { createGeminiFromConfig } = require("../gemini");
const { MODELS, BY_ID } = require("../gemini/models");
const { boardVersion } = require("../recognition/boardVersion");
const config = require("../config");

// Transcription is a multi-image model call; keep it modest per user.
const transcribeLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  key: (req) => req.user?.userId || req.ip,
});

// A crop the client sends. We validate shape here rather than trusting it: a
// malformed crop would otherwise reach the model as a broken request.
function sanitizeCrop(raw) {
  if (!raw || typeof raw.cropId !== "string" || !raw.cropId) return null;
  if (raw.kind !== "text" && raw.kind !== "ink") return null;

  const crop = {
    cropId: raw.cropId,
    kind: raw.kind,
    sourceElementIds: Array.isArray(raw.sourceElementIds)
      ? raw.sourceElementIds.filter((id) => typeof id === "string")
      : [],
    bbox: raw.bbox && typeof raw.bbox === "object" ? raw.bbox : null,
  };

  // Typed text is ground truth and never goes to the model; ink needs its image.
  if (crop.kind === "text") {
    if (typeof raw.text !== "string") return null;
    crop.text = raw.text;
  } else {
    if (typeof raw.image !== "string" || !raw.image) return null;
    crop.image = raw.image;
  }
  return crop;
}

module.exports = function transcriptionRoutes() {
  const router = express.Router();
  const notesCollection = () => getCollections().notes;

  async function ensureAccess(req, res) {
    const { allowed } = await canAccessBoard(req.user, req.params.id).catch(
      () => ({ allowed: false })
    );
    if (!allowed) {
      res.status(403).json({ error: "Not authorized for this board" });
      return false;
    }
    return true;
  }

  // The artifact rides on the board's notes record: one per board, and it is what
  // notes generate from, so keeping them together means one read on reload.
  async function loadArtifact(boardId) {
    const doc = await notesCollection().findOne({ boardId });
    return doc?.transcription || null;
  }

  // The models this deployment offers, for the picker. Ids only — no key material.
  router.get("/ai/models", authMiddleware, (req, res) => {
    res.json({ models: MODELS.map(({ id, label, note }) => ({ id, label, note })) });
  });

  // Does this board need re-reading? Per-crop fingerprints already stop unchanged
  // ink reaching the model, but the client still rasterizes and uploads every crop
  // to discover that. Answering here first is what makes an automated "read only
  // if it changed" flow affordable on a tier metered in calls per day.
  router.post("/:id/transcription/status", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;

    const stored = await loadArtifact(req.params.id);
    const version = boardVersion(req.body?.elements || []);
    res.json({
      needsRead: !stored?.boardVersion || stored.boardVersion !== version,
      version,
      hasTranscription: Boolean(stored?.entries?.length),
    });
  });

  router.get("/:id/transcription", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    res.json({ artifact: await loadArtifact(req.params.id) });
  });

  router.post("/:id/transcription", authMiddleware, transcribeLimit, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;

    const gemini = createGeminiFromConfig(config);
    if (!gemini) {
      return res.status(503).json({ error: "Transcription is not configured" });
    }

    const sent = Array.isArray(req.body?.crops) ? req.body.crops : [];
    const crops = sent.map(sanitizeCrop).filter(Boolean);

    // A crop that fails validation is DROPPED, and dropping them all produced a
    // 200 with an empty artifact — the read "succeeded" while reading nothing.
    // Report the discrepancy instead of hiding it: the usual cause is an ink crop
    // whose image never rasterized, which is a client-side failure the user
    // cannot see and the server was silently absorbing.
    if (sent.length > 0 && crops.length < sent.length) {
      const dropped = sent.length - crops.length;
      const why = sent
        .filter((c) => !sanitizeCrop(c))
        .slice(0, 3)
        .map((c) => `${c?.cropId || "?"}:${c?.kind || "?"}${c?.kind === "ink" && !c?.image ? " (no image)" : ""}`);
      console.warn(
        `[transcription] dropped ${dropped}/${sent.length} malformed crops — e.g. ${why.join(", ")}`
      );
    }
    // Nothing readable on the board is a real answer, not an error — but "you
    // sent nothing" and "everything you sent was malformed" are different
    // problems and must not present identically.
    if (crops.length === 0) {
      return res.json({
        artifact: { phase: "transcription", hasUnclear: false, entries: [] },
        readFailure:
          sent.length > 0
            ? `All ${sent.length} crops were rejected as malformed — the board images did not rasterize.`
            : null,
      });
    }

    try {
      const transcriber = createTranscriber({ gemini, userId: req.user.userId });
      // Hand the seam what this board read last time so unchanged ink is reused
      // rather than re-sent to the model (the free tier allows ~20 calls a DAY).
      const previous = await loadArtifact(req.params.id).catch(() => null);
      // The caller may prefer a model (they ran out of quota on another, say).
      // An unknown id is ignored rather than trusted — it would fail every crop.
      const preferred = BY_ID.has(req.body?.model) ? req.body.model : undefined;
      // Stamp the artifact with the board it was read FROM, so the status check
      // above can tell later whether a re-read is needed. Derived from the
      // elements the client sends alongside its crops.
      const version = Array.isArray(req.body?.elements)
        ? boardVersion(req.body.elements)
        : null;
      const artifact = await transcriber.transcribe(crops, {
        userId: req.user.userId,
        previous,
        model: preferred,
      });

      // Persist so a reload returns to the review step rather than re-reading the
      // board (which costs another model call).
      await notesCollection().updateOne(
        { boardId: req.params.id },
        {
          $set: {
            boardId: req.params.id,
            transcription: version ? { ...artifact, boardVersion: version } : artifact,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      // Surface a read failure to the client: it is the difference between
      // "your writing was not legible" and "the read did not happen".
      res.json({ artifact, readFailure: artifact.readFailure || null });
    } catch (err) {
      // Surface the real cause. A generic 500 here is unactionable: the model call,
      // the JSON parse and the Mongo upsert can all fail, and from the client they
      // look identical. The message and code are diagnostic, not secret.
      console.error("[transcription] failed:", err.stack || err.message);
      res.status(500).json({
        error: "Transcription failed",
        reason: String(err.message || err).slice(0, 300),
        code: err.code || err.status || null,
      });
    }
  });

  // Persist the user's corrections. Phase 2 reads this, so the corrected artifact
  // — not the raw read — is what notes are generated from (D3).
  router.put("/:id/transcription", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;

    const artifact = req.body?.artifact;
    if (!artifact || artifact.phase !== "transcription" || !Array.isArray(artifact.entries)) {
      return res.status(400).json({ error: "A phase-1 transcription artifact is required" });
    }

    await notesCollection().updateOne(
      { boardId: req.params.id },
      { $set: { boardId: req.params.id, transcription: artifact, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ artifact });
  });

  return router;
};
