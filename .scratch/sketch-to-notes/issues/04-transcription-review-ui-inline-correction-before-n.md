# Transcription review UI — inline correction before notes (D3)

Status: ready-for-agent
Slice: 4

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D3).

## What to build

The transcription review step: the user sees exactly what the AI read **before** notes are written, and corrects it inline. Wrong words are fixed in place; `[unclear]` gaps can be tapped and filled. Notes generation is gated behind this — Phase 2 runs only on corrected transcription, so misreads are caught before they propagate into notes. Original strokes remain the source of truth and are never auto-deleted, so the user can always re-read them.

## Acceptance criteria

- [ ] The transcription is shown for review before any notes are generated (story 4)
- [ ] The user can correct wrong words inline, and tap an `[unclear]` gap to fill it (stories 5, 6)
- [ ] Notes generation is blocked until the transcription is confirmed/corrected
- [ ] Corrections mutate the stored structured segments used by Phase 2
- [ ] Original strokes are never auto-deleted (story 7)

## Blocked by

- #3
