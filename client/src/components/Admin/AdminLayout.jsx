import React, { useEffect, useState } from "react";
import { NavLink, Outlet, Navigate, useNavigate } from "react-router-dom";
import { BarChart2, Users, Layout, Radio, ArrowLeft, ShieldCheck } from "lucide-react";
import { apiFetch } from "../../api/config";
import ThemeToggle from "../ThemeToggle";

const navItems = [
  { to: "/admin/stats", label: "Analytics", icon: BarChart2 },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/boards", label: "Boards", icon: Layout },
  { to: "/admin/live", label: "Live", icon: Radio },
];

// Guard: checks /api/admin/me and redirects if not admin.
export function AdminRoute({ children }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState("checking"); // checking | ok | denied

  useEffect(() => {
    apiFetch("/api/admin/me")
      .then((res) => setStatus(res.ok ? "ok" : "denied"))
      .catch(() => setStatus("denied"));
  }, []);

  if (status === "checking") return null;
  if (status === "denied") return <Navigate to="/whiteboards" />;
  return children;
}

export default function AdminLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-[var(--surface-bg)]">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--surface-border)] bg-[var(--surface-card)]">
        <div className="flex items-center gap-2 border-b border-[var(--surface-border)] px-4 py-4">
          <ShieldCheck size={20} className="text-brand-600" />
          <span className="font-bold text-[var(--surface-text)]">Admin</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-600 text-white"
                    : "text-[var(--surface-muted)] hover:bg-[var(--surface-border)] hover:text-[var(--surface-text)]"
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[var(--surface-border)] p-3">
          <button
            onClick={() => navigate("/whiteboards")}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--surface-muted)] hover:bg-[var(--surface-border)] hover:text-[var(--surface-text)]"
          >
            <ArrowLeft size={16} /> Back to app
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface-card)] px-6 py-3">
          <h1 className="text-base font-semibold text-[var(--surface-text)]">Admin Dashboard</h1>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
