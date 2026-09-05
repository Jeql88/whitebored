import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Send, Plus } from "lucide-react";

// The AI "Chat" tab (slice #13, D10/D11) — a NEW panel, distinct from the human
// "Room" chat (that stays the floating box, renamed). It answers questions about the
// board, notes, and documents, and shows every answer with its PROVENANCE tag.
//
// This is a thin, prop-driven shell (same seam as NotesPanel/Flashcards): the caller
// owns the socket and the message list and injects them + callbacks as props. No live
// socket, no model here — so the component is drivable from a test with fakes.
//
// The provenance tag is derived + locally verified on the SERVER (see server/aichat);
// the panel only renders what the message carries. The general-knowledge tag is
// visually distinct (story 18) so an untraceable fact can't pass for board/document
// content. "Add to notes" (story 19) appears only on answers whose source is addable
// (board/document) — never on general knowledge.
//
// Props (the seam):
//   messages       [{ role: "user"|"assistant", text, source? }]  the transcript
//                  source ::= { bucket: "board"|"document"|"general", label,
//                               addableToNotes, docId?, page? }
//   onSend         (text) => void      send a question
//   onAddToNotes   (message) => void   add a board/document answer to the notes (slice #14)
//   pending        boolean — an answer is in flight (working state, story 56)
//   variant        "docked" | "sheet"  responsive chrome (D22)
//   onClose        optional; sheet dismiss

// Per-bucket tag styling. The general bucket is deliberately set apart (amber/warn)
// so untraceable facts read differently from grounded (brand) ones (story 18/D11).
const TAG_CLASS = {
  board:
    "bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300 border border-brand-200/60",
  document:
    "bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300 border border-brand-200/60",
  general:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 border border-amber-300/60",
};

function ProvenanceTag({ source }) {
  if (!source || !source.label) return null;
  const cls = TAG_CLASS[source.bucket] || TAG_CLASS.general;
  return (
    <span
      data-bucket={source.bucket}
      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {source.label}
    </span>
  );
}

ProvenanceTag.propTypes = {
  source: PropTypes.shape({
    bucket: PropTypes.string,
    label: PropTypes.string,
  }),
};

export default function ChatPanel({
  messages = [],
  onSend,
  onAddToNotes,
  pending = false,
  variant = "docked",
  onClose,
}) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  const isSheet = variant === "sheet";

  useEffect(() => {
    // Guard the call itself, not just the ref — jsdom (tests) has no scrollIntoView.
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages, pending]);

  const send = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend?.(text);
    setInput("");
  };

  return (
    <aside
      aria-label="AI Chat"
      data-variant={variant}
      className={
        isSheet
          ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-[var(--surface-border)] bg-[var(--surface-card)] shadow-xl"
          : "flex h-full w-80 flex-col border-l border-[var(--surface-border)] bg-[var(--surface-card)]"
      }
    >
      <header className="flex items-center justify-between border-b border-[var(--surface-border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold text-[var(--surface-text)]">Chat</h2>
        {onClose && (
          <button
            type="button"
            aria-label="Close chat"
            onClick={onClose}
            className="rounded p-1 text-[var(--surface-muted)] hover:text-[var(--surface-text)]"
          >
            ✕
          </button>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && !pending && (
          <p className="text-xs text-[var(--surface-muted)]">
            Ask about your board, notes, or documents. Every answer is tagged with
            where it came from.
          </p>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === "user";
          const addable = !isUser && msg.source && msg.source.addableToNotes;
          return (
            <div
              key={i}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  isUser
                    ? "bg-brand-600 text-white"
                    : "bg-[var(--surface-bg)] text-[var(--surface-text)]"
                }`}
              >
                <span className="whitespace-pre-wrap">{msg.text}</span>
                {!isUser && (
                  <div className="flex flex-wrap items-center gap-2">
                    <ProvenanceTag source={msg.source} />
                    {addable && (
                      <button
                        type="button"
                        onClick={() => onAddToNotes?.(msg)}
                        className="mt-1 inline-flex items-center gap-1 rounded-full border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--surface-muted)] hover:border-brand-500 hover:text-brand-600"
                      >
                        <Plus size={11} /> Add to notes
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {pending && (
          <p role="status" className="text-xs text-[var(--surface-muted)]">
            Thinking…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={send}
        className="flex gap-2 border-t border-[var(--surface-border)] p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your board…"
          autoComplete="off"
          className="flex-1 rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
        <button
          type="submit"
          aria-label="Send"
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 text-white hover:bg-brand-700"
        >
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}

ChatPanel.propTypes = {
  messages: PropTypes.arrayOf(
    PropTypes.shape({
      role: PropTypes.oneOf(["user", "assistant"]),
      text: PropTypes.string,
      source: PropTypes.shape({
        bucket: PropTypes.string,
        label: PropTypes.string,
        addableToNotes: PropTypes.bool,
        docId: PropTypes.string,
        page: PropTypes.number,
      }),
    })
  ),
  onSend: PropTypes.func,
  onAddToNotes: PropTypes.func,
  pending: PropTypes.bool,
  variant: PropTypes.oneOf(["docked", "sheet"]),
  onClose: PropTypes.func,
};
