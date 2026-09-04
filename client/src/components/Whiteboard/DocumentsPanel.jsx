import React, { useRef } from "react";
import PropTypes from "prop-types";
import { DOC_KINDS, pageCount, clampPage, pageAt } from "../../utils/documentsModel";

// The Documents tab beside the canvas (slice #11, D13). Third tab of the AI panel
// (Notes / Chat / Documents). A thin, prop-driven shell (same seam as NotesPanel /
// TranscriptionReview): the caller owns fetching/uploading and injects the document
// list, the open document (with its normalized pages), and callbacks. No live fetch
// here, so the component is drivable from a test with fakes.
//
// Behaviour:
//   - Attach PDF / image / plaintext per board (story 22). The file input hands the
//     picked File to onUpload; the caller reads bytes, extracts PDF page text, and
//     POSTs it. While uploading, the control shows a working state.
//   - Lists the board's attached documents; clicking one opens it (onSelectDocument).
//   - Renders the open document inline (story 23) with JUMP-TO-PAGE: page controls
//     and a direct page input drive onJumpToPage(pageNumber); the caller clamps and
//     re-renders with the new activePage. A citation elsewhere (fact-check flag,
//     chat source tag) deep-links by calling the same onJumpToPage after opening the
//     doc — page is CONTROLLED via activePage so a citation can drive it (story 24).
//   - Works fully with NOTHING uploaded (story 25): an empty state, no document
//     required for anything.
//
// Addressing: a document is addressed by docId; a citation is { docId, page }. The
// viewer shows activeDoc.pages[activePage-1]. Raw file bytes (for a real PDF/image
// render) load from `rawUrl` — the caller builds the URL to the /raw route; the
// panel just points an <iframe>/<img> at it. Text documents render their page text
// directly (no external viewer needed).
//
// Props (the seam):
//   documents          [ { docId, kind, filename, pageCount }, … ]  the board's list
//   activeDoc          the OPEN document, full record incl. pages (or null)
//   activePage         1-based current page (controlled; enables citation deep-link)
//   rawUrl             (doc) => string   URL to the raw bytes for PDF/image render
//   onUpload           (File) => void    attach a file
//   onSelectDocument   (docId) => void   open a document from the list
//   onJumpToPage       (pageNumber) => void   jump-to-page entry point
//   onDelete           (docId) => void   optional; remove a document
//   uploading          boolean — show the working state
//   variant            "docked" | "sheet"   responsive chrome (matches NotesPanel)
//   onClose            optional; sheet dismiss

const KIND_LABEL = { pdf: "PDF", image: "Image", text: "Text" };
const ACCEPT = ".pdf,application/pdf,image/*,.txt,text/plain";

