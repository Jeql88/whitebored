"use strict";

// Uniform "pages" model for documents (D13). Every attached document — PDF, image,
// or plaintext — is normalized to the SAME internal shape so the citation model is
// uniform across types: later slices cite a document by { docId, page } regardless
// of what kind of file it is.
//
//   page ::= { page: number(1-based), text: string }
//
//   - PDF   → one page per real PDF page, each carrying that page's extracted text.
//   - image → a SINGLE page (page 1), text empty (an image has no text layer).
//   - text  → synthetic pages: the plaintext split into sections/chunks, each a
//             "page" so a citation can still point somewhere specific.
//
// V1 requires a TEXT LAYER (D13): a scanned PDF with no extractable text is
// rejected — OCR of scanned documents is deferred. The text-layer gate lives here
// so both the route and the store share one definition of "has a text layer".
//
// This module is pure (no I/O, no db, no GridFS) so it is trivially unit-tested.
// The caller is responsible for having already turned the raw upload into either a
// list of per-page texts (PDF) or a single blob of text (plaintext); this module
// only normalizes and validates that into the uniform page list.

// The kinds we accept (D13). Anything else is rejected at the route.
const DOC_KINDS = ["pdf", "image", "text"];

// Roughly how many characters of plaintext become one synthetic "page". Small
// enough that a citation points to a useful span, large enough not to explode a
// long text file into hundreds of pages. Splitting prefers paragraph boundaries.
const TEXT_PAGE_TARGET_CHARS = 1500;

function isTextLayerPresent(pages) {
  // A document has a usable text layer if ANY page carries non-whitespace text.
  return (
    Array.isArray(pages) &&
    pages.some((p) => typeof p.text === "string" && p.text.trim().length > 0)
  );
}

// Normalize an array of per-page raw texts (a PDF's pages) into the page shape.
// Empty/whitespace page texts are kept (a PDF can have a blank page) — the
// text-layer gate looks at the document as a whole, not per page.
function pagesFromPdf(pageTexts) {
  const arr = Array.isArray(pageTexts) ? pageTexts : [];
  return arr.map((text, i) => ({
    page: i + 1,
    text: typeof text === "string" ? text : "",
  }));
}

// An image is a single page with no text layer. It is always allowed (the caller
// decides policy) — but note isTextLayerPresent() will be false for an image
// alone, which the route uses to reject text-layer-required uploads if needed.
function pagesFromImage() {
  return [{ page: 1, text: "" }];
}

// Split plaintext into synthetic pages at paragraph boundaries, packing paragraphs
// up to ~TEXT_PAGE_TARGET_CHARS per page. A single very long paragraph becomes its
// own page (never split mid-word here — chunking for embeddings is slice #12's job;
// this is just the citation surface). Always yields at least one page for non-empty
// text; empty text yields no pages (the text-layer gate then rejects it).
function pagesFromText(text) {
  const raw = typeof text === "string" ? text : "";
  if (!raw.trim()) return [];

  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pages = [];
  let buf = "";
  for (const para of paragraphs) {
    if (buf && buf.length + para.length + 2 > TEXT_PAGE_TARGET_CHARS) {
      pages.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  if (buf) pages.push(buf);

  // A blob with no blank lines still yields one page.
  if (pages.length === 0) pages.push(raw.trim());

  return pages.map((t, i) => ({ page: i + 1, text: t }));
}

// Build the uniform page list for a document of a given kind from its extracted
// source. `source` is: PDF → array of per-page texts; image → ignored; text →
// the plaintext string. Throws on an unknown kind (fail loud on the unexpected).
function normalizePages(kind, source) {
  switch (kind) {
    case "pdf":
      return pagesFromPdf(source);
    case "image":
      return pagesFromImage();
    case "text":
      return pagesFromText(source);
    default:
      throw new Error(`normalizePages: unknown document kind "${kind}"`);
  }
}

module.exports = {
  DOC_KINDS,
  TEXT_PAGE_TARGET_CHARS,
  isTextLayerPresent,
  normalizePages,
  pagesFromPdf,
  pagesFromImage,
  pagesFromText,
};
