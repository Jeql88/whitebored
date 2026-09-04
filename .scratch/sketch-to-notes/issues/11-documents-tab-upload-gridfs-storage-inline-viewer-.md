# Documents tab — upload, GridFS storage, inline viewer with jump-to-page (D13)

Status: done
Slice: 11

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D13).

## What to build

A Documents tab for attaching source material per board. Accept PDF, images, and plaintext (users export slides to PDF themselves — no server-side conversion infra). Store raw files in **GridFS** (stay in Mongo/Atlas, no new external service). Normalize every document internally to a uniform list of "pages" — PDF = real pages, image = single page, text = synthetic chunks/sections — so the citation model is uniform across types. Render the document inline with a client-side PDF viewer that supports **jump-to-page**, so later citations can deep-link. Require a text layer in V1 (scanned-document OCR deferred). Everything must still work with nothing uploaded — documents are an enhancement, never a requirement.

## Acceptance criteria

- [ ] User can attach PDF, image, and plaintext files per board (story 22)
- [ ] Raw files are stored in GridFS
- [ ] Every document is normalized internally to a uniform list of "pages"
- [ ] A Documents tab renders the document inline with jump-to-page (story 23)
- [ ] The app works fully with no document uploaded (story 25)
- [ ] PDFs without a text layer are rejected/flagged (V1 requires a text layer)

## Blocked by

- #6
