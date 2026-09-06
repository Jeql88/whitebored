import React from "react";
import PropTypes from "prop-types";
import { AlertTriangle, Check, X } from "lucide-react";

// The notes artifact rendered as a DOCUMENT rather than a list of tagged chips.
//
// The line shape is unchanged ({ text, kind, sourceElementIds, origin }) — what
// changes is that `kind` drives typography instead of a "Key point" label on every
// row. A reader should see a summary, headings, and the points under them the way
// they would in any set of notes; the structural role is conveyed by weight,
// indentation and bullets, which is how notes are actually read.
//
// Fact-check flags render INLINE on the line they concern, not in a separate tab.
// A contradiction is a property of a specific claim, so it belongs next to that
// claim — a separate list forces the reader to re-find which line each flag was
// about, and hides the flag entirely unless they think to go looking.

// Inline markdown only: **bold**, *italic*, `code`. Block syntax is deliberately
// unsupported — `kind` already carries the structure and the renderer supplies the
// bullet and heading weight, so a line starting with "#" or "-" would double up.
// Splitting on the delimiters (rather than replacing into HTML) keeps this safe:
// nothing is ever injected as markup.
function renderInline(text) {
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={i}
          className="rounded bg-[var(--surface-hover)] px-1 py-0.5 font-mono text-[0.9em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// A line traces back to the board when it carries source shapes, which is what
// makes it clickable-to-highlight. Chat- and document-origin lines legitimately
// have none.
function isHighlightable(line) {
  return Array.isArray(line?.sourceElementIds) && line.sourceElementIds.length > 0;
}

// One line, typed by its structural role. Steps are numbered by their position
// among steps, so a list stays correctly numbered even with headings between.
function NoteLine({ line, stepNumber, flags, onHighlight, onAcceptFlag, onDismissFlag }) {
  const clickable = isHighlightable(line);
  const body = renderInline(line.text);

  const shared =
    "group w-full rounded-md text-left transition-colors " +
    (clickable ? "cursor-pointer hover:bg-[var(--surface-hover)]" : "cursor-default");

  const inner = (() => {
    switch (line.kind) {
      case "summary":
        return (
          <p className="border-l-2 border-brand-500 py-1 pl-3 text-[13px] leading-relaxed text-[var(--surface-text)]">
            {body}
          </p>
        );
      case "heading":
        return (
          <h3 className="mt-3 px-1 pb-1 pt-2 text-[13px] font-semibold tracking-tight text-[var(--surface-text)]">
            {body}
          </h3>
        );
      case "sequence-step":
        return (
          <div className="flex gap-2 px-1 py-1">
            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-semibold text-brand-600">
              {stepNumber}
            </span>
            <span className="text-[13px] leading-relaxed text-[var(--surface-text)]">{body}</span>
          </div>
        );
      default:
        return (
          <div className="flex gap-2 px-1 py-1">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--surface-muted)]" />
            <span className="text-[13px] leading-relaxed text-[var(--surface-text)]">{body}</span>
          </div>
        );
    }
  })();

  return (
    <li>
      {clickable ? (
        <button
          type="button"
          className={shared}
          onClick={() => onHighlight?.(line.sourceElementIds, line)}
          title="Show on board"
        >
          {inner}
        </button>
      ) : (
        <div className={shared}>{inner}</div>
      )}

      {/* A contradiction belongs beside the claim it contradicts. */}
      {flags?.map((flag) => (
        <div
          key={flag.id}
          className="ml-3 mt-1 rounded-md border border-amber-300/60 bg-amber-50 p-2 text-[11px] dark:border-amber-500/30 dark:bg-amber-950/40"
        >
          <p className="flex items-start gap-1.5 font-medium text-amber-900 dark:text-amber-200">
            <AlertTriangle size={12} className="mt-px shrink-0" />
            <span>Your source says: {flag.sourceClaim}</span>
          </p>
          {flag.citation?.page != null && (
            <p className="mt-0.5 pl-4 text-amber-800/80 dark:text-amber-300/70">
              p.{flag.citation.page}
            </p>
          )}
          <div className="mt-1.5 flex gap-1.5 pl-4">
            <button
              type="button"
              onClick={() => onAcceptFlag?.(flag)}
              className="inline-flex items-center gap-1 rounded border border-amber-400/60 px-1.5 py-0.5 font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              <Check size={10} /> Accept
            </button>
            <button
              type="button"
              onClick={() => onDismissFlag?.(flag)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-800/70 hover:bg-amber-100 dark:text-amber-300/60 dark:hover:bg-amber-900/40"
            >
              <X size={10} /> Dismiss
            </button>
          </div>
        </div>
      ))}
    </li>
  );
}

