"use strict";

// Provenance classification for AI-chat answers (slice #13, D11).
//
// The source tag on a chat answer is PROVENANCE-BASED, NOT self-reported: it is
// derived here from which context bucket actually grounds the answer, and a
// board/document tag is VERIFIED LOCALLY before it is allowed to render. The model
// may claim anything; this gate never trusts the claim. It is a pure function — no
// model call, no network — so an untraceable "fact" can never sneak a board/document
// tag in through the side door.
//
//   classifyProvenance({ answer, citation?, notInMaterial?, boardText, hits, documents })
//     -> { bucket, label, addableToNotes, docId?, page? }
//
//   bucket ::= "board" | "document" | "general"
//
// The three buckets, most-specific first:
//   document — the model emitted a citation { docId, page } that points at a REAL
//              retrieved chunk (same docId AND page in `hits`). Only then does a
//              "from [filename], p.N" tag render. A citation matching no chunk is a
//              self-report and is not trusted.
//   board    — no valid citation, the model did not disclaim the material, and the
//              answer's key terms all appear in the board text (the same local
//              key-terms check the notes artifact uses). Renders "from your board".
//   general  — everything else, including when the model says "not in your material".
//              Visually distinct downstream so untraceable facts are unmistakable.
//
// Board/document answers are addable to notes (story 19); general knowledge is not.

// Reuse the notes artifact's local key-terms matcher READ-ONLY — the same gate that
// keeps un-traceable lines out of the Notes artifact keeps an un-grounded "board"
// tag off a chat answer. One verification rule across the whole feature.
const { keyTerms, tokenize } = require("../notes/verify");

const LABELS = {
  board: "from your board",
  general: "general knowledge",
};

// How much of a chat answer's substance must trace to the board before it may wear a
// "from your board" tag. Unlike a Notes line (fenced to board terms only, so it
// requires EVERY term), a conversational answer legitimately adds connective wording
// ("comes before", "is the"), so we require a MAJORITY of its key terms to appear in
// the board rather than all of them — grounded enough to trust, generous with prose.
const BOARD_MATCH_THRESHOLD = 0.5;

// Does a majority of the answer's key terms appear in the board text? An answer with
// no key terms (empty / all stopwords) does not verify as board — nothing to trace.
function verifiesAgainstBoard(answer, boardText) {
  const terms = keyTerms({ text: typeof answer === "string" ? answer : "" });
  if (terms.length === 0) return false;
  const haystack = new Set(tokenize(typeof boardText === "string" ? boardText : ""));
  const matched = terms.filter((t) => haystack.has(t)).length;
  return matched / terms.length >= BOARD_MATCH_THRESHOLD;
}

// Does the citation point at a real retrieved chunk? A tag renders only when the
// model's { docId, page } is actually present in the retrieved set — never on the
// model's word alone.
function verifiedChunk(citation, hits) {
  if (!citation || citation.docId == null || citation.page == null) return null;
  const list = Array.isArray(hits) ? hits : [];
  return (
    list.find(
      (h) => h && h.docId === citation.docId && h.page === citation.page
    ) || null
  );
}

function documentLabel(docId, page, documents) {
  const meta = documents && documents[docId];
  const name = meta && meta.filename ? meta.filename : docId;
  return `from ${name}, p.${page}`;
}

function general() {
  return { bucket: "general", label: LABELS.general, addableToNotes: false };
}

function classifyProvenance({
  answer,
  citation,
  notInMaterial,
  boardText,
  hits,
  documents,
} = {}) {
  // The model explicitly disclaimed the material → honest general knowledge, even if
  // some terms coincide with the board. Respect the disclaimer.
  if (notInMaterial) return general();

  // Document is the most specific provenance — a citation verified against a real
  // retrieved chunk wins over a coincidental board term match.
  const hit = verifiedChunk(citation, hits);
  if (hit) {
    return {
      bucket: "document",
      label: documentLabel(citation.docId, citation.page, documents),
      docId: citation.docId,
      page: citation.page,
      addableToNotes: true,
    };
  }

  // Board next — the answer's substance traces to the board text.
  if (verifiesAgainstBoard(answer, boardText)) {
    return { bucket: "board", label: LABELS.board, addableToNotes: true };
  }

  // Neither verified → general knowledge (also the home of an unverifiable citation).
  return general();
}

module.exports = { classifyProvenance };
