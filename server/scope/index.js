"use strict";

// The study scope system (D19): one structured object that is the single source of
// truth for what a generate run will cover, plus the rules for changing it safely.
//
//   scope = { source, range, count, difficulty, format }
//
// The scope bar renders this object directly, so every change must go through
// applyDiff and be visible — the design rule here is that scope is NEVER silently
// mutated. A chat message that changes scope is parsed into a diff (chatScope.js)
// which the bar shows applied; the bar's [edit] control produces the same kind of
// diff. One shape, two entry points.
//
// A range is either STRUCTURAL (all / pages) or a CONCEPT ("up to mitosis"). A
// concept is resolved against the D16 topic list into a concrete page range, shown
// to the user, and generation is BLOCKED until they confirm it (story 47) — a
// silent mismatch would have the user revising the wrong material.

const SOURCES = ["notes", "documents", "notes+documents"];
const DIFFICULTIES = ["easy", "mixed", "hard"];
const FORMATS = ["flashcards", "mock-exam"];
const DEFAULT_COUNT = 10;

// The two decks a source can produce. They are labelled and kept separate: notes
// and documents are never merged into one deck (stories 34, 35), because a card's
// provenance is the whole point of the notes deck being shapes-only.
const DECKS = {
  notes: { deck: "notes", label: "My notes" },
  document: { deck: "document", label: "Documents" },
};

function defaultScope() {
  return {
    source: "notes",
    range: { kind: "all" },
    count: DEFAULT_COUNT,
    difficulty: "mixed",
    format: "flashcards",
  };
}

// Normalize a proposed range. An unusable range is refused (null) rather than
// half-applied, so the bar never shows a range that generation can't honour.
function normalizeRange(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (raw.kind === "all") return { kind: "all" };

  if (raw.kind === "pages") {
    const from = Number(raw.from);
    const to = Number(raw.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from < 1 || to < from) return null;
    return { kind: "pages", from, to };
  }

  if (raw.kind === "concept") {
    if (typeof raw.phrase !== "string" || !raw.phrase.trim()) return null;
    const range = { kind: "concept", phrase: raw.phrase.trim(), confirmed: raw.confirmed === true };
    // A resolution may or may not have happened yet; carry it when it has.
    if (raw.resolved && Number.isInteger(raw.resolved.from) && Number.isInteger(raw.resolved.to)) {
      range.resolved = { from: raw.resolved.from, to: raw.resolved.to };
    } else {
      range.resolved = null;
    }
    return range;
  }

  return null;
}

// Apply a diff to a scope, returning a NEW scope. Unknown or malformed fields are
// ignored rather than corrupting the object — a bad parse must not silently
// broaden what the user is about to study.
function applyDiff(scope, diff) {
  const base = scope && typeof scope === "object" ? scope : defaultScope();
  const next = { ...base, range: { ...base.range } };
  if (!diff || typeof diff !== "object") return next;

  if (SOURCES.includes(diff.source)) next.source = diff.source;
  if (DIFFICULTIES.includes(diff.difficulty)) next.difficulty = diff.difficulty;
  if (FORMATS.includes(diff.format)) next.format = diff.format;

  if (diff.count !== undefined) {
    const count = Number(diff.count);
    if (Number.isInteger(count) && count > 0) next.count = count;
  }

  if (diff.range !== undefined) {
    const range = normalizeRange(diff.range);
    if (range) next.range = range;
  }

  return next;
}

// What actually changed between two scopes — the payload the bar shows "applied"
// so a chat-driven change is visible rather than silent (story 44).
function diffOf(from, to) {
  const a = from || defaultScope();
  const b = to || defaultScope();
  const out = {};

  for (const key of ["source", "count", "difficulty", "format"]) {
    if (a[key] !== b[key]) out[key] = { from: a[key], to: b[key] };
  }
  if (JSON.stringify(a.range) !== JSON.stringify(b.range)) {
    out.range = { from: a.range, to: b.range };
  }

  return out;
}

// Resolve a concept phrase against the D16 topic list ({label, pageStart, pageEnd}).
// "up to X" runs from the first topic through X; a bare topic name is that topic.
// An unmatched phrase resolves to null — we report that we couldn't place it rather
// than guessing a range and quietly studying the wrong pages.
function resolveConcept(range, topics) {
  const list = Array.isArray(topics) ? topics.filter((t) => t && typeof t.label === "string") : [];
  const phrase = (range?.phrase || "").toLowerCase().trim();
  if (!phrase || list.length === 0) return { resolved: null, matchedTopics: [] };

  const hitIndex = list.findIndex((t) => phrase.includes(t.label.toLowerCase()));
  if (hitIndex === -1) return { resolved: null, matchedTopics: [] };

  // "up to"/"through"/"until" mean everything from the start through the match;
  // otherwise the phrase names just that one topic.
  const cumulative = /\b(up to|through|until|thru)\b/.test(phrase);
  const slice = cumulative ? list.slice(0, hitIndex + 1) : [list[hitIndex]];

  return {
    resolved: {
      from: Math.min(...slice.map((t) => t.pageStart)),
      to: Math.max(...slice.map((t) => t.pageEnd)),
    },
    matchedTopics: slice.map((t) => t.label),
  };
}

// Generation is blocked while a concept range is unconfirmed (story 47).
function needsConfirmation(scope) {
  const range = scope?.range;
  return range?.kind === "concept" && range.confirmed !== true;
}

// The user has seen the resolved range and accepted it.
function confirmScope(scope) {
  const next = applyDiff(scope, {});
  if (next.range.kind === "concept") next.range = { ...next.range, confirmed: true };
  return next;
}

// The decks this scope generates into. notes+documents produces TWO labelled decks
// that are presented side by side and never merged (stories 34, 35).
function decksFor(scope) {
  const source = SOURCES.includes(scope?.source) ? scope.source : "notes";
  if (source === "notes") return [DECKS.notes];
  if (source === "documents") return [DECKS.document];
  return [DECKS.notes, DECKS.document];
}

module.exports = {
  defaultScope,
  applyDiff,
  diffOf,
  resolveConcept,
  needsConfirmation,
  confirmScope,
  decksFor,
  normalizeRange,
  SOURCES,
  DIFFICULTIES,
  FORMATS,
  DECKS,
};
