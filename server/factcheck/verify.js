"use strict";

// Local citation verification (D15) — the gate every fact-check flag passes through
// before it is shown. A correction is EVIDENCE, not the model just asserting things
// (story 27), so a flag survives only when its citation actually holds up locally:
//
//   1. The cited chunk exists — a chunk among the retrieved hits whose docId AND
//      page match the flag's citation. A citation that points at a page or document
//      no retrieved chunk covers is unverifiable (the model invented the pointer).
//   2. The sourceClaim traces to that cited chunk — every key term of the claim
//      appears in the cited chunk's text. A claim that introduces a term the chunk
//      never contains is the model asserting, not reading, so the flag is dropped.
//
// This is a pure string/term match — NOT an AI call — so it adds zero Gemini cost
// and is fully deterministic. It reuses notes/verify.js's tokenizer + stopword set
// verbatim so "traces to the source" means the same thing for a flag's source claim
// as for a note line, and the same drop rule (ALL key terms must be present) applies.

const { keyTerms, tokenize } = require("../notes/verify");

// Find the retrieved chunk a citation points at: same docId AND same page. The
// citation model is { docId, page } (D14), so a flag must cite a chunk we actually
// retrieved — verification is against THAT chunk, not any chunk that happens to
// contain the terms, because the citation is a promise the user will click to jump
// to that exact page (story 24).
function citedChunk(citation, chunks) {
  if (!citation || citation.docId == null || citation.page == null) return null;
  if (!Array.isArray(chunks)) return null;
  return (
    chunks.find(
      (c) => c && c.docId === citation.docId && c.page === citation.page
    ) || null
  );
}

// Keep a flag only when its citation resolves to a retrieved chunk AND every key
// term of its sourceClaim appears in that chunk. A flag with no citation, a citation
// to an unretrieved page/doc, or a source claim with no key terms (all glue words)
// is unverifiable and dropped.
function verifyFlag(flag, chunks) {
  if (!flag || typeof flag.sourceClaim !== "string") return false;

  const chunk = citedChunk(flag.citation, chunks);
  if (!chunk || typeof chunk.text !== "string") return false;

  const terms = keyTerms({ text: flag.sourceClaim });
  if (terms.length === 0) return false;

  const haystack = new Set(tokenize(chunk.text));
  return terms.every((t) => haystack.has(t));
}

module.exports = { verifyFlag, citedChunk };
