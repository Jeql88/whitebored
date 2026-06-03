import { forwardRef, useState } from "react";
import { Link2, Check, X, UserPlus } from "lucide-react";
import { addCollaborator, removeCollaborator, updateCollaboratorRole } from "../../api/whiteboard";

const ROLES = ["editor", "viewer"];
const ROLE_LABEL = { editor: "Editor", viewer: "Viewer" };

function Avatar({ name }) {
  const initials = name
    ? name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()
    : "?";
  const hue = [...(name || "")].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: `hsl(${hue},55%,48%)` }}
    >
      {initials}
    </div>
  );
}

const SharePanel = forwardRef(function SharePanel(
  {
    whiteboardId,
    shareMode,
    shareAccess,
    boardCollaborators,
    setBoardCollaborators,
    isOwner,
    ownerName,
    currentUserId,
    onShareModeChange,
    onShareAccessChange,
    onClose,
    onCopyLink,
    copied,
  },
  ref
) {
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("editor");
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addEmail.trim()) return;
    setAddLoading(true);
    setAddError("");
    const data = await addCollaborator(whiteboardId, addEmail.trim(), addRole);
    setAddLoading(false);
    if (data.error) {
      setAddError(data.error);
      return;
    }
    setBoardCollaborators((prev) => [...prev, data]);
    setAddEmail("");
  };

  const handleRemove = async (userId) => {
    const data = await removeCollaborator(whiteboardId, userId);
    if (!data.error) {
      setBoardCollaborators((prev) => prev.filter((c) => c.userId !== userId));
    }
  };

  const handleRoleChange = async (userId, role) => {
    const data = await updateCollaboratorRole(whiteboardId, userId, role);
    if (!data.error) {
      setBoardCollaborators((prev) =>
        prev.map((c) => (c.userId === userId ? { ...c, role } : c))
      );
    }
  };

  const restricted = shareAccess === "auth";
  const explicitCollabs = boardCollaborators.filter((c) => c.role !== "visitor");
  const visitors = boardCollaborators.filter((c) => c.role === "visitor");

  const sectionLabel = "mb-1.5 text-xs font-medium text-[var(--surface-muted)]";
  const segBtn = (active, disabled) =>
    `flex-1 py-2 text-xs font-medium transition-colors ${
      disabled
        ? active
          ? "bg-brand-600/40 text-white/60 cursor-not-allowed"
          : "text-[var(--surface-muted)]/50 cursor-not-allowed"
        : active
        ? "bg-brand-600 text-white"
        : "text-[var(--surface-muted)] hover:bg-[var(--surface-border)]"
    }`;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-11 z-40 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-4 shadow-xl"
      style={{ width: 320 }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--surface-text)]">Share board</p>
        <button onClick={onClose} className="text-[var(--surface-muted)] hover:text-[var(--surface-text)]">
          <X size={14} />
        </button>
      </div>

      {/* Add people — owner only */}
      {isOwner && (
        <form onSubmit={handleAdd} className="mb-4">
          <p className={sectionLabel}>Add people</p>
          <div className="flex gap-1.5">
            <input
              type="email"
              value={addEmail}
              onChange={(e) => { setAddEmail(e.target.value); setAddError(""); }}
              placeholder="Email address"
              className="min-w-0 flex-1 rounded-lg border border-[var(--surface-border)] bg-transparent px-2.5 py-1.5 text-xs text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] px-1.5 py-1.5 text-xs text-[var(--surface-text)] outline-none"
            >
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button
              type="submit"
              disabled={addLoading || !addEmail.trim()}
              className="flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <UserPlus size={12} />
              {addLoading ? "…" : "Invite"}
            </button>
          </div>
          {addError && (
            <p className="mt-1 text-xs text-red-500">{addError}</p>
          )}
        </form>
      )}

      {/* People with access */}
      <div className="mb-4">
        <p className={sectionLabel}>People with access</p>
        <ul className="space-y-1.5">
          {/* Owner row */}
          <li className="flex items-center gap-2">
            <Avatar name={ownerName} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[var(--surface-text)]">{ownerName}</p>
            </div>
            <span className="text-xs text-[var(--surface-muted)]">Owner</span>
          </li>

          {/* Explicit collaborator rows (editor / viewer) */}
          {explicitCollabs.map((c) => (
            <li key={c.userId} className="flex items-center gap-2">
              <Avatar name={c.name || c.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[var(--surface-text)]">{c.name || c.email}</p>
                {c.name && c.email && (
                  <p className="truncate text-[10px] text-[var(--surface-muted)]">{c.email}</p>
                )}
              </div>
              {isOwner ? (
                <>
                  <select
                    value={c.role}
                    onChange={(e) => handleRoleChange(c.userId, e.target.value)}
                    className="rounded border border-[var(--surface-border)] bg-[var(--surface-card)] px-1 py-0.5 text-xs text-[var(--surface-text)] outline-none"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button
                    onClick={() => handleRemove(c.userId)}
                    className="text-[var(--surface-muted)] hover:text-red-500"
                    title="Remove"
                  >
                    <X size={13} />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-[var(--surface-muted)]">{ROLE_LABEL[c.role]}</span>
                  {c.userId === currentUserId && (
                    <button
                      onClick={() => handleRemove(c.userId)}
                      className="text-[var(--surface-muted)] hover:text-red-500"
                      title="Leave"
                    >
                      <X size={13} />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Visited via link */}
      {(isOwner ? visitors.length > 0 : visitors.some((v) => v.userId === currentUserId)) && (
        <div className="mb-4">
          <p className={sectionLabel}>Visited via link</p>
          <ul className="space-y-1.5">
            {(isOwner ? visitors : visitors.filter((v) => v.userId === currentUserId)).map((v) => (
              <li key={v.userId} className="flex items-center gap-2">
                <Avatar name={v.name || v.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--surface-text)]">{v.name || v.email}</p>
                  {v.name && v.email && (
                    <p className="truncate text-[10px] text-[var(--surface-muted)]">{v.email}</p>
                  )}
                </div>
                <span className="text-xs text-[var(--surface-muted)]">Visitor</span>
                {(isOwner || v.userId === currentUserId) && (
                  <button
                    onClick={() => handleRemove(v.userId)}
                    className="text-[var(--surface-muted)] hover:text-red-500"
                    title={v.userId === currentUserId ? "Remove from my boards" : "Remove"}
                  >
                    <X size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* General access */}
      <div className="mb-4">
        <p className={sectionLabel}>General access</p>
        <div className="flex flex-col gap-2">
          {/* shareAccess toggle */}
          <div className="flex overflow-hidden rounded-lg border border-[var(--surface-border)]">
            <button
              onClick={() => isOwner && onShareAccessChange("anyone")}
              className={segBtn(!restricted, !isOwner)}
              disabled={!isOwner}
            >
              Anyone with link
            </button>
            <button
              onClick={() => isOwner && onShareAccessChange("auth")}
              className={segBtn(restricted, !isOwner)}
              disabled={!isOwner}
            >
              Restricted
            </button>
          </div>
          {/* shareMode toggle — greyed when restricted */}
          <div className={`flex overflow-hidden rounded-lg border border-[var(--surface-border)] ${restricted ? "opacity-40 pointer-events-none" : ""}`}>
            {[["edit", "Editor"], ["view", "Viewer"]].map(([m, label]) => (
              <button
                key={m}
                onClick={() => isOwner && onShareModeChange(m)}
                className={segBtn(shareMode === m, !isOwner)}
                disabled={!isOwner}
              >
                {label}
              </button>
            ))}
          </div>
          {!isOwner && (
            <p className="text-[10px] text-[var(--surface-muted)]">Only the board owner can change these settings.</p>
          )}
        </div>
      </div>

      {/* Copy link */}
      <button
        onClick={onCopyLink}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
      >
        {copied ? <Check size={14} className="text-green-300" /> : <Link2 size={14} />}
        {copied ? "Link copied!" : "Copy share link"}
      </button>
    </div>
  );
});

export default SharePanel;
