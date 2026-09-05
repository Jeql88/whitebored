"use strict";

// Moving an AI-chat answer into the notes artifact (D11, D12).
//
// The rule this module exists to enforce: general knowledge must never be
// laundered into the notes. An answer is addable only when slice #13's provenance
// classifier already VERIFIED it against real material — board text or a real
// retrieved chunk. We trust that verdict and re-check its evidence here; we never
// take the model's word for it.
//
//   lineFromChatMessage(message) -> D6 line | null
//   isAddable(message)           -> boolean      (does the "Add to notes" button show?)
//   notesDeckLines(notes)        -> lines[]      (the shapes-only notes deck, D12)
//
// A moved line keeps its origin so provenance survives the move:
//   board answer    -> origin "chat",     carries sourceElementIds (traces to ink)
//   document answer -> origin "document", carries { docId, page }  (traces to a page)
//
// The two are deliberately different: a document line is welcome in the notes
// ARTIFACT but is excluded from the notes-only flashcard deck, which stays
// shapes-only so every card in it can be highlighted back to the board (story 36).

// Origins that trace to board ink, and so belong in the notes-only deck. A
// chat-added board answer earned its shapes the same way a generated line did.
const DECK_ORIGINS = ["board", "chat"];

// A citation is usable only when it names both a document and a page — the pair
// the viewer needs to deep-link (slice #11's jump-to-page). A half-citation is
// not evidence, so the answer carrying it is not addable.
function usableCitation(source) {
  if (!source || typeof source.docId !== "string" || !source.docId) return null;
  const page = source.page;
  if (!Number.isInteger(page) || page < 1) return null;
  return { docId: source.docId, page };
}

// Can this message move into the notes? Only a verified assistant answer whose
// provenance bucket is board or document — never general knowledge (story 19),
// never the user's own turn. A document answer additionally needs its citation.
function isAddable(message) {
  if (!message || message.role !== "assistant") return false;
  if (typeof message.text !== "string" || !message.text.trim()) return false;

  const source = message.source;
  if (!source || source.addableToNotes !== true) return false;

  if (source.bucket === "document") return usableCitation(source) !== null;
  return source.bucket === "board";
}

// Turn an addable answer into a D6 note line. Returns null for anything not
// addable, so the caller can route the refusal without a second check.
function lineFromChatMessage(message) {
  if (!isAddable(message)) return null;

  const { source } = message;
  const line = {
    text: message.text.trim(),
    // A chat answer is a recalled point, not a heading or an ordered step.
    kind: "key-point",
    sourceElementIds: [],
    origin: source.bucket === "document" ? "document" : "chat",
  };

  if (line.origin === "document") {
    // A document line points at a page, never at ink — that is what keeps it out
    // of the shapes-only deck below.
    line.citation = usableCitation(source);
  } else {
    line.sourceElementIds = Array.isArray(source.sourceElementIds)
      ? source.sourceElementIds.filter((id) => typeof id === "string")
      : [];
  }

  return line;
}

// The notes-only deck's source lines (D12): board- and chat-origin only. Document
// lines live in the artifact but are excluded here, so the deck stays shapes-only
// and every card it produces can be highlighted back to the board.
function notesDeckLines(notes) {
  const lines = notes && Array.isArray(notes.lines) ? notes.lines : [];
  return lines.filter((l) => l && DECK_ORIGINS.includes(l.origin));
}

module.exports = { lineFromChatMessage, isAddable, notesDeckLines, DECK_ORIGINS };
