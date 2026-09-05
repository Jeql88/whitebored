"use strict";

// The retrieval seam (D14, slice #12) — the RAG gateway slices #13 (AI chat), #15
// (fact-check), and #16 (coverage) build on. It owns the whole path from a document's
// text to a ranked set of relevant chunks, behind ONE public interface so Atlas
// Vector Search can replace the ranking later (group space / cross-board) without any
// caller changing.
//
//   const retriever = createRetriever({ gemini, chunks, documents });
//
//   // At document upload: chunk + embed + store (embeddings computed ONCE, here).
//   await retriever.indexDocument(docId);
//
//   // At query time: cosine top-k, scoped. The query is embedded once; chunk
//   // embeddings are NOT recomputed.
//   const hits = await retriever.retrieve(query, scope);
//
// PUBLIC INTERFACE
//   indexDocument(docId)          -> { docId, boardId, chunkCount }
//   retrieve(query, scope)        -> [ { docId, boardId, page, text, score }, ... ]
//
// `scope` narrows the candidate set (the seam future vector search pushes down):
//   { boardId }              — a single board's chunks (V1 default)
//   { boardIds: [...] }      — a space's boards (group-space widening; no caller change)
//   { k }                    — optional top-k (default DEFAULT_TOP_K), any scope shape
//
// CHUNK RECORD SHAPE (what indexDocument stores, what retrieve returns sans embedding):
//   { docId, boardId, page, text, embedding: number[] }
// page is 1-based and lines up with the document viewer's jump-to-page (citation model
// is { docId, page }).
//
// SEAMS (all injected; tests fake every one — no Mongo, no model, no network):
//   - gemini     the central Gemini module (createGemini). Embeddings route through
//                gemini.embed({ userId, texts }) — the SINGLE model choke point. This
//                module never touches the SDK.
//   - chunks     the chunk store (createChunkStore) — persists/reads chunk records.
//   - documents  a source of document page text: get(docId) -> { boardId, pages:[{page,text}] }
//                (slice #11's document store; only get() is used, read-only).

const { chunkPages } = require("./chunk");
const { rankByCosine } = require("./cosine");

// How many chunks retrieve() returns by default. Enough context to ground an answer
// or a coverage judgment without flooding the model's window downstream.
const DEFAULT_TOP_K = 6;

// Normalize whatever gemini.embed resolves to into number[][] aligned to inputs.
// The real client resolves { embeddings: number[][] }; be tolerant of a bare array
// too so a future client shape does not silently break embedding.
function embeddingsFrom(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.embeddings)) return result.embeddings;
  throw new Error("retrieval: gemini.embed returned no embeddings[]");
}

function createRetriever({ gemini, chunks, documents } = {}) {
  if (!gemini || typeof gemini.embed !== "function") {
    throw new Error(
      "createRetriever: a Gemini module with embed() is required " +
        "(the client must support embeddings)"
    );
  }
  if (!chunks || typeof chunks.putMany !== "function") {
    throw new Error("createRetriever: a chunk store is required");
  }
  if (!documents || typeof documents.get !== "function") {
    throw new Error("createRetriever: a document source is required");
  }

  // Embed a batch of texts through the central Gemini module. ONE call for the whole
  // batch (embeddings are batched per D23's batching intent). userId keys the module's
  // per-user throttle. Returns number[][] aligned to `texts`.
  async function embed(texts, userId) {
    if (texts.length === 0) return [];
    const result = await gemini.embed({ userId, texts });
    const embeddings = embeddingsFrom(result);
    if (embeddings.length !== texts.length) {
      throw new Error(
        `retrieval: embed returned ${embeddings.length} vectors for ${texts.length} texts`
      );
    }
    return embeddings;
  }

  // Chunk a document's pages, embed every chunk ONCE, and store the chunk records.
  // Called at upload time (and on re-embed after replacing chunks). Re-indexing a
  // document first drops its old chunks so vectors never go stale.
  async function indexDocument(docId, { userId } = {}) {
    const doc = await documents.get(docId);
    if (!doc) throw new Error(`indexDocument: unknown document ${docId}`);

    const boardId = doc.boardId;
    const spans = chunkPages(doc.pages);
    if (spans.length === 0) {
      // A document with no text layer (e.g. an image) yields nothing to embed. Still
      // clear any prior chunks so a re-index to empty leaves no stragglers.
      await chunks.removeDocument(docId);
      return { docId, boardId, chunkCount: 0 };
    }

    const embeddings = await embed(spans.map((s) => s.text), userId);
    const records = spans.map((s, i) => ({
      docId,
      boardId,
      page: s.page,
      text: s.text,
      embedding: embeddings[i],
    }));

    // Replace-then-write so a re-index is idempotent (no duplicate chunks).
    await chunks.removeDocument(docId);
    await chunks.putMany(records);
    return { docId, boardId, chunkCount: records.length };
  }

  // The RAG gateway. Embed the query ONCE, gather the scope's candidate chunks
  // (their embeddings were computed at upload), and return the cosine top-k. Chunk
  // embeddings are never recomputed here — only the query is embedded. Returns hits
  // without the raw embedding[] (callers want text + citation + score, not vectors).
  async function retrieve(query, scope = {}) {
    const text = typeof query === "string" ? query.trim() : "";
    if (!text) return [];

    const candidates = await chunks.forScope(scope);
    if (candidates.length === 0) return [];

    const k = Number.isFinite(scope.k) ? scope.k : DEFAULT_TOP_K;
    const [queryEmbedding] = await embed([text], scope.userId);

    const ranked = rankByCosine(queryEmbedding, candidates, k);
    return ranked.map(({ docId, boardId, page, text: chunkText, score }) => ({
      docId,
      boardId,
      page,
      text: chunkText,
      score,
    }));
  }

  return { indexDocument, retrieve };
}

module.exports = { createRetriever, DEFAULT_TOP_K };
