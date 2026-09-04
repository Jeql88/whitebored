"use strict";

// Notes generation (Phase 2 of the pipeline, D6/D8/D9) — turns a CORRECTED
// transcription into the persistent Notes artifact beside the canvas. This is the
// hub many later slices build on (regenerate, cards, search, documents, AI chat).
//
//   const notes = createNotesGenerator({ gemini, userId });
//   const record = await notes.generate({
//     transcription,           // the corrected phase-1 artifact (or plain text)
//     noteType,                // "lecture" | "meeting" | "process" | "freeform"
//     boardId,                 // stamped onto the record (one record per board)
//     onLine,                  // optional streaming seam: called per VERIFIED line
//     userId,                  // per-user throttle key (defaults to constructor's)
//   });
//
// The record is the D6 shape — a structured list of lines, ONE record per board:
//
//   {
//     boardId,
//     noteType,                        // which prompt template produced it (D8)
//     lines: [
//       { text, kind, sourceElementIds, origin }
//     ],
//   }
//
//   kind   ::= "summary" | "heading" | "key-point" | "sequence-step"
//   origin ::= "board" | "chat"        (this slice generates board-origin lines;
//                                        chat-added lines arrive later, slice #13)
//
// TYPE CHANGES THE PROMPT ONLY (D8). Lecture / Meeting / Process / Freeform are
// four prompt templates feeding the SINGLE line shape above — the schema is
// identical across types; only the framing sent to the model differs.
//
// STREAMING + LOCAL VERIFICATION (D9). Lines are emitted one at a time through the
// injected `onLine` seam as they are parsed. Each line is shown ONLY after passing
// the LOCAL key-terms verification in verify.js (its terms appear in the
// transcription — a string match, NOT an AI call), so a line never flickers in and
// gets retracted. An un-traceable line is dropped: not emitted, not persisted.
//
// All model access is through the central Gemini module (D2/D23); this module never
// touches the SDK, and a deferred ("working") result is awaited so a throttled call
// still yields notes rather than failing (story 56). The Gemini client is stubbed
// in tests — no network, no real model.

const { verifyLine, transcriptionText } = require("./verify");

const NOTE_KINDS = ["summary", "heading", "key-point", "sequence-step"];

// The four note types (D8/story 10). Each maps to a prompt framing; the requested
// JSON line shape is identical across all four (buildRequest appends it). The exact
// wording is server-side grounding and is never asserted in tests (tests assert on
// the RESULT), but each framing must forbid inventing anything not on the board.
const NOTE_TYPES = {
  lecture:
    "Shape these into lecture notes: a short summary, then headings and key " +
    "points under them.",
  meeting:
    "Shape these into meeting notes: decisions and action items as key points " +
    "under clear headings.",
  process:
    "Shape these into an ordered process: sequence steps in the order the " +
    "diagram's arrows and bindings imply, each step a sequence-step line.",
  freeform:
    "Shape these into clean freeform notes: keep the user's structure, tidy the " +
    "wording, add headings only where they clarify.",
};

const DEFAULT_NOTE_TYPE = "freeform";

// Shared grounding fence appended to every type's framing (§7 / D6): the board is
// the only source, the output schema is fixed, nothing may be invented. Kept terse.
const SCHEMA_FENCE =
  "Use ONLY the transcription below as source — never add facts, topics, or terms " +
  "that are not present in it. Return ONLY JSON: an array of note lines, each " +
  '{ "text": string, "kind": one of ' +
  `${JSON.stringify(NOTE_KINDS)}, "sourceElementIds": string[] }. ` +
  "sourceElementIds must reference the element ids the line came from.";

function promptFor(noteType) {
  return NOTE_TYPES[noteType] || NOTE_TYPES[DEFAULT_NOTE_TYPE];
}

