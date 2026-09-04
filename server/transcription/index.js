"use strict";

// Phase-1 transcription (D3 phase 1, D4). The two-phase pipeline (D3) reads a
// board in two steps: Phase 1 turns crops into a *transcription* the user reviews
// and corrects; Phase 2 turns the corrected transcription into notes. Notes are
// NEVER generated from uncorrected text, so this module deliberately stops at the
// transcription — it produces no notes and knows nothing about them.
//
//   const transcriber = createTranscriber({ gemini, userId });   // or { recognizer }
//   const artifact = await transcriber.transcribe(crops, { userId });
//
// The artifact is the persisted Phase-1 deliverable, one per board, that the
// transcription review UI (slice #4) edits:
//
//   {
//     phase: "transcription",           // never carries notes (D3)
//     hasUnclear: boolean,              // any [unclear] gap anywhere? (UI badge)
//     entries: [                        // one per crop, in crop order
//       { cropId, segments: [{ text, uncertain }], sourceElementIds, bbox }
//     ]
//   }
//
// Segments are stored STRUCTURED — a list of { text, uncertain } per crop, never a
// flat string — so the deferred two-pass disagreement flag (D4: run twice, word-
// diff, mark divergent words uncertain) can be added later without a rewrite. An
// illegible scrawl is a first-class `[unclear]` gap: an `uncertain` segment the
// user can tap and fix (story 6). The app never silently guesses at, drops, or
// flattens away a gap (story 7) — every crop the recognizer returns rides into the
// artifact untouched, uncertain segments included.
//
// The actual reading is the recognize seam's job (slice #2): it owns the Gemini
// grounding prompt, the batched multi-image request, the typed-text bypass, and
// the degrade-to-[unclear] rules. This module composes that seam and assembles the
// artifact around it — the single place transcription is shaped and its invariants
// (structured segments, preserved gaps) are asserted. All model access stays behind
// the central Gemini module (D2/D23) via the recognizer; this module never touches
// the SDK.

const { createRecognizer } = require("../recognition");

// Build a transcriber. Either hand it a ready-made `recognizer` (callers that
// already hold one), or a central `gemini` module (and optional default `userId`)
// from which a recognizer is built here. One of the two is required — a transcriber
// with no way to read fails loud rather than silently returning empty artifacts.
function createTranscriber({ recognizer, gemini, userId: defaultUserId } = {}) {
  const reader =
    recognizer || (gemini ? createRecognizer({ gemini, userId: defaultUserId }) : null);
  if (!reader || typeof reader.recognize !== "function") {
    throw new Error(
      "createTranscriber: a recognizer or a central gemini module is required"
    );
  }

  async function transcribe(crops = [], { userId = defaultUserId } = {}) {
    // Delegate the read to the recognize seam. It returns, in crop order, one
    // reading per crop already in the structured-segment shape, with omitted or
    // illegible crops degraded to [unclear] gaps (never dropped) — the invariant
    // Phase 1 depends on. We assemble the persisted artifact around that.
    const readings = await reader.recognize(crops, { userId });

    const entries = readings.map((r) => ({
      cropId: r.cropId,
      segments: r.segments,
      sourceElementIds: r.sourceElementIds,
      bbox: r.bbox,
    }));

    const hasUnclear = entries.some((e) =>
      e.segments.some((s) => s.uncertain)
    );

    // No `notes` key: Phase 1 stops before notes on purpose (D3). Downstream reads
    // `phase` to know this artifact is not yet a notes document.
    return { phase: "transcription", hasUnclear, entries };
  }

  return { transcribe };
}

module.exports = { createTranscriber };
