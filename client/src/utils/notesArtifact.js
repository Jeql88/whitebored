// Framework-free helpers for the Notes artifact (D6/D8/D9), client side.
//
// The Notes artifact (built server-side by server/notes) is the persistent,
// editable Phase-2 deliverable — one record per board:
//
//   {
//     boardId,
//     noteType,                 // "lecture" | "meeting" | "process" | "freeform"
//     lines: [                  // the D6 line shape
//       { text, kind, sourceElementIds, origin }
//     ]
//   }
//
//   kind   ::= "summary" | "heading" | "key-point" | "sequence-step"
//   origin ::= "board" | "chat"
//
// Notes STREAM in line-by-line (D9): the panel starts empty and appends each line
// the server confirms (each already past local key-terms verification server-side,
// so a rendered line never flickers or retracts). These helpers own the streaming
// state transitions so the React component stays a thin shell over them and this
// file is trivially unit-testable on its own (same split as transcriptionCorrections).

// The four note types (story 10). Value is the label the picker shows; the key is
// what the server maps to a prompt template (D8 — type changes the prompt only).
export const NOTE_TYPES = [
  { id: "lecture", label: "Lecture" },
  { id: "meeting", label: "Meeting" },
  { id: "process", label: "Process" },
  { id: "freeform", label: "Freeform" },
];

export const DEFAULT_NOTE_TYPE = "freeform";

// An empty artifact for a board — the starting state before Generate is pressed or
// while the first line is still streaming in.
export function emptyNotes(boardId, noteType = DEFAULT_NOTE_TYPE) {
  return { boardId, noteType, lines: [] };
}

// Append a streamed line to the artifact (D9). Returns a NEW artifact (never
// mutates) so React state updates are clean. A line missing text is ignored — a
// malformed stream frame must not inject a blank row.
export function appendLine(artifact, line) {
  if (!line || typeof line.text !== "string" || !line.text.trim()) {
    return artifact;
  }
  const normalized = {
    text: line.text,
    kind: line.kind || "key-point",
    sourceElementIds: Array.isArray(line.sourceElementIds)
      ? line.sourceElementIds
      : [],
    origin: line.origin || "board",
  };
  return { ...artifact, lines: [...artifact.lines, normalized] };
}

// True when a line traces to at least one board shape, i.e. clicking it can
// highlight something (story 9). A chat-origin/document line with no
// sourceElementIds is still shown, but is not clickable-to-highlight.
export function isHighlightable(line) {
  return (
    line &&
    Array.isArray(line.sourceElementIds) &&
    line.sourceElementIds.length > 0
  );
}
