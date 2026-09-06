import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { NotebookPen, Sparkles, FileText, ShieldCheck, Target, X } from "lucide-react";

import NotesPanel from "./NotesPanel";
import TranscriptionReview from "./TranscriptionReview";
import ChatPanel from "./ChatPanel";
import DocumentsPanel from "./DocumentsPanel";
import FactCheckPanel from "./FactCheckPanel";
import CoveragePanel from "./CoveragePanel";
import ScopeBar from "./ScopeBar";

// One sidebar for the whole Sketch-to-Notes surface. Before this, each panel was
// its own floating sheet fighting for the same corner of the screen; a user with
// notes open could not see the document they were about to cite. Collecting them
// into a single docked column with tabs means one region, one width, one close
// affordance — the canvas reflows once instead of per panel.
//
// The panels themselves are unchanged and still prop-driven: this component owns
// only which tab is showing and the shared chrome. Each child renders in "docked"
// mode so it contributes content, not its own sheet frame.
//
// Layout (D22): a docked right COLUMN on wide screens (the editor reflows the
// canvas around it) and a full-height slide-over SHEET on narrow ones.

const TABS = [
  { id: "notes", label: "Notes", Icon: NotebookPen },
  { id: "chat", label: "Chat", Icon: Sparkles },
  { id: "documents", label: "Documents", Icon: FileText },
  { id: "factcheck", label: "Fact-check", Icon: ShieldCheck },
  { id: "coverage", label: "Coverage", Icon: Target },
];

export default function StudioSidebar({
  activeTab = "notes",
  onTabChange,
  onClose,
  variant = "docked",
  transcript,
  transcriptConfirmed,
  transcribing,
  onReread,
  onCorrectTranscript,
  onConfirmTranscript,
  noteType,
  onNoteTypeChange,
  onGenerateNotes,
  onRegenerateNotes,
  notesLines,
  notesBusy,
  onHighlight,
  messages,
  chatPending,
  onSendChat,
  onAddToNotes,
  documents,
  activeDoc,
  activePage,
  rawUrl,
  onUpload,
  onSelectDocument,
  onJumpToPage,
  onDeleteDocument,
  uploadingDoc,
  flags,
  onAcceptFlag,
  onDismissFlag,
  onCitationClick,
  pendingEdit,
  onConfirmEdit,
  onDeclineEdit,
  coverageReport,
  onRunFactCheck,
  onRunCoverage,
  scope,
  scopeDiff,
  matchedTopics,
  onScopeChange,
  onConfirmScope,
  onGenerateStudy,
}) {
  const isSheet = variant === "sheet";
  const headingRef = useRef(null);

  // Moving focus to the panel heading on open keeps keyboard and screen-reader
  // users with the content instead of stranding focus back on the toolbar.
  useEffect(() => {
    headingRef.current?.focus();
  }, [activeTab]);

  // Escape closes the sidebar, the convention for any overlay surface.
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The scope bar drives study generation, so it belongs with the tabs that make
  // study material — not with the document reader or the fact-check list.
  const showScope = activeTab === "notes" || activeTab === "coverage";

  const tabClass = (selected) =>
    [
      "flex flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-2 text-[10px] font-medium transition-colors",
      selected
        ? "border-brand-600 text-brand-600"
        : "border-transparent text-[var(--surface-muted)] hover:text-[var(--surface-text)]",
    ].join(" ");

  return (
    <aside
      aria-label="Study tools"
      data-variant={variant}
      className={
        isSheet
          ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-[var(--surface-border)] bg-[var(--surface-card)] shadow-xl"
          : "flex h-full w-96 shrink-0 flex-col overflow-hidden border-l border-[var(--surface-border)] bg-[var(--surface-card)]"
      }
    >
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--surface-border)] px-3 py-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-semibold text-[var(--surface-text)] outline-none"
        >
          Study tools
        </h2>
        {onClose && (
          <button
            type="button"
            aria-label="Close study tools"
            onClick={onClose}
            className="rounded p-1 text-[var(--surface-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--surface-text)]"
          >
            <X size={16} />
          </button>
        )}
      </header>

      <div role="tablist" aria-label="Study tools" className="flex shrink-0 border-b border-[var(--surface-border)]">
        {TABS.map((tab) => {
          const { id, label } = tab;
          const TabIcon = tab.Icon;
          const selected = activeTab === id;
          return (
            <button
              key={id}
              role="tab"
              id={"studio-tab-" + id}
              aria-selected={selected}
              aria-controls={"studio-panel-" + id}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange?.(id)}
              title={label}
              className={tabClass(selected)}
            >
              <TabIcon size={16} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={"studio-panel-" + activeTab}
        aria-labelledby={"studio-tab-" + activeTab}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {activeTab === "notes" && (
          <div className="flex flex-col">
            {/* One action, whole pipeline: reads the board and writes notes. The
                review step below appears only when the AI was actually unsure, so
                a clean board goes straight from this button to notes (D3 still
                holds — notes are never written from text the user could not
                correct; they just are not asked to when there is nothing to fix). */}
            <div className="border-b border-[var(--surface-border)] p-3">
              <button
                type="button"
                onClick={() => (notesLines.length > 0 ? onReread?.() : onGenerateNotes?.())}
                disabled={transcribing || notesBusy}
                className="w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {transcribing
                  ? "Reading your board…"
                  : notesBusy
                    ? "Writing notes…"
                    : notesLines.length > 0
                      ? "Re-read board & update notes"
                      : "Generate notes"}
              </button>

              {notesLines.length > 0 && (
                <button
                  type="button"
                  onClick={() => onRegenerateNotes?.()}
                  disabled={notesBusy}
                  className="mt-2 w-full rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-[11px] font-medium text-[var(--surface-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--surface-text)] disabled:opacity-50"
                >
                  Rewrite notes (keeps your edits)
                </button>
              )}
            </div>

            {/* Only shown when the read left gaps — otherwise it never interrupts. */}
            {transcript && !transcriptConfirmed && (
              <div className="border-b border-[var(--surface-border)] p-3">
                <p className="mb-2 text-[11px] text-[var(--surface-muted)]">
                  Some words could not be read. Fill them in and notes will be
                  written from your corrections.
                </p>
                <TranscriptionReview
                  artifact={transcript}
                  onCorrect={onCorrectTranscript}
                  onConfirm={onConfirmTranscript}
                />
              </div>
            )}

            {(notesLines.length > 0 || notesBusy) && (
              <NotesPanel
                variant="embedded"
                noteType={noteType}
                onNoteTypeChange={onNoteTypeChange}
                onGenerate={onGenerateNotes}
                lines={notesLines}
                generating={notesBusy}
                onHighlight={onHighlight}
              />
            )}

            {!transcript && !notesLines.length && !notesBusy && (
              <div className="p-4 text-center">
                <p className="text-xs text-[var(--surface-muted)]">
                  Turn what you have drawn into study notes. Anything the AI cannot
                  read clearly is flagged for you to fix before notes are written.
                </p>
              </div>
            )}
          </div>
        )}
        {activeTab === "chat" && (
          <ChatPanel
            variant="embedded"
            messages={messages}
            pending={chatPending}
            onSend={onSendChat}
            onAddToNotes={onAddToNotes}
          />
        )}
        {activeTab === "documents" && (
          <DocumentsPanel
            variant="embedded"
            documents={documents}
            activeDoc={activeDoc}
            activePage={activePage}
            rawUrl={rawUrl}
            onUpload={onUpload}
            onSelectDocument={onSelectDocument}
            onJumpToPage={onJumpToPage}
            onDelete={onDeleteDocument}
            uploading={uploadingDoc}
          />
        )}
        {activeTab === "factcheck" && (
          <>
            <div className="border-b border-[var(--surface-border)] p-3">
              <button
                type="button"
                onClick={() => onRunFactCheck?.()}
                className="w-full rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                Check notes against sources
              </button>
            </div>
            <FactCheckPanel
            variant="embedded"
            flags={flags}
            onAccept={onAcceptFlag}
            onDismiss={onDismissFlag}
            onCitationClick={onCitationClick}
            pendingEdit={pendingEdit}
            onConfirmEdit={onConfirmEdit}
            onDeclineEdit={onDeclineEdit}
            />
          </>
        )}
        {activeTab === "coverage" && (
          <>
            <div className="border-b border-[var(--surface-border)] p-3">
              <button
                type="button"
                onClick={() => onRunCoverage?.()}
                className="w-full rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                Check coverage against a document
              </button>
            </div>
            <CoveragePanel variant="embedded" report={coverageReport} onCitationClick={onCitationClick} />
          </>
        )}
      </div>

      {/* Scope is the contract for what a generate run covers, so it sits directly
          above the action it governs rather than inside a tab that can scroll away. */}
      {showScope && scope && (
        <ScopeBar
          scope={scope}
          diff={scopeDiff}
          matchedTopics={matchedTopics}
          onScopeChange={onScopeChange}
          onConfirmScope={onConfirmScope}
          onGenerate={onGenerateStudy}
        />
      )}
    </aside>
  );
}

