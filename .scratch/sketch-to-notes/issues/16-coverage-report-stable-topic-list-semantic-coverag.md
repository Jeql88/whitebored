# Coverage report — stable topic list + semantic coverage (D16)

Status: ready-for-agent
Slice: 16

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D16).

## What to build

A coverage report of which document topics the board does and doesn't touch, built in two steps so the count stays trustworthy.

(1) At document upload/embed time, one Gemini pass extracts a **stable topic list** (each: label + page range) stored with the document — this fixes the "N topics" denominator so it doesn't wobble across regenerations. (2) At report time, each topic's board-coverage is judged **semantically** using the retrieval embeddings (cosine over board content vectors against a threshold) or a cheap judgment pass; gaps cite the topic's page range.

Gaps are **surfaced but never silently added to the notes** — the tool stays a revision aid, not a crutch. V1 coverage is single-board vs. document; the group-space union arrives with the Space work.

## Acceptance criteria

- [ ] A stable topic list (label + page range) is extracted once at upload and stored with the document (story 31)
- [ ] The "N topics" denominator stays stable across regenerations
- [ ] Each topic's coverage is judged semantically via embeddings; gaps cite the topic's page range (story 30)
- [ ] Gaps are surfaced but never auto-added to the notes (story 32)
- [ ] Coverage is single-board vs. document in V1

## Blocked by

- #12
- #15
