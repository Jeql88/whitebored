"use strict";

// The shared contract for "ask the model for a JSON list and get it back".
//
// Four features (notes, cards, coverage, chat) each asked Gemini for a list and
// each hand-rolled the same three steps: state the shape in the prompt, JSON.parse
// the reply, and return [] if anything went wrong. That last step is the problem —
// an unparsed reply became an empty result reported as SUCCESS, so a spent model
// call surfaced as "nothing found". On a ~20-call-per-day free tier a call that
// silently produces nothing is the most expensive bug in the system, and it is
// exactly what emptied the board transcription.
//
// This module makes the shape enforceable rather than merely requested, and makes
// an unusable reply loud rather than empty:
//
//   listSchema(itemProperties, required)  → a responseSchema pinning an array
//   parseList(text, { key })              → items, or throws UnusableReply
//
// Callers keep their own prompts and item shapes; what they share is the envelope.

// Thrown when the model replied but nothing usable could be read out of it. The
// caller turns this into an honest error — "the AI returned something we could not
// read, try again" — rather than an empty list that looks like a real answer.
class UnusableReply extends Error {
  constructor(detail) {
    super(`The model's reply could not be read: ${detail}`);
    this.name = "UnusableReply";
    this.unusableReply = true;
  }
}

// A responseSchema for a top-level ARRAY of objects. Passing this alongside
// responseMimeType makes the envelope a constraint the API enforces, instead of a
// request in the prompt that the model reframes at will.
function listSchema(properties, required = []) {
  return {
    type: "array",
    items: { type: "object", properties, required },
  };
}

// Read a list out of whatever the model returned.
//
// The pinned schema yields a bare array, but a reply can still arrive wrapped
// (`{ lines: [...] }`), fenced in markdown, or with prose around it — so the common
// envelopes are unwrapped rather than discarded. What is NOT tolerated is a reply
// with no list in it at all: that throws, because returning [] there is precisely
// the silent failure this module exists to remove.
//
// `key` names the wrapper this caller expects ("lines", "cards", ...). Any single
// array-valued property is accepted too, since the wrapper name is the detail
// models vary most.
function parseList(text, { key } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) throw new UnusableReply("it was empty");

  // Models often fence JSON in markdown despite a JSON mime type.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = [raw];
  if (fenced) candidates.unshift(fenced[1].trim());
  // A bare array or object embedded in prose.
  const embedded = /(\[[\s\S]*\]|\{[\s\S]*\})/.exec(raw);
  if (embedded) candidates.push(embedded[1]);

  let obj;
  let parsed = false;
  for (const c of candidates) {
    try {
      obj = JSON.parse(c);
      parsed = true;
      break;
    } catch {
      /* try the next candidate */
    }
  }
  if (!parsed) throw new UnusableReply("it was not valid JSON");

  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === "object") {
    if (key && Array.isArray(obj[key])) return obj[key];
    // An object with exactly one array-valued property is that list, whatever the
    // model chose to call it.
    const arrays = Object.values(obj).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
    // An explicitly empty result is a real answer, not a failure: the model said
    // "nothing here" in the shape it was asked for.
    if (key && key in obj && obj[key] == null) return [];
    if (Object.keys(obj).length === 0) return [];
  }
  throw new UnusableReply("it contained no list");
}

module.exports = { listSchema, parseList, UnusableReply };
