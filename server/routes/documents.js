// Documents tab API (D13, slice #11). Mounted at /api/whiteboards, so every route
// is board-scoped and reuses the existing board access guard (canAccessBoard) —
// documents are attached per board.
//
// Route contract (all under /api/whiteboards/:id/documents):
//
//   GET    /:id/documents            → [ summary, … ]   list a board's documents
//   POST   /:id/documents            → summary          upload a document
//   GET    /:id/documents/:docId     → full record (metadata + uniform pages)
//   GET    /:id/documents/:docId/pages/:page → { page, text }   jump-to-page text
//   GET    /:id/documents/:docId/raw → the raw file bytes (streamed from GridFS)
//   DELETE /:id/documents/:docId     → { success: true }
//
// Upload body (JSON, mirrors the OCR route's base64 convention so no multipart
// infra is needed):
//   { kind: "pdf"|"image"|"text", filename, contentType,
//     data: base64 string,            // the raw file bytes
//     pageTexts?: string[],           // PDF: text extracted per page CLIENT-SIDE
//     text?: string }                 // text: the plaintext (also derivable from data)
//
// The client extracts PDF page text (it already renders the PDF inline, D13 — no
// server-side PDF/conversion infra). The server normalizes to the uniform page
// model, enforces the V1 text-layer requirement, stores raw bytes in GridFS, and
// persists the page list as metadata.
//
// Degrades gracefully: everything still works with nothing uploaded (story 25) —
// GET list returns [] for a board with no documents, and no other feature depends
// on a document existing.

const express = require("express");
const { GridFSBucket } = require("mongodb");
const { authMiddleware } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { db } = require("../db");
const { canAccessBoard } = require("../auth/boards");
const { createChunkStore } = require("../retrieval/store");
const { createRetriever } = require("../retrieval");
const { createGeminiFromConfig } = require("../gemini");
const config = require("../config");
const {
  createDocumentStore,
  normalizePages,
  isTextLayerPresent,
  DOC_KINDS,
} = require("../documents");

// Per-user upload cap. Documents are heavier than comments; keep it modest.
const uploadLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  key: (req) => req.user?.userId || req.ip,
});

// Build the store once from the live db handle: a GridFS bucket for raw bytes and
// the "documents" metadata collection. Lazily created so this module can be
// required before connectDB() resolves (mirrors how getCollections is called
// per-request elsewhere). The bucket + collection ARE the injected seam the store
// is tested against — here we pass the real ones.
let _store = null;
function getStore() {
  if (!_store) {
    const bucket = new GridFSBucket(db, { bucketName: "documents" });
    const collection = db.collection("documents");
    _store = createDocumentStore({ bucket, collection });
  }
  return _store;
}

// The retriever shares the document store and the central Gemini module. Null when
// embeddings are unavailable, so the upload path simply skips indexing.
let _retriever = null;
function getRetriever(documents) {
  if (_retriever !== null) return _retriever || null;
  const gemini = createGeminiFromConfig(config);
  if (!gemini || typeof gemini.embed !== "function") {
    _retriever = false; // remembered so we do not rebuild on every upload
    return null;
  }
  _retriever = createRetriever({
    gemini,
    chunks: createChunkStore({ collection: db.collection("documentChunks") }),
    documents,
  });
  return _retriever;
}

