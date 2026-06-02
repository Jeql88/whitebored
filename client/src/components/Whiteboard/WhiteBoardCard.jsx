import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal, Pencil, Trash2, Copy, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useSession } from "../../lib/auth-client";
import { deleteWhiteboard, updateWhiteboard, duplicateWhiteboard } from "../../api/whiteboard";

export default function WhiteboardCard({ whiteboard, onDelete, onRename, onDuplicate, isActive }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(whiteboard.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const { data: session } = useSession();
  const isShared = whiteboard.userId !== session?.user?.id;

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

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

  const handleDuplicate = async () => {
    setMenuOpen(false);
    const res = await duplicateWhiteboard(whiteboard._id);
    if (res._id && onDuplicate) onDuplicate(res);
  };

  const lastEdited =
    whiteboard.updatedAt && !isNaN(new Date(whiteboard.updatedAt))
      ? formatDistanceToNow(new Date(whiteboard.updatedAt)) + " ago"
      : "unknown";

  return (
    <>
      <div
        onClick={() => {
          if (!editing && !showDeleteConfirm && !menuOpen)
            navigate(`/whiteboard/${whiteboard._id}`);
        }}
        className="group relative flex h-48 cursor-pointer flex-col overflow-hidden rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] transition-shadow hover:shadow-md"
      >
        {isActive && (
          <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-green-500/95 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            live
          </span>
        )}

        {/* Thumbnail — 75% of card height */}
        <div className="flex flex-[3] items-center justify-center overflow-hidden bg-white">
          {whiteboard.thumbnail ? (
            <img
              src={whiteboard.thumbnail}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div
              className="h-full w-full"
              style={{
                backgroundImage:
                  "radial-gradient(circle, #d1d5db 1px, transparent 1px)",
                backgroundSize: "16px 16px",
              }}
            />
          )}
        </div>

        {/* Footer — 25% */}
        <div className="flex flex-1 flex-col justify-center border-t border-[var(--surface-border)] px-3">
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
          <p className="mt-0.5 text-xs text-[var(--surface-muted)]">{lastEdited}</p>
        </div>

        {/* Three-dot menu button */}
        <div
          ref={menuRef}
          className="absolute right-2 top-2 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md bg-[var(--surface-card)]/90 p-1.5 text-[var(--surface-muted)] shadow opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--surface-text)]"
            title="More options"
          >
            <MoreHorizontal size={15} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-8 w-44 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-1 shadow-xl">
              <button
                onClick={() => { setMenuOpen(false); window.open(`/whiteboard/${whiteboard._id}`, "_blank"); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-[var(--surface-text)] hover:bg-[var(--surface-border)]"
              >
                <ExternalLink size={14} className="text-[var(--surface-muted)]" />
                Open in new tab
              </button>
              {!isShared && (
                <>
                  <button
                    onClick={() => { setMenuOpen(false); setEditing(true); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-[var(--surface-text)] hover:bg-[var(--surface-border)]"
                  >
                    <Pencil size={14} className="text-[var(--surface-muted)]" />
                    Rename
                  </button>
                  <button
                    onClick={handleDuplicate}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-[var(--surface-text)] hover:bg-[var(--surface-border)]"
                  >
                    <Copy size={14} className="text-[var(--surface-muted)]" />
                    Duplicate
                  </button>
                  <div className="my-1 border-t border-[var(--surface-border)]" />
                  <button
                    onClick={() => { setMenuOpen(false); setShowDeleteConfirm(true); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-[var(--surface-border)]"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal onClose={() => setEditing(false)} title="Rename board">
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
        <Modal onClose={() => setShowDeleteConfirm(false)} title="Delete board">
          <p className="mb-4 text-sm text-[var(--surface-muted)]">
            Are you sure you want to delete{" "}
            <strong className="text-[var(--surface-text)]">{whiteboard.name}</strong>? This cannot be undone.
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
        <h3 className="mb-3 text-lg font-semibold text-[var(--surface-text)]">{title}</h3>
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