// Normalize a raw model line into the D6 line shape, filling defaults for a
// tolerant-but-honest parse: an unknown/absent kind degrades to "key-point"
// (a plain traceable point) rather than being dropped for a formatting slip;
// sourceElementIds defaults to []. origin is always "board" here — chat-origin
// lines are added by a different path (slice #13). A line with no usable text is
// returned as null so the caller can skip it.
function normalizeLine(raw) {
  if (!raw || typeof raw.text !== "string" || !raw.text.trim()) return null;
  const kind = NOTE_KINDS.includes(raw.kind) ? raw.kind : "key-point";
  const ids = Array.isArray(raw.sourceElementIds)
    ? raw.sourceElementIds.filter((id) => typeof id === "string")
    : [];
  return {
    text: raw.text.trim(),
    kind,
    sourceElementIds: ids,
    origin: "board",
  };
}

// Parse the model's JSON into a raw line array. A malformed reply must not crash
// generation — it yields no lines (degrade gracefully on the foreseen), same as an
// empty board. Accepts either a bare array or an object wrapping a `lines` array,
// since models vary in how they frame a top-level list.
function parseLines(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return [];
  }
  if (Array.isArray(obj)) return obj;
  if (obj && Array.isArray(obj.lines)) return obj.lines;
  return [];
}

// Pull the JSON text out of a central-module result. { status:"ok", response }
// now, or { status:"deferred", done } when throttled — await the working state so
// notes still come back on a busy moment (story 56). Mirrors recognize.js's textOf
// so both seams read the module identically.
async function textOf(result) {
  const settled = result.status === "deferred" ? await result.done : result;
  const response = settled.response;
  return typeof response === "string" ? response : response?.text ?? "";
}

function buildRequest(userId, transcription, noteType) {
  const source = transcriptionText(transcription);
  const instruction = `${promptFor(noteType)}\n\n${SCHEMA_FENCE}`;
  return {
    userId,
    contents: [
      {
        role: "user",
        parts: [{ text: instruction }, { text: `Transcription:\n${source}` }],
      },
    ],
    config: { responseMimeType: "application/json" },
  };
}

function createNotesGenerator({ gemini, userId: defaultUserId } = {}) {
  if (!gemini || typeof gemini.generate !== "function") {
    throw new Error("createNotesGenerator: a central Gemini module is required");
  }

  // Generate the notes record from a corrected transcription. Streams each
  // VERIFIED line through `onLine` as it is confirmed, and returns the full record
  // (verified lines only) for persistence. `noteType` selects the prompt template
  // only — all types produce the same line shape.
  async function generate({
    transcription,
    noteType = DEFAULT_NOTE_TYPE,
    boardId,
    onLine,
    userId = defaultUserId,
  } = {}) {
    const request = buildRequest(userId, transcription, noteType);
    const result = await gemini.generate(request);
    const raw = parseLines(await textOf(result));

    // The transcription is flattened once and reused as the verification haystack
    // for every line — the D9 local key-terms gate. A line whose key terms are not
    // all present in the transcription is dropped: never emitted, never persisted,
    // so nothing untraceable reaches the artifact and nothing flickers/retracts.
    const source = transcriptionText(transcription);

    const lines = [];
    for (const rawLine of raw) {
      const line = normalizeLine(rawLine);
      if (!line) continue;
      if (!verifyLine(line, source)) continue; // un-traceable → drop (D9)
      lines.push(line);
      // Emit only after the line has passed verification, so a streamed line is
      // always one the user gets to keep (story 15).
      if (typeof onLine === "function") onLine(line);
    }

    return { boardId, noteType, lines };
  }

  return { generate };
}

// Production wiring: build a notes generator from a central Gemini module (built
// from config elsewhere). Returns null when no Gemini module is configured so the
// notes feature degrades gracefully (mirrors createGeminiFromConfig / the OCR
// route) rather than crashing the server at boot.
function createNotesFromGemini(gemini) {
  if (!gemini) return null;
  return createNotesGenerator({ gemini });
}

module.exports = {
  createNotesGenerator,
  createNotesFromGemini,
  NOTE_TYPES,
  NOTE_KINDS,
  DEFAULT_NOTE_TYPE,
};
