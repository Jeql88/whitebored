// Framework-free correction logic for the Phase-1 transcription review (D3, D4).
//
// The transcription artifact (built server-side by server/transcription) is the
// Phase-1 deliverable the user reviews and corrects BEFORE notes are generated:
//
//   {
//     phase: "transcription",
//     hasUnclear: boolean,               // any [unclear] gap left anywhere?
//     entries: [                         // one per crop, in crop order
//       { cropId, segments: [{ text, uncertain }], sourceElementIds, bbox }
//     ]
//   }
//
// Phase 2 later consumes the STRUCTURED segments, so corrections mutate those
// segments in place (by value — these helpers are pure and return new artifacts,
// never mutating the input). An `[unclear]` gap is a segment with uncertain:true;
// filling it clears the flag once the user supplies text. `hasUnclear` is always
// recomputed from the segments so it can never drift out of sync with them.
//
// Kept framework-free on purpose: the React component (TranscriptionReview) is a
// thin shell over this, and this file is trivially unit-testable on its own.

// Recompute the artifact-wide gap badge from the actual segment state. A segment
// still counts as an [unclear] gap only while it is BOTH flagged uncertain AND
// still empty — once the user types into a gap it is considered filled.
export function computeHasUnclear(entries = []) {
  return entries.some((entry) =>
    (entry.segments || []).some((seg) => seg.uncertain && !seg.text.trim())
  );
}

// True while a single segment is still an open [unclear] gap (flagged + empty).
export function isOpenGap(segment) {
  return Boolean(segment && segment.uncertain && !segment.text.trim());
}

// Correct one segment's text in place. Returns a new artifact with the segment at
// (cropId, segmentIndex) replaced. Editing a segment clears its uncertain flag —
// the user has now vouched for the text, so it is no longer a gap or a guess. An
// unknown cropId/segmentIndex is a programmer error, so we fail loud (CONVENTIONS:
// fail loud on the unexpected) rather than silently returning the artifact unchanged.
export function correctSegment(artifact, cropId, segmentIndex, text) {
  const entryIndex = artifact.entries.findIndex((e) => e.cropId === cropId);
  if (entryIndex === -1) {
    throw new Error(`correctSegment: no entry for cropId "${cropId}"`);
  }
  const entry = artifact.entries[entryIndex];
  if (segmentIndex < 0 || segmentIndex >= entry.segments.length) {
    throw new Error(
      `correctSegment: segment index ${segmentIndex} out of range for cropId "${cropId}"`
    );
  }

  const segments = entry.segments.map((seg, i) =>
    i === segmentIndex ? { ...seg, text, uncertain: false } : seg
  );
  const entries = artifact.entries.map((e, i) =>
    i === entryIndex ? { ...e, segments } : e
  );

  return { ...artifact, entries, hasUnclear: computeHasUnclear(entries) };
}

// The corrected artifact Phase 2 consumes. Identity by shape today (corrections
// already live in the artifact via correctSegment), but this is the single named
// seam slice #6 reads, and where any confirm-time normalization would land. Only
// the phase-1 transcription artifact may be confirmed — a notes/other-phase object
// reaching here is a caller bug, so fail loud.
export function confirmArtifact(artifact) {
  if (!artifact || artifact.phase !== "transcription") {
    throw new Error("confirmArtifact: expected a phase:\"transcription\" artifact");
  }
  return { ...artifact, hasUnclear: computeHasUnclear(artifact.entries) };
}
