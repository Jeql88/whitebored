import React, { useState } from "react";
import PropTypes from "prop-types";

// The always-visible scope bar (slice #17, D19). Like the other panels this is a
// thin, PROP-DRIVEN shell: the caller owns the scope object (persisted server-side
// by server/scope) and injects it plus callbacks. No fetch, no socket, no model.
//
// The bar sits directly above the generate button and renders the scope object
// verbatim, so the user always sees exactly what is about to be generated (story
// 42). Two things mutate scope and BOTH are visible:
//   - the [edit] control here (story 45), and
//   - a scope-changing chat message, parsed server-side into a diff which arrives
//     as the `diff` prop and is announced as applied (stories 43, 44).
//
// A CONCEPT range resolves-then-confirms (story 47): the resolved page range is
// shown and generation is BLOCKED until the user confirms it, so nobody revises
// the wrong material because a phrase silently mapped somewhere unexpected. An
// unresolvable phrase says so rather than guessing.
//
// Props (the seam):
//   scope           the structured scope object (controlled by the caller)
//   diff            optional { field: {from, to} } — the last chat-driven change
//   matchedTopics   optional string[] — topics a concept range resolved to
//   onScopeChange   (scope) => void    apply an edit
//   onConfirmScope  () => void         accept a resolved concept range
//   onGenerate      () => void         run generation (blocked while unconfirmed)

const SOURCE_LABELS = {
  notes: "My notes",
  documents: "Documents",
  "notes+documents": "My notes + Documents",
};

// The decks a source generates into. notes+documents is TWO labelled decks shown
// side by side and never merged (stories 34, 35) — mirrors server/scope decksFor.
function decksFor(source) {
  if (source === "documents") return [{ deck: "document", label: "Documents" }];
  if (source === "notes+documents") {
    return [
      { deck: "notes", label: "My notes" },
      { deck: "document", label: "Documents" },
    ];
  }
  return [{ deck: "notes", label: "My notes" }];
}

function rangeLabel(range) {
  if (!range || range.kind === "all") return "Everything";
  if (range.kind === "pages") return `Pages ${range.from}–${range.to}`;
  if (range.resolved) return `“${range.phrase}” → pages ${range.resolved.from}–${range.resolved.to}`;
  return `“${range.phrase}” — couldn't place this in the material`;
}

// A concept range gates generation until it is confirmed. An unresolved phrase
// gates too: we know what the user asked for but not what it means.
function needsConfirmation(scope) {
  return scope?.range?.kind === "concept" && scope.range.confirmed !== true;
}

function describeValue(value) {
  if (value && typeof value === "object") return rangeLabel(value);
  return String(value);
}

export default function ScopeBar({
  scope,
  diff,
  matchedTopics,
  onScopeChange,
  onConfirmScope,
  onGenerate,
}) {
  const [editing, setEditing] = useState(false);
  const [draftCount, setDraftCount] = useState(scope?.count ?? 10);

  const blocked = needsConfirmation(scope);
  const decks = decksFor(scope?.source);
  const changes = diff ? Object.entries(diff) : [];

  const applyEdit = () => {
    const count = Number(draftCount);
    if (Number.isInteger(count) && count > 0) {
      onScopeChange?.({ ...scope, count });
    }
    setEditing(false);
  };

  return (
    <section aria-label="Study scope" className="border-t border-neutral-200 p-3 text-xs dark:border-neutral-800">
      {/* A chat-driven change is announced as APPLIED — never a silent mutation. */}
      {changes.length > 0 && (
        <p role="status" className="mb-2 rounded bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Updated from chat:{" "}
          {changes
            .map(([field, { from, to }]) => `${field} ${describeValue(from)} → ${describeValue(to)}`)
            .join("; ")}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-neutral-500">Source</dt>
        <dd>{SOURCE_LABELS[scope?.source] ?? SOURCE_LABELS.notes}</dd>
        <dt className="text-neutral-500">Range</dt>
        <dd>{rangeLabel(scope?.range)}</dd>
        <dt className="text-neutral-500">Questions</dt>
        <dd>{scope?.count}</dd>
        <dt className="text-neutral-500">Difficulty</dt>
        <dd>{scope?.difficulty}</dd>
        <dt className="text-neutral-500">Format</dt>
        <dd>{scope?.format}</dd>
      </dl>

      {/* The decks this scope produces. Two sources = two labelled decks, never merged. */}
      <ul className="mt-2 flex gap-2">
        {decks.map((d) => (
          <li key={d.deck} className="rounded bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">
            {d.label}
          </li>
        ))}
      </ul>

      {blocked && (
        <div className="mt-2 rounded bg-blue-50 px-2 py-1 dark:bg-blue-950">
          <p>
            {scope.range.resolved
              ? `Generate over pages ${scope.range.resolved.from}–${scope.range.resolved.to}?`
              : "That phrase couldn't be placed in your material."}
            {matchedTopics?.length ? ` (${matchedTopics.join(", ")})` : ""}
          </p>
          {scope.range.resolved && (
            <button type="button" onClick={() => onConfirmScope?.()} className="mt-1 rounded bg-blue-600 px-2 py-0.5 text-white">
              Confirm range
            </button>
          )}
        </div>
      )}

      {editing ? (
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="scope-count">Questions</label>
          <input
            id="scope-count"
            type="number"
            value={draftCount}
            onChange={(e) => setDraftCount(e.target.value)}
            className="w-16 rounded border px-1"
          />
          <button type="button" onClick={applyEdit} className="rounded border px-2 py-0.5">
            Apply
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="mt-2 underline">
          Edit scope
        </button>
      )}

      <button
        type="button"
        onClick={() => onGenerate?.()}
        disabled={blocked}
        className="mt-2 w-full rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        Generate
      </button>
    </section>
  );
}

ScopeBar.propTypes = {
  scope: PropTypes.shape({
    source: PropTypes.string,
    range: PropTypes.object,
    count: PropTypes.number,
    difficulty: PropTypes.string,
    format: PropTypes.string,
  }).isRequired,
  diff: PropTypes.object,
  matchedTopics: PropTypes.arrayOf(PropTypes.string),
  onScopeChange: PropTypes.func,
  onConfirmScope: PropTypes.func,
  onGenerate: PropTypes.func,
};
