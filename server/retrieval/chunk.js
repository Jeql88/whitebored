"use strict";

// Pure chunking for the retrieval seam (D14). Turns a document's uniform page list
// (slice #11's { page, text } — see documents/pages.js) into the text spans that get
// embedded and stored as chunk records. No I/O, no model — so chunking is unit-tested
// directly and is deterministic.
//
// Why chunk under the page grain: a page can be large (a real PDF page, or a
// ~1500-char synthetic text "page"), and retrieval wants spans small enough that a
// hit is specific. Every chunk KEEPS its source page number so the citation model
// stays { docId, page } (1-based) — the page lines up with the viewer's jump-to-page.
//
//   chunkPages(pages, { targetChars? }) -> [ { page, text }, ... ]
//
// Each output chunk carries the page it came from; a page too long for one chunk
// splits into several chunks that all share that page number. Empty/whitespace pages
// (an image page, a blank PDF page) contribute no chunks — nothing to embed or cite.

// Default span size for one embeddable chunk, in characters. Smaller than a synthetic
// text page (documents' TEXT_PAGE_TARGET_CHARS = 1500) so a long real PDF page still
// breaks into a few focused spans; large enough that a chunk carries real context.
const DEFAULT_CHUNK_CHARS = 1000;

// Split one page's text into <= targetChars spans, preferring sentence/paragraph
// boundaries so a chunk is not cut mid-thought. A single boundary-free run longer
// than the target is hard-split so no chunk is unbounded (a giant chunk both
// embeds worse and cites vaguely).
function splitText(text, targetChars) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return [];

  // Break on paragraph, then sentence-ish boundaries; keep the delimiters attached
  // to the preceding fragment so text is preserved verbatim across the join.
  const fragments = trimmed
    .split(/(?<=[.!?])\s+|\n\s*\n/)
    .map((f) => f.trim())
    .filter(Boolean);

  const spans = [];
  let buf = "";
  const flush = () => {
    if (buf) spans.push(buf);
    buf = "";
  };

  for (let frag of fragments) {
    // A fragment longer than the target on its own: hard-split it into target-sized
    // pieces so nothing exceeds the bound.
    while (frag.length > targetChars) {
      flush();
      spans.push(frag.slice(0, targetChars));
      frag = frag.slice(targetChars);
    }
    if (buf && buf.length + frag.length + 1 > targetChars) flush();
    buf = buf ? `${buf} ${frag}` : frag;
  }
  flush();
  return spans;
}

// Chunk a document's page list into embeddable spans, each tagged with its 1-based
// source page. Pages without a text layer contribute nothing.
function chunkPages(pages, { targetChars = DEFAULT_CHUNK_CHARS } = {}) {
  if (!Array.isArray(pages)) return [];
  const chunks = [];
  for (const p of pages) {
    if (!p || typeof p.text !== "string") continue;
    for (const text of splitText(p.text, targetChars)) {
      chunks.push({ page: p.page, text });
    }
  }
  return chunks;
}

module.exports = { chunkPages, splitText, DEFAULT_CHUNK_CHARS };
