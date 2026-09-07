"use strict";

// Getting the board's text, reading it first only if it changed.
//
// This is the rule that makes one chat surface affordable: a transcription is
// expensive (many images through a vision model, on a tier metered in calls per
// DAY), so it must happen when the ink changed and never otherwise. Everything
// else — answering a question, writing notes, building flashcards — runs off the
// stored transcription.
//
// Every dependency is injected so this is drivable in tests with no Mongo, no
// model and no network. The seams are:
//   loadArtifact(boardId)            -> the stored phase-1 artifact, or null
//   currentVersion(elements)         -> a stable id for the board's content
//   readBoard(boardId, opts)         -> run the vision pipeline, return artifact
//   onStatus(status, message)        -> progress, because a read is slow

const { transcriptionText } = require("../notes/verify");

// Why a read was or was not performed. Surfaced so the caller can tell the user
// something true rather than a generic wait.
const REASONS = {
  FRESH: "fresh", // stored transcription still matches the board
  CHANGED: "changed", // board differs from what was last read
  NEVER_READ: "never-read", // no transcription exists yet
  FORCED: "forced", // the user explicitly asked for a re-read
  UNAVAILABLE: "unavailable", // reading is not possible right now
};

function createBoardContext({
  loadArtifact,
  currentVersion,
  readBoard,
  onStatus,
} = {}) {
  if (typeof loadArtifact !== "function") {
    throw new Error("createBoardContext: loadArtifact is required");
  }

  // Decide whether the vision pipeline needs to run. Kept separate from doing it
  // so the decision is testable on its own and cannot be confused with a failure.
  function decide({ artifact, elements, force }) {
    if (force) return REASONS.FORCED;
    if (!artifact?.entries?.length) return REASONS.NEVER_READ;
    // No geometry to compare against (an older client, or a board that never
    // loaded) — trust what is stored rather than paying for a speculative read.
    if (!Array.isArray(elements) || elements.length === 0) return REASONS.FRESH;
    if (typeof currentVersion !== "function") return REASONS.FRESH;
    const stored = artifact.boardVersion;
    if (!stored) return REASONS.CHANGED; // read before versions existed
    return stored === currentVersion(elements) ? REASONS.FRESH : REASONS.CHANGED;
  }

  // Resolve the board to text, reading it first if needed.
  //
  // Never throws for a board reason: a failed read falls back to whatever was
  // stored, because stale text beats no answer, and the caller is told what
  // happened so it can say so.
  async function resolve({ boardId, elements, force = false, model, userId } = {}) {
    const artifact = await loadArtifact(boardId).catch(() => null);
    const reason = decide({ artifact, elements, force });

    const needsRead = reason !== REASONS.FRESH;
    if (!needsRead || typeof readBoard !== "function") {
      return {
        text: transcriptionText(artifact),
        artifact,
        reason: needsRead ? REASONS.UNAVAILABLE : REASONS.FRESH,
        didRead: false,
      };
    }

    onStatus?.("reading", "Reading your board…");

    try {
      const fresh = await readBoard(boardId, { elements, model, userId });
      const text = transcriptionText(fresh);
      // A read that came back with nothing is not an improvement on what we had.
      // Prefer the older transcription over replacing real text with silence.
      if (!text.trim() && transcriptionText(artifact).trim()) {
        return {
          text: transcriptionText(artifact),
          artifact,
          reason,
          didRead: true,
          readEmpty: true,
        };
      }
      return { text, artifact: fresh, reason, didRead: true };
    } catch (err) {
      // Reading failed — quota, a congested model, a malformed upload. Falling
      // back to the stored transcription keeps chat useful; failing the whole
      // message because a refresh failed would be worse than slightly stale text.
      console.error("[boardContext] read failed:", err.message);
      return {
        text: transcriptionText(artifact),
        artifact,
        reason,
        didRead: false,
        readError: err.message || String(err),
      };
    }
  }

  return { resolve, decide, REASONS };
}

module.exports = { createBoardContext, REASONS };
