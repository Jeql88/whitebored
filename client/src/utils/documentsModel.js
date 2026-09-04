// Framework-free helpers for the Documents tab (D13, slice #11), client side.
//
// A document attached to a board is addressed uniformly by { docId, page } — the
// same citation surface for PDF, image, and text (server: server/documents). The
// server normalizes every document to a list of pages:
//
//   document ::= {
//     docId, boardId, kind: "pdf"|"image"|"text", filename, contentType,
//     pages: [ { page: 1-based number, text: string } ]
//   }
//
// These helpers own the small state transitions the Documents panel needs (which
// document is open, which page is shown, clamping a jump target) so the React
// component stays a thin, testable shell over them — the same split as
// notesArtifact / transcriptionCorrections.

export const DOC_KINDS = ["pdf", "image", "text"];

// A citation deep-links to one page of one document (story 24). Keep the shape
// tiny and explicit so a fact-check flag or chat source tag can produce it.
export function citation(docId, page = 1) {
  return { docId, page };
}

// How many pages a document has (0 for a not-yet-loaded or empty document).
export function pageCount(doc) {
  return doc && Array.isArray(doc.pages) ? doc.pages.length : 0;
}

// Clamp a requested page into the document's real range (1..pageCount). Returns 1
// for an empty/absent document so the viewer always has a valid page to show. This
// is the jump-to-page guard: a citation pointing past the end lands on the last
// page rather than blanking the viewer.
export function clampPage(doc, requested) {
  const total = pageCount(doc);
  if (total === 0) return 1;
  const n = Number(requested) || 1;
  if (n < 1) return 1;
  if (n > total) return total;
  return n;
}

// The page record ({ page, text }) for a given 1-based number, or null.
export function pageAt(doc, pageNumber) {
  if (!doc || !Array.isArray(doc.pages)) return null;
  return doc.pages.find((p) => p.page === Number(pageNumber)) || null;
}

// Does a citation point at a document/page that actually exists in `doc`? Used to
// verify a deep-link before it is offered (mirrors the server's local citation
// verification, D11/D13).
export function isResolvable(doc, cite) {
  if (!doc || !cite) return false;
  if (cite.docId && String(cite.docId) !== String(doc.docId)) return false;
  return pageAt(doc, cite.page) !== null;
}
