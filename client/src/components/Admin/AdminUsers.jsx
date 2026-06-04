import React, { useEffect, useState, useCallback } from "react";
import { Search, Trash2, CheckCircle, XCircle, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { getAdminUsers, deleteAdminUser, verifyAdminUser } from "../../api/admin";
import { formatDistanceToNow } from "date-fns";

export default function AdminUsers({ onFilterBoards }) {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    getAdminUsers({ page, limit: 20, search })
      .then(setData)
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search]);

  const handleDelete = async () => {
    await deleteAdminUser(confirmDelete.id);
    setConfirmDelete(null);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-[var(--surface-text)]">Users</h2>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--surface-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-2 pl-8 pr-3 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-[var(--surface-border)]">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--surface-border)] bg-[var(--surface-bg)]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-[var(--surface-muted)]">User</th>
              <th className="hidden sm:table-cell px-4 py-3 text-left font-semibold text-[var(--surface-muted)]">Joined</th>
              <th className="hidden sm:table-cell px-4 py-3 text-center font-semibold text-[var(--surface-muted)]">Verified</th>
              <th className="px-4 py-3 text-center font-semibold text-[var(--surface-muted)]">Boards</th>
              <th className="px-4 py-3 text-right font-semibold text-[var(--surface-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--surface-border)] bg-[var(--surface-card)]">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--surface-muted)]">Loading…</td></tr>
            ) : !data?.users?.length ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--surface-muted)]">No users found.</td></tr>
            ) : data.users.map((u) => (
              <tr key={u.id} className="hover:bg-[var(--surface-bg)]">
                <td className="px-4 py-3">
                  <p className="font-medium text-[var(--surface-text)]">{u.name || "—"}</p>
                  <p className="text-xs text-[var(--surface-muted)]">{u.email}</p>
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-[var(--surface-muted)]">
                  {u.createdAt ? formatDistanceToNow(new Date(u.createdAt)) + " ago" : "—"}
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-center">
                  {u.emailVerified
                    ? <CheckCircle size={16} className="mx-auto text-green-500" />
                    : <XCircle size={16} className="mx-auto text-[var(--surface-muted)]" />}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => onFilterBoards?.(u.id)}
                    className="font-semibold text-brand-600 hover:underline"
                    title="View boards"
                  >
                    {u.ownedBoards}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {!u.emailVerified && (
                      <button
                        onClick={async () => {
                          await verifyAdminUser(u.id);
                          load();
                        }}
                        className="rounded-md p-1.5 text-[var(--surface-muted)] hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-500/10"
                        title="Verify user"
                      >
                        <ShieldCheck size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDelete(u)}
                      className="rounded-md p-1.5 text-[var(--surface-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                      title="Delete user"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-[var(--surface-muted)]">
          <span>{data.total} users · page {data.page} of {data.pages}</span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-[var(--surface-border)] p-1.5 disabled:opacity-40 hover:bg-[var(--surface-border)]"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-[var(--surface-border)] p-1.5 disabled:opacity-40 hover:bg-[var(--surface-border)]"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-sm rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold text-[var(--surface-text)]">Delete user?</h3>
            <p className="mb-4 text-sm text-[var(--surface-muted)]">
              Delete <strong className="text-[var(--surface-text)]">{confirmDelete.email}</strong>? Their boards will remain but show no owner.
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
