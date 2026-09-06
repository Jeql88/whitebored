"use strict";

// Local key-terms verification (D9) — the gate every streamed note line passes
// through before it is shown. A line is kept ONLY if its key terms actually appear
// in the corrected transcription; anything the model wrote that can't be traced
// back to what the board says is dropped. This is a pure string/term match — NOT
// an AI call — so it adds zero Gemini cost and is fully deterministic (spec §7:
// the board is the only source; nothing untraceable slips into the notes).
//
//   const text = transcriptionText(transcription);   // flatten once
//   verifyLine(line, text)  -> boolean                // keep the line?
//
// The check is intentionally simple and generous with formatting but strict about
// substance: a line's meaningful words (its "key terms") must be present in the
// transcription. We compare on a normalized token basis so casing, punctuation,
// and whitespace never cause a false drop, while an invented term (a word the
// board never contains) causes a true drop.

// Words that carry no traceable meaning — their presence or absence says nothing
// about whether a line came from the board, so they are excluded from the key-term
// set. Kept deliberately small: the goal is to strip glue words a summary adds for
// readability (articles, conjunctions, common prepositions/auxiliaries), not to
// build a linguistic stopword list. Structural note prose is mostly content words,
// so even this short list leaves plenty to verify against.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "as", "by", "is", "are", "was", "were", "be", "been", "being", "it",
  "its", "this", "that", "these", "those", "from", "into", "then", "than", "so",
  "we", "you", "they", "i", "he", "she", "them", "our", "your", "their",
  // --- connective vocabulary -------------------------------------------------
  // Words a writer uses to turn board fragments into readable prose. Requiring
  // them VERBATIM in the transcription was the gate's real failure: a line like
  // "Mitosis produces two daughter cells" is fully supported by a board saying
  // "mitosis ... the cell divides into two daughter cells", yet was dropped
  // because the board never literally wrote "produces". The result was a model
  // doing its job correctly and the user seeing a near-empty notes panel, with a
  // model call already spent.
  //
  // These carry no factual claim of their own — an invented FACT still shows up
  // as an unmatched noun or number, which is what the gate is actually for.
  "has", "have", "had", "having", "do", "does", "did", "can", "could", "will",
  "would", "shall", "should", "may", "might", "must", "when", "where", "which",
  "who", "whom", "whose", "what", "why", "how", "if", "not", "no", "there",
  "here", "all", "any", "each", "both", "more", "most", "some", "such", "only",
  "own", "same", "other", "another", "between", "through", "during", "before",
  "after", "above", "below", "up", "down", "out", "off", "over", "under",
  "again", "further", "once", "because", "while", "about", "against", "among",
  "produces", "produce", "produced", "results", "result", "resulting", "means",
  "shows", "show", "shown", "gives", "give", "given", "makes", "make", "made",
  "uses", "use", "used", "using", "occurs", "occur", "happens", "happen",
  "involves", "involve", "includes", "include", "including", "consists",
  "consist", "contains", "contain", "leads", "lead", "causes", "cause",
  "requires", "require", "allows", "allow", "creates", "create", "forms", "form",
  "becomes", "become", "begins", "begin", "starts", "start", "ends", "end",
  "also", "well", "very", "much", "many", "one", "two", "first", "second",
  "next", "last", "new", "old", "good", "different", "important", "key", "main",
]);

// Break text into normalized tokens: lowercased, split on any non-alphanumeric run
// so "Approval." and "approval" and "APPROVAL," all collapse to "approval".
// Numbers survive (a step count or "3pm" is a real key term).
function tokenize(text) {
  if (typeof text !== "string") return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Flatten a corrected transcription artifact into one lowercase token SET — the
// haystack every line is checked against. Accepts the phase-1 artifact shape
// (entries[].segments[].text) that TranscriptionReview confirms and Phase 2
// consumes; a plain string is accepted too so the verifier isn't coupled to one
// wrapper. Uncertain gaps that were never filled contribute nothing traceable, so
// an unfilled "[unclear]" is excluded from the haystack (it is not board content).
function transcriptionText(transcription) {
  if (typeof transcription === "string") return transcription;
  const entries =
    transcription && Array.isArray(transcription.entries)
      ? transcription.entries
      : [];
  const parts = [];
  for (const entry of entries) {
    const segments = Array.isArray(entry.segments) ? entry.segments : [];
    for (const seg of segments) {
      if (!seg || typeof seg.text !== "string") continue;
      // An open [unclear] gap is not board content — skip it so a note can never
      // "verify" against a placeholder the user never resolved.
      if (seg.uncertain && seg.text.trim() === "[unclear]") continue;
      parts.push(seg.text);
    }
  }
  return parts.join(" ");
}

// The key terms of a note line: its content tokens minus stopwords. A line made up
// entirely of stopwords has no key terms — nothing to trace — so it fails
// verification rather than passing vacuously.
function keyTerms(line) {
  const text = line && typeof line.text === "string" ? line.text : "";
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

// Keep a line only when EVERY one of its key terms appears in the transcription.
// Requiring all terms (not just one) is the strict reading of "traces to the
// board": a line that mixes a real board term with an invented one is still
// introducing something the user didn't draw, so it is dropped. A line with no key
// terms (empty, or all stopwords) is not traceable and is dropped too.
function verifyLine(line, transcription) {
  const terms = keyTerms(line);
  if (terms.length === 0) return false;
  const haystack = new Set(
    tokenize(
      typeof transcription === "string"
        ? transcription
        : transcriptionText(transcription)
    )
  );
  return terms.every((t) => haystack.has(t));
}

module.exports = { verifyLine, transcriptionText, keyTerms, tokenize };
