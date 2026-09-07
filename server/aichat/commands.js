"use strict";

// What a chat message is asking for.
//
// Chat is the only surface: there is no Notes tab, no Generate button. A message
// is either an explicit slash command or ordinary prose, and both resolve to the
// same three actions — so a user who types "/generate-notes" and one who types
// "make notes from my board" get identical behaviour.
//
// Slash commands exist because they are DISCOVERABLE (the input can list them)
// and unambiguous. Prose matching is the fallback so nobody has to learn them.

const COMMANDS = [
  {
    name: "/generate-notes",
    action: "notes",
    hint: "Turn your board into clean notes",
  },
  {
    name: "/generate-flashcards",
    action: "cards",
    hint: "Make flashcards to study from",
  },
  {
    name: "/read-board",
    action: "read",
    hint: "Re-read the board now",
  },
];

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

// Prose that means the same as a command. Ordered most-specific first: "flashcards
// from my notes" is a cards request, so cards must be tested before notes.
const PROSE = [
  {
    action: "cards",
    re: /\b(flash ?cards?|quiz(zes)?|test me|practice questions?|study questions?|mock exam|revision questions?)\b/i,
  },
  {
    action: "notes",
    re: /\b(notes?|summar(y|ise|ize|ised|ized)|write ?up|outline)\b/i,
  },
  {
    action: "read",
    re: /\b(re-?read|read (the |my )?board|scan (the |my )?board|look at (the |my )?board again)\b/i,
  },
];

// Asking for something to be MADE, rather than asking about it. "Generate notes"
// is a command; "what do my notes say" is a question that happens to contain the
// word, and answering it must never overwrite the user's work.
const MAKE_VERBS =
  /\b(generate|create|make|write|build|give me|turn .* into|produce|draft|summari[sz]e|redo|regenerate)\b/i;
const QUESTION_SHAPE =
  /^\s*(what|why|how|when|where|who|which|is|are|do|does|did|can|could|should|would|tell me)\b|\?\s*$/i;

// Resolve a message to { action, argument }. `action` is one of
// "notes" | "cards" | "read" | "answer" — never null, because every message is
// answerable, and answering is the only action that cannot destroy work.
function parseCommand(message) {
  const text = String(message || "").trim();
  if (!text) return { action: "answer", argument: "" };

  // An explicit slash command wins outright — it is unambiguous by construction.
  const slash = text.match(/^(\/[a-z-]+)\s*(.*)$/is);
  if (slash) {
    const cmd = BY_NAME.get(slash[1].toLowerCase());
    // An unknown slash command is NOT silently answered as prose: the user meant
    // to invoke something, and guessing would hide the typo.
    if (!cmd) return { action: "unknown", argument: text, attempted: slash[1] };
    return { action: cmd.action, argument: slash[2].trim() };
  }

  const asksToMake = MAKE_VERBS.test(text);
  const looksLikeQuestion = QUESTION_SHAPE.test(text);

  for (const { action, re } of PROSE) {
    if (!re.test(text)) continue;
    // "read the board" is an instruction even without a make-verb; notes and
    // cards need one, so that naming them in a question does not trigger them.
    if (action === "read") return { action, argument: text };
    if (asksToMake && !looksLikeQuestion) return { action, argument: text };
    return { action: "answer", argument: text };
  }

  return { action: "answer", argument: text };
}

module.exports = { parseCommand, COMMANDS };
