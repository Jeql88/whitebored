# retrieve(query, scope) seam — chunk, embed, cosine top-k (D14)

Status: done
Slice: 12

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D14).

## What to build

The retrieval seam. At document upload, chunk and embed the document via Gemini free-tier embeddings; store as `{ docId, boardId, page, text, embedding[] }` in Mongo. Retrieval is app-side cosine top-k in Node, scoped to the board's chunks, behind a `retrieve(query, scope) → chunks` seam so Atlas Vector Search can replace the implementation later (group space / cross-board) without touching callers. Embeddings are computed once per chunk at upload, never per query.

## Acceptance criteria

- [ ] Documents are chunked and embedded at upload; chunks stored as `{ docId, boardId, page, text, embedding[] }`
- [ ] `retrieve(query, scope)` returns cosine top-k chunks scoped to the board
- [ ] Retrieval is behind a seam that Atlas Vector Search can later replace without changing callers
- [ ] Embeddings are computed once at upload, never per query
- [ ] Unit tests: given known chunks + embeddings, cosine top-k returns the expected chunks; deterministic, no model call at query time (D14 pure seam)

## Blocked by

- #11
- #1
