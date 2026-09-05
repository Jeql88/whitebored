"use strict";

// Persistence for embedded document chunks (D14, slice #12). One record per chunk:
//
//   { docId, boardId, page, text, embedding: number[] }
//
// docId + page are the citation model (page 1-based, lining up with the viewer's
// jump-to-page); boardId is the retrieval scope. The embedding is computed ONCE at
// upload and stored here, never recomputed at query time.
//
//   const chunks = createChunkStore({ collection });   // inject the DB seam
//   await chunks.putMany(records);        // store a document's chunks
//   await chunks.forScope(scope);         // read the chunks a query may match
//   await chunks.removeDocument(docId);   // drop a document's chunks (re-embed/delete)
//
// The Mongo collection is injected (the DB seam), so the store is unit-tested with
// an in-memory fake — same pattern as notes/store.js and documents/store.js. This
// store is deliberately dumb: it persists what it is given and reads it back scoped;
// chunking, embedding, and ranking live in their own modules.
//
// `scope` is the seam that lets Atlas Vector Search replace this later without
// touching callers: today it narrows to a board's chunks (or a space's boards) and
// the caller ranks in Node; a future implementation could push the scope + query
// vector down to a vector index. See ./index.js for the scope shape.

function scopeFilter(scope) {
  // A board-scoped query (V1): only this board's chunks. `boardIds` (a space's
  // boards) is supported so the group-space widening arrives with no caller change.
  if (scope && Array.isArray(scope.boardIds) && scope.boardIds.length > 0) {
    return { boardId: { $in: scope.boardIds } };
  }
  if (scope && scope.boardId) {
    return { boardId: scope.boardId };
  }
  // No scope narrows to nothing — never silently return every board's chunks.
  return null;
}

function createChunkStore({ collection } = {}) {
  if (!collection || typeof collection.insertMany !== "function") {
    throw new Error("createChunkStore: a Mongo collection is required");
  }

  // Store a batch of chunk records. Records missing an embedding are rejected loud —
  // an un-embedded chunk in the index would rank as noise and never surface, a silent
  // hole in retrieval.
  async function putMany(records) {
    const list = Array.isArray(records) ? records : [];
    if (list.length === 0) return 0;
    for (const r of list) {
      if (!r.boardId) throw new Error("putMany: each chunk needs a boardId");
      if (!Array.isArray(r.embedding) || r.embedding.length === 0) {
        throw new Error("putMany: each chunk needs a non-empty embedding[]");
      }
    }
    const now = new Date();
    await collection.insertMany(
      list.map((r) => ({
        docId: r.docId,
        boardId: r.boardId,
        page: r.page,
        text: r.text,
        embedding: r.embedding,
        createdAt: now,
      }))
    );
    return list.length;
  }

  // Read the candidate chunks a scoped query may match. Ranking happens in Node
  // (cosine top-k) over this set — the seam that a vector index can later replace.
  async function forScope(scope) {
    const filter = scopeFilter(scope);
    if (!filter) return [];
    return collection.find(filter).toArray();
  }

  // Drop a document's chunks — used when a document is re-embedded or removed, so the
  // index never carries stale vectors for deleted text.
  async function removeDocument(docId) {
    const { deletedCount } = await collection.deleteMany({ docId });
    return deletedCount || 0;
  }

  return { putMany, forScope, removeDocument };
}

module.exports = { createChunkStore, scopeFilter };
