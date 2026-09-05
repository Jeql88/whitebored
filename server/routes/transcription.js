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

    const crops = Array.isArray(req.body?.crops)
      ? req.body.crops.map(sanitizeCrop).filter(Boolean)
      : [];
    // Nothing readable on the board is a real answer, not an error.
    if (crops.length === 0) {
      return res.json({ artifact: { phase: "transcription", hasUnclear: false, entries: [] } });
    }

    try {
      const transcriber = createTranscriber({ gemini, userId: req.user.userId });
      const artifact = await transcriber.transcribe(crops, { userId: req.user.userId });

      // Persist so a reload returns to the review step rather than re-reading the
      // board (which costs another model call).
      await notesCollection().updateOne(
        { boardId: req.params.id },
        { $set: { boardId: req.params.id, transcription: artifact, updatedAt: new Date() } },
        { upsert: true }
      );
      res.json({ artifact });
    } catch (err) {
      console.error("[transcription] failed:", err.message);
      res.status(500).json({ error: "Transcription failed" });
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