module.exports = function documentRoutes({ store } = {}) {
  const router = express.Router();
  // Allow a store to be injected (tests / wiring); default to the real one.
  const resolveStore = () => store || getStore();

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

  // List a board's documents (summaries only — no page text or bytes).
  router.get("/:id/documents", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const docs = await resolveStore().list(req.params.id);
    res.json(docs);
  });

  // Upload a document.
  router.post("/:id/documents", authMiddleware, uploadLimit, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;

    const { kind, filename, contentType, data, pageTexts, text } = req.body || {};
    if (!DOC_KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of ${DOC_KINDS.join(", ")}` });
    }
    if (typeof data !== "string" || !data) {
      return res.status(400).json({ error: "Missing file data" });
    }

    // Accept a data URL or raw base64 (same convention as the OCR route).
    const base64 = data.includes(",") ? data.split(",")[1] : data;
    let buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid file data" });
    }
    if (buffer.length > 9_000_000) {
      return res.status(413).json({ error: "File too large" });
    }

    // Normalize to the uniform page model. PDF pages come from client-side text
    // extraction; text from the plaintext (or decoded from the buffer); image is
    // a single page.
    let source;
    if (kind === "pdf") source = Array.isArray(pageTexts) ? pageTexts : [];
    else if (kind === "text") source = typeof text === "string" ? text : buffer.toString("utf8");
    else source = null; // image

    const pages = normalizePages(kind, source);

    // V1 requires a text layer for PDF and text (D13) — a scanned PDF with no
    // extractable text is rejected here (OCR deferred). Images are exempt: they
    // are inherently text-layer-less and allowed as attachable source material.
    if (kind !== "image" && !isTextLayerPresent(pages)) {
      return res.status(422).json({
        error: "This document has no text layer. V1 requires selectable text (scanned-document OCR is not yet supported).",
      });
    }

    const store = resolveStore();
    const summary = await store.upload({
      boardId: req.params.id,
      kind,
      filename: typeof filename === "string" && filename ? filename : "document",
      contentType: typeof contentType === "string" ? contentType : "application/octet-stream",
      buffer,
      pages,
    });

    // Index the document for retrieval (D14) — chunk + embed ONCE, here at upload,
    // so retrieve() never pays a model call per query. Indexing is best-effort: a
    // document is still uploaded, viewable and citable if embeddings are
    // unavailable (no Gemini key, or the embed call fails); retrieval simply
    // returns nothing for it until it is indexed. Failing the upload over this
    // would lose the user's file for a degraded side feature.
    const retriever = getRetriever(store);
    if (retriever) {
      retriever
        .indexDocument(summary.docId, { userId: req.user.userId })
        .catch((err) => console.error("[documents] indexing failed:", err.message));
    }

    res.status(201).json(summary);
  });

  // Full record: metadata + the uniform page list (the inline viewer + slice #12).
  router.get("/:id/documents/:docId", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const doc = await resolveStore().get(req.params.docId);
    if (!doc || doc.boardId !== req.params.id) {
      return res.status(404).json({ error: "Document not found" });
    }
    res.json({
      docId: String(doc._id),
      boardId: doc.boardId,
      kind: doc.kind,
      filename: doc.filename,
      contentType: doc.contentType,
      pages: doc.pages,
    });
  });

  // Jump-to-page text for one page — the citation deep-link surface (story 24).
  router.get("/:id/documents/:docId/pages/:page", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const doc = await resolveStore().get(req.params.docId);
    if (!doc || doc.boardId !== req.params.id) {
      return res.status(404).json({ error: "Document not found" });
    }
    const page = await resolveStore().getPage(req.params.docId, Number(req.params.page));
    if (!page) return res.status(404).json({ error: "Page not found" });
    res.json(page);
  });

  // Raw file bytes, streamed straight from GridFS to the response — the inline
  // viewer loads the file from here.
  router.get("/:id/documents/:docId/raw", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const s = resolveStore();
    const doc = await s.get(req.params.docId);
    if (!doc || doc.boardId !== req.params.id) {
      return res.status(404).json({ error: "Document not found" });
    }
    const file = await s.fetchFile(req.params.docId);
    if (!file) return res.status(404).json({ error: "File not found" });
    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    file.stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    file.stream.pipe(res);
  });

  // Remove a document (metadata + GridFS bytes).
  router.delete("/:id/documents/:docId", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const doc = await resolveStore().get(req.params.docId);
    if (!doc || doc.boardId !== req.params.id) {
      return res.status(404).json({ error: "Document not found" });
    }
    await resolveStore().remove(req.params.docId);
    res.json({ success: true });
  });

  return router;
};
