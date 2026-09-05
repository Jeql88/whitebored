// Moving an AI-chat answer into the notes artifact, client side (D11, D12).
//
// The server owns the authoritative rule (server/notes/fromChat.js) and re-checks
// every move. This mirror exists so the UI never OFFERS an action the server would
// refuse: general knowledge has no "Add to notes" button at all (story 19), and a
// document answer without a usable citation is not offered either, because a
// half-citation is not evidence.

// A citation needs both a document and a page — the pair the viewer deep-links to.
export function usableCitation(source) {
  if (!source || typeof source.docId !== "string" || !source.docId) return null;
  const page = source.page;
  if (!Number.isInteger(page) || page < 1) return null;
  return { docId: source.docId, page };
}

// Does this message get an "Add to notes" affordance?
export function isAddable(message) {
  if (!message || message.role !== "assistant") return false;
  if (typeof message.text !== "string" || !message.text.trim()) return false;

  const source = message.source;
  if (!source || source.addableToNotes !== true) return false;

  if (source.bucket === "document") return usableCitation(source) !== null;
  return source.bucket === "board";
}

// The payload the editor emits for the server to persist. Provenance rides along
// so the moved line keeps its origin: a board answer becomes a chat-origin line
// carrying shapes, a document answer an origin=document line carrying a citation.
export function addToNotesPayload(message) {
  if (!isAddable(message)) return null;
  const { source } = message;
  return {
    text: message.text.trim(),
    bucket: source.bucket,
    sourceElementIds:
      source.bucket === "document"
        ? []
        : (Array.isArray(source.sourceElementIds) ? source.sourceElementIds : []),
    citation: source.bucket === "document" ? usableCitation(source) : null,
  };
}
