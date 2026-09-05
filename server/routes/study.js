// Study-tools API (D15/D16/D19): the endpoints behind the Fact-check, Coverage
// and Scope tabs of the editor sidebar. Mounted at /api/whiteboards, so every
// route is board-scoped and reuses the existing board access guard.
//
// Route contract:
//   POST /:id/factcheck            → { boardId, flags }   run the pass
//   GET  /:id/factcheck            → { boardId, flags }   last stored flags
//   PATCH /:id/factcheck/:flagId   { status }             accept / dismiss
//   POST /:id/coverage             → { report }           run the coverage pass
//   GET  /:id/coverage             → { report }           last stored report
//   GET  /:id/scope                → scope
//   PUT  /:id/scope                { scope }              persist scope
//
// Both AI passes degrade the same way: with no Gemini key, or nothing retrievable
// (no document attached), they return an empty result rather than erroring — the
// panels then render their "nothing to show" state, which is the honest answer.

const express = require("express");
const { GridFSBucket } = require("mongodb");
const { authMiddleware } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { db, getCollections } = require("../db");
const { canAccessBoard } = require("../auth/boards");
const { createFactCheckerFromDeps } = require("../factcheck");
const { createFactCheckStore } = require("../factcheck/store");
const { createCoverageFromDeps } = require("../coverage");
const { createCoverageStore } = require("../coverage/store");
const { createNotesStore } = require("../notes/store");
const { createDocumentStore } = require("../documents");
const { createChunkStore } = require("../retrieval/store");
const { createRetriever } = require("../retrieval");
const { createGeminiFromConfig } = require("../gemini");
const { createScopeStore } = require("../scope/store");
const { applyDiff } = require("../scope");
const config = require("../config");

// Both passes are model calls over a whole document; keep them modest per user.
const passLimit = rateLimit({
  windowMs: 60_000,
  max: 6,
  key: (req) => req.user?.userId || req.ip,
});

// Built once and shared: the document store, chunk store and retriever are the
// same seams the upload path and AI chat already use.
let _deps = null;
function getDeps() {
  if (_deps) return _deps;
  const documents = createDocumentStore({
    bucket: new GridFSBucket(db, { bucketName: "documents" }),
    collection: db.collection("documents"),
  });
  const gemini = createGeminiFromConfig(config);
  const retriever =
    gemini && typeof gemini.embed === "function"
      ? createRetriever({
          gemini,
          chunks: createChunkStore({ collection: db.collection("documentChunks") }),
          documents,
        })
      : null;
  _deps = { documents, gemini, retriever };
  return _deps;
}

module.exports = function studyRoutes() {
  const router = express.Router();

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

  const factStore = () => createFactCheckStore({ collection: db.collection("factchecks") });
  const covStore = () => createCoverageStore({ collection: db.collection("coverage") });
  const scopeStore = () => createScopeStore({ collection: getCollections().scope });

  // --- Fact-check -----------------------------------------------------------

  router.get("/:id/factcheck", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const record = await factStore().load(req.params.id);
    res.json({ boardId: req.params.id, flags: record?.flags || [] });
  });

  router.post("/:id/factcheck", authMiddleware, passLimit, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const boardId = req.params.id;
    const { gemini, retriever } = getDeps();
    const checker = createFactCheckerFromDeps({ gemini, retriever });
    // No Gemini or no retrieval → no flags. The panel says "nothing to check".
    if (!checker) return res.json({ boardId, flags: [] });

    const notes = await createNotesStore({ collection: getCollections().notes }).load(boardId);
    if (!notes) return res.json({ boardId, flags: [] });

    try {
      const store = factStore();
      const prior = (await store.load(boardId))?.flags || [];
      const result = await checker.check({
        notes,
        boardId,
        scope: { boardId, userId: req.user.userId },
        prior,
        userId: req.user.userId,
      });
      await store.save(result);
      res.json(result);
    } catch (err) {
      console.error("[factcheck] pass failed:", err.message);
      res.status(500).json({ error: "Fact-check failed" });
    }
  });

  // Accept or dismiss one flag. A dismissal is what must persist — it is why the
  // user is not re-nagged after the next regeneration.
  router.patch("/:id/factcheck/:flagId", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const status = req.body?.status;
    if (!["open", "accepted", "dismissed"].includes(status)) {
      return res.status(400).json({ error: "status must be open, accepted or dismissed" });
    }

    const store = factStore();
    const record = await store.load(req.params.id);
    const flag = record?.flags?.find((f) => f.id === req.params.flagId);
    if (!flag) return res.status(404).json({ error: "Flag not found" });

    flag.status = status;
    await store.save(record);
    res.json({ flag });
  });

  // --- Coverage -------------------------------------------------------------

  router.get("/:id/coverage", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const record = await covStore().load(req.params.id);
    res.json({ report: record?.report || null });
  });

  router.post("/:id/coverage", authMiddleware, passLimit, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    const boardId = req.params.id;
    const { gemini, retriever, documents } = getDeps();
    const coverage = createCoverageFromDeps({ gemini, retriever, documents });
    if (!coverage) return res.json({ report: null });

    // Coverage is board-vs-DOCUMENT, so it needs one attached document. With none
    // attached there is nothing to be covered against — not an error (story 25).
    const docs = await documents.list(boardId);
    if (!docs.length) return res.json({ report: null });
    const docId = req.body?.docId || docs[0].docId;

    try {
      const store = covStore();
      const prior = (await store.load(boardId))?.report?.topics || [];
      const { topics } = await coverage.extractTopics(docId, { userId: req.user.userId });
      const { report } = await coverage.report({
        boardId,
        topics,
        scope: { boardId, userId: req.user.userId },
        prior,
        userId: req.user.userId,
      });
      await store.save({ boardId, report });
      res.json({ report });
    } catch (err) {
      console.error("[coverage] pass failed:", err.message);
      res.status(500).json({ error: "Coverage failed" });
    }
  });

  // --- Scope ----------------------------------------------------------------

  router.get("/:id/scope", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    res.json(await scopeStore().load(req.params.id));
  });

  router.put("/:id/scope", authMiddleware, async (req, res) => {
    if (!(await ensureAccess(req, res))) return;
    // Normalize through applyDiff so a malformed client payload can never write a
    // scope the generator would not honour.
    const scope = applyDiff(undefined, req.body?.scope || {});
    const record = await scopeStore().save({ boardId: req.params.id, scope });
    res.json(record.scope);
  });

  return router;
};