export default function DocumentsPanel({
  documents = [],
  activeDoc = null,
  activePage = 1,
  rawUrl,
  onUpload,
  onSelectDocument,
  onJumpToPage,
  onDelete,
  uploading = false,
  variant = "docked",
  onClose,
}) {
  const isSheet = variant === "sheet";
  const fileRef = useRef(null);

  const total = pageCount(activeDoc);
  const page = clampPage(activeDoc, activePage);

  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (file) onUpload?.(file);
    // Reset so the same file can be re-picked.
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <aside
      aria-label="Documents"
      data-variant={variant}
      className={
        isSheet
          ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4 shadow-xl"
          : "flex h-full w-80 flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4"
      }
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--surface-text)]">Documents</h2>
        {isSheet && onClose && (
          <button
            type="button"
            aria-label="Close documents"
            onClick={onClose}
            className="rounded p-1 text-[var(--surface-muted)] hover:text-[var(--surface-text)]"
          >
            ✕
          </button>
        )}
      </header>

      {/* Attach (story 22) */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="documents-file"
          className="text-xs font-medium text-[var(--surface-muted)]"
        >
          Attach a document (PDF, image, or text)
        </label>
        <input
          id="documents-file"
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          aria-label="Attach a document"
          disabled={uploading}
          onChange={handleFile}
          className="text-sm text-[var(--surface-text)] file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700 disabled:opacity-50"
        />
        {uploading && (
          <p role="status" className="text-xs text-[var(--surface-muted)]">
            Uploading…
          </p>
        )}
      </div>

      {/* The board's documents */}
      {documents.length === 0 ? (
        <p className="text-xs text-[var(--surface-muted)]">
          No documents yet. Attach source material to check and answer against it —
          everything works without one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {documents.map((d) => {
            const open = activeDoc && activeDoc.docId === d.docId;
            return (
              <li key={d.docId} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectDocument?.(d.docId)}
                  aria-current={open ? "true" : undefined}
                  className={
                    "flex-1 rounded-lg border px-3 py-2 text-left text-sm " +
                    (open
                      ? "border-brand-500 bg-brand-50/40 text-[var(--surface-text)]"
                      : "border-[var(--surface-border)] bg-[var(--surface-bg)] text-[var(--surface-text)] hover:border-brand-500")
                  }
                >
                  <span className="mr-2 text-[10px] font-medium uppercase tracking-wide text-[var(--surface-muted)]">
                    {KIND_LABEL[d.kind] || "Doc"}
                  </span>
                  {d.filename}
                </button>
                {onDelete && (
                  <button
                    type="button"
                    aria-label={`Remove ${d.filename}`}
                    onClick={() => onDelete(d.docId)}
                    className="rounded p-1 text-[var(--surface-muted)] hover:text-[var(--surface-text)]"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Inline viewer with jump-to-page (stories 23/24) */}
      {activeDoc && (
        <section
          aria-label={`Viewer: ${activeDoc.filename}`}
          className="flex min-h-0 flex-1 flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => onJumpToPage?.(page - 1)}
                className="rounded border border-[var(--surface-border)] px-2 py-1 text-sm disabled:opacity-40"
              >
                ‹
              </button>
              <label className="sr-only" htmlFor="documents-page">
                Page
              </label>
              <input
                id="documents-page"
                type="number"
                min={1}
                max={total || 1}
                value={page}
                aria-label="Page"
                onChange={(e) => onJumpToPage?.(Number(e.target.value))}
                className="w-14 rounded border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2 py-1 text-sm text-[var(--surface-text)]"
              />
              <span className="text-xs text-[var(--surface-muted)]">of {total}</span>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= total}
                onClick={() => onJumpToPage?.(page + 1)}
                className="rounded border border-[var(--surface-border)] px-2 py-1 text-sm disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </div>

          <DocumentPage doc={activeDoc} page={page} rawUrl={rawUrl} />
        </section>
      )}
    </aside>
  );
}

// Render one page of the open document inline. Text documents render their page
// text directly. PDF/image documents point at the raw bytes via rawUrl — a PDF in
// an <iframe> (the browser's built-in viewer supports its own page nav; we deep-
// link with #page=N so a citation lands on the right page), an image in an <img>.
function DocumentPage({ doc, page, rawUrl }) {
  const record = pageAt(doc, page);

  if (doc.kind === "text") {
    return (
      <article
        data-testid="document-page"
        data-page={page}
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-3 text-sm text-[var(--surface-text)]"
      >
        {record ? record.text : ""}
      </article>
    );
  }

  const src = typeof rawUrl === "function" ? rawUrl(doc) : undefined;

  if (doc.kind === "image") {
    return (
      <div
        data-testid="document-page"
        data-page={page}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-2"
      >
        {src ? (
          <img src={src} alt={doc.filename} className="mx-auto max-w-full" />
        ) : null}
      </div>
    );
  }

  // PDF: the browser's built-in viewer, deep-linked to the page (jump-to-page).
  return (
    <iframe
      data-testid="document-page"
      data-page={page}
      title={`${doc.filename} page ${page}`}
      src={src ? `${src}#page=${page}` : undefined}
      className="min-h-0 flex-1 rounded-lg border border-[var(--surface-border)] bg-white"
    />
  );
}

DocumentPage.propTypes = {
  doc: PropTypes.object.isRequired,
  page: PropTypes.number.isRequired,
  rawUrl: PropTypes.func,
};

const documentSummaryShape = PropTypes.shape({
  docId: PropTypes.string.isRequired,
  kind: PropTypes.oneOf(DOC_KINDS),
  filename: PropTypes.string,
  pageCount: PropTypes.number,
});

DocumentsPanel.propTypes = {
  documents: PropTypes.arrayOf(documentSummaryShape),
  activeDoc: PropTypes.shape({
    docId: PropTypes.string.isRequired,
    kind: PropTypes.oneOf(DOC_KINDS),
    filename: PropTypes.string,
    pages: PropTypes.arrayOf(
      PropTypes.shape({ page: PropTypes.number, text: PropTypes.string })
    ),
  }),
  activePage: PropTypes.number,
  rawUrl: PropTypes.func,
  onUpload: PropTypes.func,
  onSelectDocument: PropTypes.func,
  onJumpToPage: PropTypes.func,
  onDelete: PropTypes.func,
  uploading: PropTypes.bool,
  variant: PropTypes.oneOf(["docked", "sheet"]),
  onClose: PropTypes.func,
};