StudioSidebar.propTypes = {
  activeTab: PropTypes.oneOf(TABS.map((t) => t.id)),
  onTabChange: PropTypes.func,
  onClose: PropTypes.func,
  variant: PropTypes.oneOf(["docked", "sheet"]),
  transcript: PropTypes.object,
  transcriptConfirmed: PropTypes.bool,
  transcribing: PropTypes.bool,
  onReread: PropTypes.func,
  onCorrectTranscript: PropTypes.func,
  onConfirmTranscript: PropTypes.func,
  noteType: PropTypes.string,
  onNoteTypeChange: PropTypes.func,
  onGenerateNotes: PropTypes.func,
  onRegenerateNotes: PropTypes.func,
  notesLines: PropTypes.array,
  notesBusy: PropTypes.bool,
  onHighlight: PropTypes.func,
  messages: PropTypes.array,
  chatPending: PropTypes.bool,
  onSendChat: PropTypes.func,
  onAddToNotes: PropTypes.func,
  documents: PropTypes.array,
  activeDoc: PropTypes.object,
  activePage: PropTypes.number,
  rawUrl: PropTypes.func,
  onUpload: PropTypes.func,
  onSelectDocument: PropTypes.func,
  onJumpToPage: PropTypes.func,
  onDeleteDocument: PropTypes.func,
  uploadingDoc: PropTypes.bool,
  flags: PropTypes.array,
  onAcceptFlag: PropTypes.func,
  onDismissFlag: PropTypes.func,
  onCitationClick: PropTypes.func,
  pendingEdit: PropTypes.object,
  onConfirmEdit: PropTypes.func,
  onDeclineEdit: PropTypes.func,
  coverageReport: PropTypes.object,
  onRunFactCheck: PropTypes.func,
  onRunCoverage: PropTypes.func,
  scope: PropTypes.object,
  scopeDiff: PropTypes.object,
  matchedTopics: PropTypes.arrayOf(PropTypes.string),
  onScopeChange: PropTypes.func,
  onConfirmScope: PropTypes.func,
  onGenerateStudy: PropTypes.func,
};

export { TABS };
