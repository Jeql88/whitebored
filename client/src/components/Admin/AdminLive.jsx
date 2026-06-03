import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, ExternalLink, User } from "lucide-react";
import { getAdminLive } from "../../api/admin";
import { getColorForName, getInitials } from "../../utils/userColor";

export default function AdminLive() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = () => {
    getAdminLive().then((d) => {
      setData(d);
      setLastUpdated(new Date());
    });
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[var(--surface-text)]">Live activity</h2>
          {data && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              {data.totalOnline} online
            </span>
          )}
        </div>
        {lastUpdated && (
          <span className="text-xs text-[var(--surface-muted)]">
            Updated {lastUpdated.toLocaleTimeString()} · refreshes every 10s
          </span>
        )}
      </div>

      {!data ? (
        <div className="text-sm text-[var(--surface-muted)]">Loading…</div>
      ) : !data.boards?.length ? (
        <div className="flex flex-col items-center justify-center rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] py-16 text-[var(--surface-muted)]">
          <Radio size={32} className="mb-3 opacity-30" />
          <p className="text-sm">No one is online right now.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.boards.map((b) => (
            <div key={b.id} className="rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--surface-text)] truncate">{b.name}</p>
                  <p className="text-xs text-[var(--surface-muted)]">{b.users.length} {b.users.length === 1 ? "person" : "people"}</p>
                </div>
                <button
                  onClick={() => navigate(`/whiteboard/${b.id}`)}
                  className="shrink-0 rounded-lg p-1.5 text-[var(--surface-muted)] hover:bg-[var(--surface-border)] hover:text-brand-600"
                  title="Open board"
                >
                  <ExternalLink size={15} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {b.users.map((u) => (
                  <div key={u.userId} className="flex items-center gap-1.5" title={u.username}>
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                      style={{ background: getColorForName(u.username) }}
                    >
                      {u.isGuest ? <User size={12} /> : getInitials(u.username)}
                    </div>
                    <span className="text-xs text-[var(--surface-muted)] max-w-[80px] truncate">
                      {u.isGuest ? "Guest" : u.username}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
