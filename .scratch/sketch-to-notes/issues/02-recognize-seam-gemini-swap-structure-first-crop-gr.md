# recognize() seam — Gemini swap, structure-first crop grouping (D1, D2, D5)

Status: ready-for-agent
Slice: 2

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D1, D2, D5).

## What to build

Replace the current on-demand Google Vision OCR path with a reading-only `recognize` seam that reads the drawing itself with Gemini, entirely server-side. The server owns the Gemini key, the grounding prompt, the JSON schema, and every verification step; the client only groups strokes into crops, normalizes them, and uploads.

Crop grouping is structure-first, in order of reliability: (1) typed `text` elements are ground truth, routed straight to transcription and never OCR'd; (2) Excalidraw structure — `containerId` bindings, `groupIds`, geometric containment inside rectangles — defines crop boundaries where present; (3) distance-based agglomerative clustering (gap threshold scaled to stroke height) only for free-floating `freedraw` strokes with no structural signal. Each crop is normalized (upscale, uniform stroke, black-on-white, tight padding). All crops are batched into one multi-image Gemini request keyed by crop ID — per-crop linking without N round-trips. Original strokes are never auto-deleted.

The reading-only contract (notes generation is a separate later step, not part of this):

```
recognize(crops) → [ { cropId, segments: [{ text, uncertain }], sourceElementIds, bbox } ]
```

No confidence score — nothing consumes it and §7 distrusts self-reported confidence. The old Vision path is kept as a documented fallback behind this same seam.

## Acceptance criteria

- [ ] All Gemini calls run server-side; the client only crops, normalizes, and uploads
- [ ] Typed text elements bypass OCR and are routed straight to transcription (story 2)
- [ ] Excalidraw bindings/containment define crop boundaries where present; clustering applies only to free-floating strokes (story 3)
- [ ] All crops go out in one multi-image Gemini request keyed by crop ID
- [ ] `recognize(crops)` returns the structured shape above; unit tests with a stubbed model cover typed-text bypass, boundary derivation, and clustering (D5 pure seam)
- [ ] The Google Vision path remains available as a documented fallback behind the same seam
- [ ] Original strokes are never auto-deleted by recognition (story 7)

## Blocked by

- #1
