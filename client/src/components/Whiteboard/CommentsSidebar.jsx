import React, { useEffect, useState } from "react";
import { X, Trash2, Send } from "lucide-react";
import { getComments, addComment, deleteComment } from "../../api/whiteboard";

export default function CommentsSidebar({
  whiteboardId,
  socket,
  open,
  onClose,
  currentUserId,
}) {
  const [comments, setComments] = useState([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (open) getComments(whiteboardId).then((c) => setComments(Array.isArray(c) ? c : []));
  }, [open, whiteboardId]);

  useEffect(() => {
    if (!socket) return;
    const handleNew = (comment) => setComments((prev) => [...prev, comment]);
    const handleDelete = ({ _id }) =>
      setComments((prev) => prev.filter((c) => String(c._id) !== String(_id)));
    socket.on("newComment", handleNew);
    socket.on("deleteComment", handleDelete);
    return () => {
      socket.off("newComment", handleNew);
      socket.off("deleteComment", handleDelete);
    };
  }, [socket]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    await addComment(whiteboardId, input);
    setInput("");
  };

  return (
    <div className="absolute right-0 top-0 z-30 flex h-full w-80 flex-col border-l border-[var(--surface-border)] bg-[var(--surface-card)] shadow-xl">
      <div className="flex items-center justify-between border-b border-[var(--surface-border)] px-4 py-3">
        <span className="font-semibold text-[var(--surface-text)]">Comments</span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-[var(--surface-muted)] hover:bg-[var(--surface-bg)]"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {comments.length === 0 && (
          <p className="text-center text-sm text-[var(--surface-muted)]">
            No comments yet.
          </p>
        )}
        {comments.map((c) => (
          <div
            key={c._id}
            className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--surface-text)]">
                {c.userName || "Anonymous"}
              </span>
              {c.userId === currentUserId && (
                <button
                  onClick={() => deleteComment(whiteboardId, c._id)}
                  title="Delete"
                  className="text-[var(--surface-muted)] hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--surface-text)]">{c.text}</p>
            <p className="mt-1 text-[11px] text-[var(--surface-muted)]">
              {new Date(c.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleAdd}
        className="flex gap-2 border-t border-[var(--surface-border)] p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a comment…"
          className="flex-1 rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 text-white hover:bg-brand-700"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
