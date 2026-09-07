import React, { useState } from "react";
import { NavLink, Outlet, Navigate, useNavigate } from "react-router-dom";
import { BarChart2, Users, Layout, Radio, ArrowLeft, ShieldCheck, Menu, X } from "lucide-react";
import { useIsAdmin } from "../../hooks/useIsAdmin";
import ThemeToggle from "../ThemeToggle";

const navItems = [
  { to: "/admin/stats", label: "Analytics", icon: BarChart2 },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/boards", label: "Boards", icon: Layout },
  { to: "/admin/live", label: "Live", icon: Radio },
];

// Guard: redirects if not admin. Reuses the shared check rather than making its
// own request — two independent probes meant a second 403 for a normal user who
// wandered to an admin URL, and two answers that could disagree.
export function AdminRoute({ children }) {
  const { isAdmin, checked } = useIsAdmin();

  if (!checked) return null;
  if (!isAdmin) return <Navigate to="/whiteboards" />;
  return children;
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[var(--surface-bg)]">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-56 shrink-0 flex-col border-r border-[var(--surface-border)] bg-[var(--surface-card)] transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-[var(--surface-border)] px-4 py-4">
          <ShieldCheck size={20} className="text-brand-600" />
          <span className="font-bold text-[var(--surface-text)]">Admin</span>
          <button
            className="ml-auto rounded-md p-1 text-[var(--surface-muted)] hover:bg-[var(--surface-border)] md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const { to, label } = item;
            const NavIcon = item.icon;
            return (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-600 text-white"
                    : "text-[var(--surface-muted)] hover:bg-[var(--surface-border)] hover:text-[var(--surface-text)]"
                }`
              }
            >
              <NavIcon size={16} />
              {label}
            </NavLink>
            );
          })}
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
        <header className="flex items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-[var(--surface-muted)] hover:bg-[var(--surface-border)] md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <h1 className="text-base font-semibold text-[var(--surface-text)]">Admin Dashboard</h1>
          </div>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
