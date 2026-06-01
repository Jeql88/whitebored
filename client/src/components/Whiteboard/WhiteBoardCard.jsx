import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { deleteWhiteboard, updateWhiteboard } from "../../api/whiteboard";

function getUserIdFromToken() {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split(".")[1])).userId;
  } catch {
    return null;
  }
}

export default function WhiteboardCard({ whiteboard, onDelete, onRename }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(whiteboard.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const currentUserId = getUserIdFromToken();
  const isShared = whiteboard.userId !== currentUserId;

  const handleDelete = async () => {
    await deleteWhiteboard(whiteboard._id);
    onDelete(whiteboard._id);
    setShowDeleteConfirm(false);
  };

  const handleRename = async () => {
    if (newName.trim() && newName !== whiteboard.name) {
      await updateWhiteboard(whiteboard._id, newName);
      onRename(whiteboard._id, newName, new Date().toISOString());
    }
    setEditing(false);
  };

  const lastEdited =
    whiteboard.updatedAt && !isNaN(new Date(whiteboard.updatedAt))
      ? formatDistanceToNow(new Date(whiteboard.updatedAt)) + " ago"
      : "unknown";

  return (
    <>
      <div
        onClick={() => {
          if (!editing && !showDeleteConfirm)
            navigate(`/whiteboard/${whiteboard._id}`);
        }}
        className="group relative flex h-36 cursor-pointer flex-col overflow-hidden rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] transition-shadow hover:shadow-md"
      >
        <div className="flex flex-1 items-center justify-center bg-[var(--surface-bg)] text-[var(--surface-muted)]">
          <FileText size={32} />
        </div>
        <div className="border-t border-[var(--surface-border)] p-3">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--surface-text)]">
              {whiteboard.name}
            </span>
            {isShared && (
              <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-600 dark:bg-brand-600/15">
                Shared
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--surface-muted)]">
            {lastEdited}
          </p>
        </div>

        {!isShared && (
          <div
            className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setEditing(true)}
              title="Rename"
              className="rounded-md bg-[var(--surface-card)]/90 p-1.5 text-[var(--surface-muted)] shadow hover:text-brand-600"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete"
              className="rounded-md bg-[var(--surface-card)]/90 p-1.5 text-[var(--surface-muted)] shadow hover:text-red-600"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(false)} title="Rename Whiteboard">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            className="mb-4 w-full rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
          <ModalButtons
            onCancel={() => setEditing(false)}
            confirmLabel="Save"
            onConfirm={handleRename}
          />
        </Modal>
      )}

      {showDeleteConfirm && (
        <Modal
          onClose={() => setShowDeleteConfirm(false)}
          title="Delete Whiteboard"
        >
          <p className="mb-4 text-sm text-[var(--surface-muted)]">
            Are you sure you want to delete{" "}
            <strong className="text-[var(--surface-text)]">
              {whiteboard.name}
            </strong>
            ? This cannot be undone.
          </p>
          <ModalButtons
            onCancel={() => setShowDeleteConfirm(false)}
            confirmLabel="Delete"
            danger
            onConfirm={handleDelete}
          />
        </Modal>
      )}
    </>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-sm rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-lg font-semibold text-[var(--surface-text)]">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

function ModalButtons({ onCancel, onConfirm, confirmLabel, danger }) {
  return (
    <div className="flex justify-end gap-2">
      <button
        onClick={onCancel}
        className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--surface-muted)] hover:bg-[var(--surface-bg)]"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
          danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
        }`}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