NoteLine.propTypes = {
  line: PropTypes.object.isRequired,
  stepNumber: PropTypes.number,
  flags: PropTypes.array,
  onHighlight: PropTypes.func,
  onAcceptFlag: PropTypes.func,
  onDismissFlag: PropTypes.func,
};

export default function NotesDocument({
  lines = [],
  flags = [],
  gaps = [],
  onHighlight,
  onAcceptFlag,
  onDismissFlag,
  onCitationClick,
}) {
  // Match each open flag to the line it concerns, so it can render beside it.
  // Anything that cannot be matched still surfaces at the end rather than being
  // silently dropped — an unshown contradiction is worse than a misplaced one.
  const open = flags.filter((f) => f.status !== "dismissed");
  const byLine = new Map();
  const unmatched = [];
  for (const flag of open) {
    const i = lines.findIndex((l) => l.text && flag.boardClaim && l.text.includes(flag.boardClaim));
    if (i === -1) unmatched.push(flag);
    else byLine.set(i, [...(byLine.get(i) || []), flag]);
  }

  let step = 0;

  return (
    <article className="flex flex-col gap-0.5 px-3 py-2" aria-label="Notes">
      <ol className="list-none">
        {lines.map((line, i) => {
          if (line.kind === "sequence-step") step += 1;
          else if (line.kind === "heading") step = 0;
          return (
            <NoteLine
              key={i}
              line={line}
              stepNumber={step}
              flags={byLine.get(i)}
              onHighlight={onHighlight}
              onAcceptFlag={onAcceptFlag}
              onDismissFlag={onDismissFlag}
            />
          );
        })}
      </ol>

      {unmatched.length > 0 && (
        <section className="mt-3 border-t border-[var(--surface-border)] pt-2">
          <h4 className="mb-1 text-[11px] font-semibold text-[var(--surface-muted)]">
            Other things your sources disagree with
          </h4>
          {unmatched.map((flag) => (
            <p key={flag.id} className="mb-1 text-[11px] text-[var(--surface-muted)]">
              {flag.sourceClaim}
            </p>
          ))}
        </section>
      )}

      {/* Coverage gaps close out the document: what the source covers that the
          board does not. Surfaced, never auto-added (D16 story 32). */}
      {gaps.length > 0 && (
        <section className="mt-3 border-t border-[var(--surface-border)] pt-2">
          <h4 className="mb-1.5 text-[11px] font-semibold text-[var(--surface-muted)]">
            Not on your board yet
          </h4>
          <ul className="flex flex-col gap-1">
            {gaps.map((topic) => (
              <li key={topic.id}>
                <button
                  type="button"
                  onClick={() => onCitationClick?.({ docId: topic.docId, page: topic.pageStart })}
                  className="text-left text-[11px] text-[var(--surface-muted)] underline-offset-2 hover:text-[var(--surface-text)] hover:underline"
                >
                  {topic.label}
                  {topic.pageStart != null && (
                    <span className="ml-1 opacity-70">p.{topic.pageStart}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

NotesDocument.propTypes = {
  lines: PropTypes.array,
  flags: PropTypes.array,
  gaps: PropTypes.array,
  onHighlight: PropTypes.func,
  onAcceptFlag: PropTypes.func,
  onDismissFlag: PropTypes.func,
  onCitationClick: PropTypes.func,
};

export { renderInline };
