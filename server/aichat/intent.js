"use strict";

// What the user is asking chat to DO.
//
// Notes, flashcards and answering a question were three separate surfaces with
// three buttons, and only one of them worked reliably — chat, because it reads
// stored text and never touches the vision pipeline. Routing all three through
// chat means one place to ask for anything, and one place that knows whether the
// board needs re-reading first.
//
// Classification is local and deterministic. Spending a model call to decide
// which model call to make doubles the cost of every message on a tier metered
// in calls per day, and the phrasings people use here are not subtle.

const INTENTS = ["notes", "cards", "answer"];

// Ordered most-specific first: "make flashcards from my notes" is a cards
// request, not a notes one, so cards must be tested before notes.
const PATTERNS = [
  {
    intent: "cards",
    re: /\b(flash ?cards?|quiz(zes|zed)?|test me|practice questions?|study questions?|mock exam|revision questions?)\b/i,
  },
  {
    intent: "notes",
    re: /\b(notes?|summar(y|ise|ize|ised|ized)|write ?up|outline|clean.?up my board)\b/i,
  },
];

// A request to MAKE something, as opposed to a question about it. "Generate
// notes" is a command; "what do my notes say" is a question that happens to
// contain the word notes, and answering it must not rewrite the board's notes.
const MAKE_VERBS =
  /\b(generate|create|make|write|build|give me|turn .* into|produce|draft|summari[sz]e)\b/i;
const QUESTION_SHAPE = /^\s*(what|why|how|when|where|who|which|is|are|do|does|did|can|could|should|would)\b|\?\s*$/i;

// Classify a chat message. Returns one of INTENTS — never null, because every
// message is answerable: when in doubt the honest default is to answer, which is
// the cheapest action and never overwrites the user's work.
function classifyIntent(message) {
  const text = String(message || "").trim();
  if (!text) return "answer";

  // A question wins even when it names an artifact: "how many notes do I have?"
  // is a question, and generating notes in response would be a surprise.
  const looksLikeQuestion = QUESTION_SHAPE.test(text);
  const asksToMake = MAKE_VERBS.test(text);

  for (const { intent, re } of PATTERNS) {
    if (!re.test(text)) continue;
    // Naming the artifact is not enough; the user must be asking for it to be
    // made. Otherwise "explain my flashcards" would silently regenerate them.
    if (asksToMake && !(looksLikeQuestion && !asksToMake)) return intent;
    return "answer";
  }

  return "answer";
}

module.exports = { classifyIntent, INTENTS };
