"use strict";

// Local card verification (D17/D18) — the same "traces to the board" gate the notes
// pipeline uses, applied to flashcards. A generated card is kept ONLY if it both
//   (a) traces to at least one board shape (has sourceElementIds we can highlight), and
//   (b) its question's key terms actually appear in the notes it was generated from.
// This is a pure string/term match — NOT an AI call — so it adds zero Gemini cost and
// is fully deterministic (spec: card verification reuses the local key-terms check;
// un-traceable cards are dropped). It reuses notes/verify.js's tokenizer/stopword set
// verbatim so "traceable" means the same thing for a card as for a note line.
//
//   const source = cardSourceText(notes);       // flatten the notes once
//   verifyCard(card, source)  -> boolean         // keep the card?
//
// We check the ANSWER (not the question) against the notes. A question is mostly glue
// words — interrogatives ("what", "which", "how") and framing the notes never contain —
// so verifying the question would drop every well-formed card. The ANSWER, by contrast,
// is the recalled FACT: for an honest card drawn only from the notes, that fact's key
// terms must actually appear in the notes. An answer that introduces a term the board
// never mentions ("photosynthesis") is a hallucinated card and is dropped — exactly the
// "un-traceable card" the acceptance criteria require to be removed.

const { keyTerms, tokenize } = require("../notes/verify");

// Flatten a notes record into one lowercase token haystack — the corpus a card's
// question is verified against. Accepts the D6 notes record ({ lines: [{ text }] })
// or a plain string, so the verifier isn't coupled to one wrapper (mirrors
// notes/verify.js's transcriptionText tolerance).
function cardSourceText(notes) {
  if (typeof notes === "string") return notes;
  const lines = notes && Array.isArray(notes.lines) ? notes.lines : [];
  return lines
    .map((l) => (l && typeof l.text === "string" ? l.text : ""))
    .join(" ");
}

// Keep a card only when it traces to the board AND every key term of its answer
// appears in the notes. A card with no sourceElementIds cannot be highlighted back to
// a shape (the whole point of the notes deck, story 36) so it is dropped even if its
// text happens to verify — untraceable, per the acceptance criteria.
function verifyCard(card, source) {
  if (!card || typeof card.answer !== "string") return false;
  const ids = Array.isArray(card.sourceElementIds) ? card.sourceElementIds : [];
  if (ids.length === 0) return false;

  const terms = keyTerms({ text: card.answer });
  if (terms.length === 0) return false;

  const haystack = new Set(
    tokenize(typeof source === "string" ? source : cardSourceText(source))
  );
  return terms.every((t) => haystack.has(t));
}

module.exports = { verifyCard, cardSourceText };
