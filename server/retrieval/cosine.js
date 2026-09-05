"use strict";

// Pure similarity math for the retrieval seam (D14). No I/O, no model, no db —
// so cosine top-k is unit-tested directly and is fully deterministic. This is the
// "pure seam" the acceptance criteria pin: given known vectors, ranking is exact
// and repeatable, and NO model is consulted here (the model only ran once, at
// upload, to produce the chunk embeddings; ranking a query against them is arithmetic).
//
// Vectors are plain number[]. Mismatched lengths are a programming error (an
// embedding from a different model/dimension leaking in) and fail loud rather than
// silently scoring garbage.

// Dot product of two equal-length vectors.
function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// Euclidean norm (magnitude) of a vector.
function norm(a) {
  return Math.sqrt(dot(a, a));
}

// Cosine similarity in [-1, 1]. A zero vector has no direction; its similarity to
// anything is 0 (degrade on the foreseen — an all-zero embedding must not divide by
// zero and poison the ranking with NaN).
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new Error("cosineSimilarity: two number[] vectors are required");
  }
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`
    );
  }
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

// Rank `chunks` by cosine similarity of each chunk's `embedding` to `queryEmbedding`
// and return the top `k`, each annotated with its `score`. Highest score first;
// ties keep input order (a stable sort). Chunks without a usable embedding are
// skipped rather than crashing the ranking (a chunk that failed to embed at upload
// must not sink the whole query). `k <= 0` returns [].
//
// This is the deterministic core of retrieve(query, scope): the caller supplies a
// query vector (embedded once from the query text) and the board-scoped chunk set;
// the winners come back purely by arithmetic, no model call.
function rankByCosine(queryEmbedding, chunks, k) {
  if (!Array.isArray(queryEmbedding)) {
    throw new Error("rankByCosine: queryEmbedding must be a number[]");
  }
  const limit = Number.isFinite(k) ? k : chunks.length;
  if (limit <= 0) return [];

  const scored = [];
  for (const chunk of chunks) {
    if (!chunk || !Array.isArray(chunk.embedding) || chunk.embedding.length === 0) {
      continue;
    }
    scored.push({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) });
  }

  // Stable sort: compare on score, and on original index to break ties in input
  // order so the ranking is fully deterministic.
  return scored
    .map((c, i) => ({ c, i }))
    .sort((x, y) => y.c.score - x.c.score || x.i - y.i)
    .slice(0, limit)
    .map(({ c }) => c);
}

module.exports = { cosineSimilarity, rankByCosine, dot, norm };
