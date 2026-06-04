import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Search, Loader2 } from "lucide-react";
import { useSession } from "../../lib/auth-client";
import {
  getWhiteboards,
  createWhiteboard,
  getActiveBoards,
} from "../../api/whiteboard";
import WhiteboardCard from "./WhiteBoardCard.jsx";
import ThemeToggle from "../ThemeToggle";
import UserMenu from "../UserMenu";

const PAGE_SIZE = 8;

const SORT_OPTIONS = [
  { value: "updatedAt", label: "Last edited" },
  { value: "createdAt", label: "Date created" },
  { value: "name", label: "Name A–Z" },
];

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "solo", label: "Solo" },
  { value: "shared", label: "Shared" },
];

export default function WhiteboardHome() {
  const [whiteboards, setWhiteboards] = useState([]);
  const [filteredBoards, setFilteredBoards] = useState([]);
  const [name, setName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [createError, setCreateError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeUsers, setActiveUsers] = useState({}); // boardId -> [{ userId, username }]
  const [sortBy, setSortBy] = useState("updatedAt");
  const [filterBy, setFilterBy] = useState("all");
  const [ownedVisible, setOwnedVisible] = useState(PAGE_SIZE);
  const [sharedVisible, setSharedVisible] = useState(PAGE_SIZE);
  const ownedSentinelRef = useRef(null);
  const sharedSentinelRef = useRef(null);
  const location = useLocation();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  useEffect(() => {
    let alive = true;
    const load = () =>
      getActiveBoards().then(({ users }) => {
        if (alive) setActiveUsers(users);
      });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    getWhiteboards()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setWhiteboards(arr);
        setFilteredBoards(arr);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => {
      const term = searchTerm.trim().toLowerCase();
      setFilteredBoards(
        term === ""
          ? whiteboards
          : whiteboards.filter(
              (wb) =>
                wb.name.toLowerCase().includes(term) ||
                (wb.textIndex || "").includes(term)
            )
      );
      setOwnedVisible(PAGE_SIZE);
      setSharedVisible(PAGE_SIZE);
    }, 400);
    return () => clearTimeout(delay);
  }, [searchTerm, whiteboards]);

  useEffect(() => {
    if (location.state?.refresh) {
      getWhiteboards().then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setWhiteboards(arr);
        setFilteredBoards(arr);
      });
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const sortBoards = useCallback(
    (arr) => {
      return [...arr].sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        return new Date(b[sortBy]) - new Date(a[sortBy]);
      });
    },
    [sortBy]
  );

  const ownedBoards = useMemo(() => {
    if (!currentUserId) return [];
    const owned = filteredBoards.filter((wb) => wb.userId === currentUserId);
    const filtered =
      filterBy === "shared"
        ? []
        : filterBy === "solo"
        ? owned.filter((wb) => !wb.editors?.length)
        : owned;
    return sortBoards(filtered);
  }, [filteredBoards, currentUserId, filterBy, sortBoards]);

  const sharedBoards = useMemo(() => {
    if (!currentUserId) return [];
    const shared = filteredBoards.filter((wb) => wb.userId !== currentUserId);
    const filtered = filterBy === "solo" ? [] : shared;
    return sortBoards(filtered);
  }, [filteredBoards, currentUserId, filterBy, sortBoards]);

  // Infinite scroll for owned boards
  useEffect(() => {
    const sentinel = ownedSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setOwnedVisible((v) => v + PAGE_SIZE);
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [ownedBoards.length]);

  // Infinite scroll for shared boards
  useEffect(() => {
    const sentinel = sharedSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setSharedVisible((v) => v + PAGE_SIZE);
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sharedBoards.length]);

  const handleDelete = (id) => {
    setWhiteboards((prev) => prev.filter((wb) => wb._id !== id));
    setFilteredBoards((prev) => prev.filter((wb) => wb._id !== id));
  };

  const handleRename = (id, newName, updatedAt) => {
    const apply = (list) =>
      [...list]
        .map((wb) => (wb._id === id ? { ...wb, name: newName, updatedAt } : wb))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    setWhiteboards(apply);
    setFilteredBoards(apply);
  };

  const handleDuplicate = (newBoard) => {
    setWhiteboards((prev) => [newBoard, ...prev]);
    setFilteredBoards((prev) => [newBoard, ...prev]);
  };

  const handleCreate = async () => {
    setCreateError("");
    const res = await createWhiteboard(name);
    if (res._id) {
      setWhiteboards((prev) => [res, ...prev]);
      setName("");
      setShowPopup(false);
    } else {
      setCreateError(res.error || "Could not create whiteboard");
    }
  };

  const sectionEmpty = (text) => (
    <div className="col-span-full mt-6 text-center text-sm text-[var(--surface-muted)]">
      {text}
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--surface-bg)]">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface-card)] px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            W
          </div>
          <h1 className="text-lg font-extrabold tracking-tight text-[var(--surface-text)]">
            Whitebored
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Search + sort/filter bar */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--surface-muted)]"
            />
            <input
              type="text"
              placeholder="Search by name or content…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-2 pl-9 pr-3 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div className="flex items-center gap-2">
            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {/* Filter pills */}
            <div className="flex rounded-lg border border-[var(--surface-border)] overflow-hidden">
              {FILTER_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setFilterBy(o.value)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${
                    filterBy === o.value
                      ? "bg-brand-600 text-white"
                      : "bg-[var(--surface-card)] text-[var(--surface-muted)] hover:bg-[var(--surface-border)]"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-[var(--surface-muted)]">
            <Loader2 className="animate-spin" size={18} /> Loading your boards…
          </div>
        )}

        {!loading && (
          <>
            {/* Owned */}
            <section className="mb-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-600">
                Owned by you
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                <button
                  onClick={() => setShowPopup(true)}
                  className="flex h-48 flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-[var(--surface-border)] text-[var(--surface-muted)] transition-colors hover:border-brand-500 hover:text-brand-600"
                >
                  <Plus size={28} />
                  <span className="text-sm font-medium">Create New</span>
                </button>
                {ownedBoards.length === 0 && sectionEmpty("No whiteboards yet. Create one!")}
                {ownedBoards.slice(0, ownedVisible).map((wb) => (
                  <WhiteboardCard
                    key={wb._id}
                    whiteboard={wb}
                    onDelete={handleDelete}
                    onRename={handleRename}
                    onDuplicate={handleDuplicate}
                    activeUsers={activeUsers[wb._id]}
                  />
                ))}
              </div>
              {ownedVisible < ownedBoards.length && (
                <div ref={ownedSentinelRef} className="mt-4 flex justify-center py-2">
                  <Loader2 className="animate-spin text-[var(--surface-muted)]" size={18} />
                </div>
              )}
            </section>

            {/* Shared */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent-600">
                Shared with you
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {sharedBoards.length === 0 && sectionEmpty("No shared whiteboards yet.")}
                {sharedBoards.slice(0, sharedVisible).map((wb) => (
                  <WhiteboardCard
                    key={wb._id}
                    whiteboard={wb}
                    onDelete={handleDelete}
                    onRename={handleRename}
                    onDuplicate={handleDuplicate}
                    activeUsers={activeUsers[wb._id]}
                  />
                ))}
              </div>
              {sharedVisible < sharedBoards.length && (
                <div ref={sharedSentinelRef} className="mt-4 flex justify-center py-2">
                  <Loader2 className="animate-spin text-[var(--surface-muted)]" size={18} />
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Create modal */}
      {showPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowPopup(false)}
        >
          <div
            className="animate-fade-in w-full max-w-sm rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-semibold text-[var(--surface-text)]">
              Name your whiteboard
            </h3>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="e.g. Sprint planning"
              className="mb-3 w-full rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
            {createError && (
              <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                {createError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowPopup(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--surface-muted)] hover:bg-[var(--surface-bg)]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
