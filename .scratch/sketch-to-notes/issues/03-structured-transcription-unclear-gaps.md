# Structured transcription + [unclear] gaps (D3 phase 1, D4)

Status: done
Slice: 3

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D3 phase 1, D4).

## What to build

Ship Phase 1 of the two-phase pipeline: crops → transcription with `[unclear]` handling, and no notes yet. Notes are a separate phase and are never generated from uncorrected text.

Store the transcription as **structured segments** (a list of `{ text, uncertain }`) per crop, not a flat string, so the deferred two-pass disagreement flag can be added later without a rewrite. Illegible ink is surfaced as a first-class `[unclear]` gap — the app never silently guesses at a scrawl. Ship single-pass; two-pass (run twice at non-zero temperature, word-diff, mark divergent words uncertain) is deferred until confident-misreads prove real in daily use.

## Acceptance criteria

- [ ] Phase 1 produces transcription only (no notes) from the `recognize` output
- [ ] Transcription is persisted as structured `{ text, uncertain }` segments, not a flat string (story: enables two-pass later)
- [ ] Illegible ink is represented as a first-class `[unclear]` gap, never a silent guess (story 6)
- [ ] Unit tests assert the structured-segment shape with a stubbed model (D4)

## Blocked by

- #2
