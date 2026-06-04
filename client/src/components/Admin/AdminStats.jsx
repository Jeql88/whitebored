import React, { useEffect, useState } from "react";
import { Users, Layout, MessageSquare, Radio, ScanText } from "lucide-react";
import { getAdminStats } from "../../api/admin";

function StatCard({ icon: Icon, label, value, color = "text-brand-600" }) {
  return (
    <div className="rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-5">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg bg-brand-50 p-2.5 dark:bg-brand-600/15 ${color}`}>
          <Icon size={20} />
        </div>
        <div>
          <p className="text-2xl font-bold text-[var(--surface-text)]">
            {value ?? "—"}
          </p>
          <p className="text-sm text-[var(--surface-muted)]">{label}</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-[var(--surface-muted)]">Loading…</div>;
  if (!stats || stats.error) return <div className="text-sm text-red-500">Failed to load stats.</div>;

  const maxDay = Math.max(1, ...(stats.dailyBoards || []).map((d) => d.count));

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[var(--surface-text)]">Analytics</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard icon={Users} label="Total users" value={stats.totalUsers} />
        <StatCard icon={Layout} label="Total boards" value={stats.totalBoards} />
        <StatCard icon={MessageSquare} label="Total comments" value={stats.totalComments} />
        <StatCard icon={Layout} label="New boards (7d)" value={stats.newBoards} />
        <StatCard icon={Radio} label="Active now" value={stats.activeBoards} color="text-green-600" />
        <StatCard icon={ScanText} label="Boards with OCR" value={stats.boardsWithOcr} />
      </div>

      {/* Daily boards chart */}
      <div className="rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-[var(--surface-text)]">
          Boards created — last 7 days
        </h3>
        <div className="flex items-end gap-2 h-32">
          {(stats.dailyBoards || []).map((d) => (
            <div key={d._id} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs text-[var(--surface-muted)]">{d.count > 0 ? d.count : ""}</span>
              <div
                className="w-full rounded-t bg-brand-600"
                style={{ height: `${Math.round((d.count / maxDay) * 100)}%`, minHeight: d.count > 0 ? 4 : 2, opacity: d.count > 0 ? 1 : 0.15 }}
              />
              <span className="text-[10px] text-[var(--surface-muted)]">
                {new Date(d._id + "T00:00:00").toLocaleDateString("en", { weekday: "short" })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
