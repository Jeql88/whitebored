import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, LogOut } from "lucide-react";
import { useSession, authClient } from "../lib/auth-client";
import { getInitials, getColorForName } from "../utils/userColor";

// Avatar button + dropdown (Account settings / Logout), shared by the dashboard
// and the editor top bar.
export default function UserMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { data: session } = useSession();
  const name = session?.user?.name || session?.user?.email || "Guest";

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const logout = async () => {
    await authClient.signOut();
    navigate("/login");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={name}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold text-white ring-2 ring-transparent transition hover:ring-brand-500/40"
        style={{ background: getColorForName(name) }}
      >
        {getInitials(name)}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-48 overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-1 shadow-lg">
          <div className="border-b border-[var(--surface-border)] px-3 py-2 text-xs text-[var(--surface-muted)]">
            Signed in as <span className="font-semibold text-[var(--surface-text)]">{name}</span>
          </div>
          <button
            onClick={() => navigate("/account")}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--surface-text)] hover:bg-brand-50 dark:hover:bg-brand-600/15"
          >
            <Settings size={15} /> Account settings
          </button>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            <LogOut size={15} /> Logout
          </button>
        </div>
      )}
    </div>
  );
}
