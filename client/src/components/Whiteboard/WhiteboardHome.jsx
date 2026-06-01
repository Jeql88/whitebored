import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Plus, Search, LogOut } from "lucide-react";
import {
  getWhiteboards,
  createWhiteboard,
} from "../../api/whiteboard";
import WhiteboardCard from "./WhiteBoardCard.jsx";
import ThemeToggle from "../ThemeToggle";

function getUserIdFromToken() {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split(".")[1])).userId;
  } catch {
    return null;
  }
}

const DISPLAY_LIMIT = 5;

export default function WhiteboardHome() {
  const [whiteboards, setWhiteboards] = useState([]);
  const [filteredBoards, setFilteredBoards] = useState([]);
  const [name, setName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [showAllOwned, setShowAllOwned] = useState(false);
  const [showAllShared, setShowAllShared] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const currentUserId = getUserIdFromToken();

  useEffect(() => {
    getWhiteboards().then((data) => {
      const arr = Array.isArray(data) ? data : [];
      setWhiteboards(arr);
      setFilteredBoards(arr);
    });
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => {
      const term = searchTerm.trim().toLowerCase();
      setFilteredBoards(
        term === ""
          ? whiteboards
          : whiteboards.filter((wb) => wb.name.toLowerCase().includes(term))
      );
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

  useEffect(() => {
    setShowAllOwned(false);
    setShowAllShared(false);
  }, [searchTerm]);

  const ownedBoards = useMemo(
    () => filteredBoards.filter((wb) => wb.userId === currentUserId),
    [filteredBoards, currentUserId]
  );
  const sharedBoards = useMemo(
    () => filteredBoards.filter((wb) => wb.userId !== currentUserId),
    [filteredBoards, currentUserId]
  );

  const ownedToShow = showAllOwned ? ownedBoards : ownedBoards.slice(0, DISPLAY_LIMIT);
  const sharedToShow = showAllShared ? sharedBoards : sharedBoards.slice(0, DISPLAY_LIMIT);

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

  const handleCreate = async () => {
    const res = await createWhiteboard(name);
    if (res._id) {
      setWhiteboards((prev) => [res, ...prev]);
      setName("");
      setShowPopup(false);
    }
  };

  const sectionEmpty = (text) => (
    <div className="col-span-full mt-6 text-center text-sm text-[var(--surface-muted)]">
      {text}
    </div>
  );

  const showMoreBtn = (all, setAll, count) =>
    count > DISPLAY_LIMIT && (
      <div className="mt-4 text-center">
        <button
          onClick={() => setAll((v) => !v)}
          className="rounded-lg border border-[var(--surface-border)] px-4 py-1.5 text-sm font-medium text-[var(--surface-text)] hover:bg-brand-50 dark:hover:bg-brand-600/15"
        >
          {all ? "Show Less" : `Show More (${count - DISPLAY_LIMIT} more)`}
        </button>
      </div>
    );

  return (
    <div className="min-h-screen bg-[var(--surface-bg)]">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface-card)] px-6 py-3">
        <h1 className="text-lg font-bold text-[var(--surface-text)]">
          Your Whiteboards
        </h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => {
              localStorage.removeItem("token");
              navigate("/login");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-sm font-medium text-[var(--surface-text)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Search */}
        <div className="relative mb-8 max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--surface-muted)]"
          />
          <input
            type="text"
            placeholder="Search whiteboards…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-2 pl-9 pr-3 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </div>

        {/* Owned */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-600">
            Owned by you
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <button
              onClick={() => setShowPopup(true)}
              className="flex h-36 flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-[var(--surface-border)] text-[var(--surface-muted)] transition-colors hover:border-brand-500 hover:text-brand-600"
            >
              <Plus size={28} />
              <span className="text-sm font-medium">Create New</span>
            </button>
            {ownedBoards.length === 0 && sectionEmpty("No whiteboards yet. Create one!")}
            {ownedToShow.map((wb) => (
              <WhiteboardCard
                key={wb._id}
                whiteboard={wb}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))}
          </div>
          {showMoreBtn(showAllOwned, setShowAllOwned, ownedBoards.length)}
        </section>

        {/* Shared */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent-600">
            Shared with you
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sharedBoards.length === 0 && sectionEmpty("No shared whiteboards yet.")}
            {sharedToShow.map((wb) => (
              <WhiteboardCard
                key={wb._id}
                whiteboard={wb}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))}
          </div>
          {showMoreBtn(showAllShared, setShowAllShared, sharedBoards.length)}
        </section>
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
              className="mb-4 w-full rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
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
