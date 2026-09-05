"use strict";

// Chat-driven scoping (D19, stories 43/44/47). A scope-changing chat message is
// parsed by the model into a DIFF — never applied silently. The caller gets the
// proposed scope AND the visible diff so the bar can show the change applied, and
// a concept range comes back resolved-but-unconfirmed so generation stays blocked
// until the user accepts the concrete range.
//
//   const parser = createScopeParser({ gemini });
//   await parser.parse({ message, scope, topics, userId })
//     -> { changed, scope, diff, needsConfirmation, matchedTopics, unresolvedConcept }
//
// The model's only job is to turn prose into a candidate diff. Everything that
// decides what the user actually studies — validating the diff, resolving a
// concept against the real topic list, gating on confirmation — is local and
// deterministic, so a bad parse can broaden nothing.

const {
  applyDiff,
  diffOf,
  resolveConcept,
  needsConfirmation,
  SOURCES,
  DIFFICULTIES,
  FORMATS,
} = require("./index");

// The model returns a diff, not a scope: it may only express what to CHANGE, and
// anything it invents outside this schema is dropped by applyDiff.
const SCOPE_FENCE =
  "You turn a study request into a scope diff. Reply with JSON only: " +
  '{ "source"?: ' +
  SOURCES.map((s) => `"${s}"`).join(" | ") +
  ', "count"?: number, "difficulty"?: ' +
  DIFFICULTIES.map((d) => `"${d}"`).join(" | ") +
  ', "format"?: ' +
  FORMATS.map((f) => `"${f}"`).join(" | ") +
  ', "range"?: { "kind": "all" } | { "kind": "pages", "from": number, "to": number } ' +
  '| { "kind": "concept", "phrase": string } }. ' +
  "Include ONLY fields the message actually changes. If it changes nothing, reply {}. " +
  "Use a concept range when the user names material by topic rather than by page.";

function buildRequest(userId, message, scope) {
  return {
    userId,
    config: { responseMimeType: "application/json" },
    contents: [
      SCOPE_FENCE,
      `Current scope: ${JSON.stringify(scope)}`,
      `Message: ${message}`,
    ].join("\n\n"),
  };
}

// Pull JSON text out of a central-module result: { status:"ok" } now, or the
// deferred working state when throttled (story 56). Mirrors coverage/notes.
async function textOf(result) {
  const settled = result.status === "deferred" ? await result.done : result;
  const response = settled.response;
  return typeof response === "string" ? response : response?.text ?? "";
}

// A malformed reply must leave scope alone, not corrupt it.
function parseDiff(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createScopeParser({ gemini } = {}) {
  if (!gemini || typeof gemini.generate !== "function") {
    throw new Error("createScopeParser: the central Gemini module is required");
  }

  async function parse({ message, scope, topics = [], userId } = {}) {
    const current = applyDiff(scope, {}); // normalized copy; never mutate the caller's
    const nothing = {
      changed: false,
      scope: current,
      diff: {},
      needsConfirmation: needsConfirmation(current),
      matchedTopics: [],
      unresolvedConcept: null,
    };

    if (typeof message !== "string" || !message.trim()) return nothing;

    const raw = parseDiff(await textOf(await gemini.generate(buildRequest(userId, message, current))));
    if (!raw) return nothing;

    let next = applyDiff(current, raw);
    let matchedTopics = [];
    let unresolvedConcept = null;

    // A concept range is resolved HERE, against the real topic list — the model
    // never gets to decide which pages the phrase covers.
    if (next.range.kind === "concept") {
      const { resolved, matchedTopics: hits } = resolveConcept(next.range, topics);
      matchedTopics = hits;
      if (!resolved) unresolvedConcept = next.range.phrase;
      // Resolved or not, it stays unconfirmed: the user must see and accept it.
      next = { ...next, range: { ...next.range, resolved, confirmed: false } };
    }

    const diff = diffOf(current, next);
    return {
      changed: Object.keys(diff).length > 0,
      scope: next,
      diff,
      // An unresolved concept blocks too — it is not silently ignored.
      needsConfirmation: needsConfirmation(next),
      matchedTopics,
      unresolvedConcept,
    };
  }

  return { parse };
}

module.exports = { createScopeParser, SCOPE_FENCE };
