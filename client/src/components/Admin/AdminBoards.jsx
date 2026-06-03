import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Trash2, ExternalLink, ScanText, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { getAdminBoards, deleteAdminBoard } from "../../api/admin";
import { formatDistanceToNow } from "date-fns";

export default function AdminBoards() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const userFilter = params.get("userId") || "";

  const load = useCallback(() => {
    setLoading(true);
    const q = { page, limit: 20, search };
    if (userFilter) q.userId = userFilter;
    getAdminBoards(q)
      .then(setData)
      .finally(() => setLoading(false));
  }, [page, search, userFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, userFilter]);

  const handleDelete = async () => {
    await deleteAdminBoard(confirmDelete.id);
    setConfirmDelete(null);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[var(--surface-text)]">Boards</h2>
          {userFilter && (
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-600 dark:bg-brand-600/15">
              Filtered by user
              <button onClick={() => setParams({})} className="ml-1.5 hover:text-brand-800">✕</button>
            </span>
          )}
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--surface-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-2 pl-8 pr-3 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--surface-muted)]">Loading…</div>
      ) : !data?.boards?.length ? (
        <div className="text-sm text-[var(--surface-muted)]">No boards found.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.boards.map((b) => (
            <div key={b.id} className="group relative flex h-48 flex-col overflow-hidden rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)]">
              {/* Thumbnail */}
              <div className="flex flex-[3] items-center justify-center overflow-hidden bg-white">
                {b.thumbnail ? (
                  <img src={b.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="h-full w-full" style={{ backgroundImage: "radial-gradient(circle, #d1d5db 1px, transparent 1px)", backgroundSize: "16px 16px" }} />
                )}
              </div>
              {/* Footer */}
              <div className="flex flex-1 flex-col justify-center border-t border-[var(--surface-border)] px-3">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-[var(--surface-text)]">{b.name}</span>
                  {b.hasOcr && <ScanText size={12} className="shrink-0 text-brand-500" title="Has OCR text" />}
                </div>
                <p className="text-xs text-[var(--surface-muted)] truncate">{b.ownerName}</p>
              </div>
              {/* Hover actions */}
              <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => navigate(`/whiteboard/${b.id}`)}
                  className="rounded-md bg-[var(--surface-card)]/90 p-1.5 text-[var(--surface-muted)] shadow hover:text-brand-600"
                  title="Open board"
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  onClick={() => setConfirmDelete(b)}
                  className="rounded-md bg-[var(--surface-card)]/90 p-1.5 text-[var(--surface-muted)] shadow hover:text-red-600"
                  title="Delete board"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {/* Editors badge */}
              {b.editorsCount > 0 && (
                <span className="absolute left-2 top-2 rounded-full bg-brand-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  +{b.editorsCount}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-[var(--surface-muted)]">
          <span>{data.total} boards · page {data.page} of {data.pages}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-[var(--surface-border)] p-1.5 disabled:opacity-40 hover:bg-[var(--surface-border)]"><ChevronLeft size={16} /></button>
            <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-[var(--surface-border)] p-1.5 disabled:opacity-40 hover:bg-[var(--surface-border)]"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-sm rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold text-[var(--surface-text)]">Delete board?</h3>
            <p className="mb-4 text-sm text-[var(--surface-muted)]">
              Delete <strong className="text-[var(--surface-text)]">{confirmDelete.name}</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm text-[var(--surface-muted)] hover:bg-[var(--surface-bg)]">Cancel</button>
              <button onClick={handleDelete} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
