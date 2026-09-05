import React from "react";
import PropTypes from "prop-types";

// The Coverage panel beside the canvas (slice #16, D16/D22). Like NotesPanel and
// FactCheckPanel, this is a thin, PROP-DRIVEN shell: the caller owns the coverage
// report (topics extracted once at upload, coverage judged + reconciled server-side by
// server/coverage) and injects it + callbacks as props. No live fetch, no socket, no
// model here — so the component is drivable from a test with fakes.
//
// The report is the server coverage shape (server/coverage):
//   { boardId, total, coveredCount, gapCount,
//     topics: [ { id, label, pageStart, pageEnd, status } ] }
//   status ::= "covered" | "gap"
//
// Behaviour:
//   - Shows the STABLE "N topics" denominator as covered / total (story 31). Because
//     the topic list is extracted ONCE at upload, this count does not wobble across
//     regenerations — that is the whole point of the two-step design.
//   - Lists every topic with its coverage status; a GAP cites its page range and
//     deep-links there via onCitationClick (stories 24/30), so the user can jump to
//     what they missed in the document viewer.
//   - Gaps are SURFACED, never auto-added to the notes (story 32). There is
//     deliberately no "add to notes" control here — the tool is a revision aid, not a
//     crutch. The panel reports; it never writes.
//   - Responsive (D22): a docked right COLUMN on wide screens and a slide-over SHEET
//     on narrow, mirroring NotesPanel/FactCheckPanel. `variant` picks the chrome.
//
// Props (the seam):
//   report           the coverage report (controlled by the caller), or null when no
//                    document is attached
//   docId            optional document id, stamped onto a citation for the deep link
//   onCitationClick  (citation) => void      jump-to-page deep link (story 24)
//   variant          "docked" | "sheet"      responsive chrome (D22)
//   onClose          optional; sheet dismiss

// Render a topic's page range as "p.N" or "p.N–M".
function pageRangeLabel(pageStart, pageEnd) {
  if (pageEnd != null && pageEnd !== pageStart) return `p.${pageStart}–${pageEnd}`;
  return `p.${pageStart}`;
}

function GapCitation({ topic, docId, onCitationClick }) {
  if (topic.pageStart == null) return null;
  return (
    <button
      type="button"
      onClick={() => onCitationClick?.({ docId, page: topic.pageStart })}
      className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline"
    >
      {pageRangeLabel(topic.pageStart, topic.pageEnd)}
    </button>
  );
}

GapCitation.propTypes = {
  topic: PropTypes.shape({
    pageStart: PropTypes.number,
    pageEnd: PropTypes.number,
  }).isRequired,
  docId: PropTypes.string,
  onCitationClick: PropTypes.func,
};

export default function CoveragePanel({
  report = null,
  docId,
  onCitationClick,
  variant = "docked",
  onClose,
}) {
  const isSheet = variant === "sheet";
  // "embedded" = rendered inside another panel's chrome (the study sidebar), so
  // this panel contributes CONTENT only: full width, no border, no own surface.
  const isEmbedded = variant === "embedded";
  const topics = report && Array.isArray(report.topics) ? report.topics : [];
  const hasReport = !!report && topics.length > 0;

  const chrome = isSheet
    ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4 shadow-xl"
    : isEmbedded
            ? "flex h-full w-full flex-col gap-4 bg-transparent p-4"
            : "flex h-full w-80 flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4";

  return (
    <aside aria-label="Coverage" data-variant={variant} className={chrome}>
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--surface-text)]">Coverage</h2>
        {isSheet && onClose && (
          <button
            type="button"
            aria-label="Close coverage"
            onClick={onClose}
            className="rounded p-1 text-[var(--surface-muted)] hover:text-[var(--surface-text)]"
          >
            ✕
          </button>
        )}
      </header>

      {!hasReport ? (
        <p className="text-xs text-[var(--surface-muted)]">
          No document attached — attach a source to see which topics your board covers.
        </p>
      ) : (
        <>
          {/* The stable denominator (story 31): covered / total topics. */}
          <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-3">
            <p className="text-xs text-[var(--surface-muted)]">Topics covered</p>
            <p className="text-2xl font-semibold text-[var(--surface-text)]">
              {report.coveredCount} / {report.total}
            </p>
            {report.gapCount === 0 && (
              <p className="mt-1 text-xs text-emerald-600">
                No gaps — your board touches every topic in the source.
              </p>
            )}
          </div>

          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {topics.map((t) => {
              const isGap = t.status === "gap";
              return (
                <li
                  key={t.id}
                  data-status={t.status}
                  className={
                    "flex items-center justify-between gap-2 rounded-lg border p-3 " +
                    (isGap
                      ? "border-amber-300 bg-amber-50/40"
                      : "border-[var(--surface-border)] bg-[var(--surface-bg)]")
                  }
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--surface-text)]">{t.label}</p>
                    <p
                      className={
                        "text-[11px] font-medium uppercase tracking-wide " +
                        (isGap ? "text-amber-700" : "text-emerald-600")
                      }
                    >
                      {isGap ? "Gap" : "Covered"}
                    </p>
                  </div>
                  {isGap && (
                    <GapCitation
                      topic={t}
                      docId={docId}
                      onCitationClick={onCitationClick}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}

CoveragePanel.propTypes = {
  report: PropTypes.shape({
    boardId: PropTypes.string,
    total: PropTypes.number,
    coveredCount: PropTypes.number,
    gapCount: PropTypes.number,
    topics: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string,
        label: PropTypes.string.isRequired,
        pageStart: PropTypes.number,
        pageEnd: PropTypes.number,
        status: PropTypes.oneOf(["covered", "gap"]),
      })
    ),
  }),
  docId: PropTypes.string,
  onCitationClick: PropTypes.func,
  variant: PropTypes.oneOf(["docked", "sheet", "embedded"]),
  onClose: PropTypes.func,
};
