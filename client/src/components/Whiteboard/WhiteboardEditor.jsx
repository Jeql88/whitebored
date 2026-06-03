import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "../../lib/auth-client";
import { io } from "socket.io-client";
import {
  Excalidraw,
  MainMenu,
  exportToBlob,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import jsPDF from "jspdf";
import {
  ArrowLeft,
  MessageSquare,
  MessagesSquare,
  Link2,
  Check,
  Sun,
  Moon,
  Grid3x3,
  FileImage,
  FileText,
  Trash2,
  Maximize,
  ScanText,
  X,
  PenLine,
  Lock,
  LockOpen,
  Users,
  LogIn,
} from "lucide-react";

import { API_BASE } from "../../api/config";
import { updateWhiteboard, saveThumbnail, extractText, updateShareSettings } from "../../api/whiteboard";
import { useTheme } from "../../theme/ThemeContext";
import { getColorForName, getInitials } from "../../utils/userColor";
import { counterInvertDataUrl } from "../../utils/imageFilter";
import CommentsSidebar from "./CommentsSidebar";
import ChatBox from "../Chatbox";
import Minimap from "./Minimap";
import UserMenu from "../UserMenu";

const SCENE_DEBOUNCE_MS = 250;
const CURSOR_THROTTLE_MS = 50;

// Merge incoming elements with the current local ones by id, keeping the higher
// version. Prevents a remote update from dropping a local element the server
// hasn't merged into its broadcast yet.
function reconcileElements(local = [], incoming = []) {
  const byId = new Map();
  for (const el of local) if (el && el.id) byId.set(el.id, el);
  for (const el of incoming) {
    if (!el || !el.id) continue;
    const prev = byId.get(el.id);
    if (!prev) {
      byId.set(el.id, el);
      continue;
    }
    const pv = prev.version ?? 0;
    const nv = el.version ?? 0;
    if (nv > pv || (nv === pv && (el.versionNonce ?? 0) > (prev.versionNonce ?? 0))) {
      byId.set(el.id, el);
    }
  }
  return Array.from(byId.values());
}

export default function WhiteboardEditor() {
  const { id: whiteboardId } = useParams();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [boardName, setBoardName] = useState("Untitled");
  const [collaborators, setCollaborators] = useState([]); // presence avatars
  const [openPanel, setOpenPanel] = useState(null); // 'comments' | 'chat' | null
  const [copied, setCopied] = useState(false);
  const [socket, setSocket] = useState(null);
  const [disconnected, setDisconnected] = useState(false);
  const [toast, setToast] = useState("");
  const [ocrResult, setOcrResult] = useState(null);
  const [ocrCopied, setOcrCopied] = useState(false);
  const [shareMode, setShareMode] = useState("edit");   // "edit" | "view"
  const [shareAccess, setShareAccess] = useState("anyone"); // "anyone" | "auth"
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [gridMode, setGridMode] = useState(
    () => localStorage.getItem("wb-grid") === "1"
  );
  const [penMode, setPenMode] = useState(
    () => localStorage.getItem("wb-pen") === "1"
  );

  const toggleGrid = () =>
    setGridMode((v) => {
      localStorage.setItem("wb-grid", v ? "0" : "1");
      return !v;
    });

  const togglePenMode = () =>
    setPenMode((v) => {
      const next = !v;
      localStorage.setItem("wb-pen", next ? "1" : "0");
      apiRef.current?.updateScene({
        appState: { penMode: next },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      return next;
    });

  const apiRef = useRef(null); // excalidrawAPI
  const isApplyingRemote = useRef(false);
  const sceneTimer = useRef(null);
  const applyTimer = useRef(null);
  const cursorThrottle = useRef(0);
  const remoteCursors = useRef(new Map()); // socketId -> collaborator pointer
  // fileId -> { original, inverted } dataURLs, for dark-mode image correction.
  const imageVariants = useRef(new Map());

  const { data: session } = useSession();

  // Stable guest ID persisted for this tab so a guest keeps ONE identity
  // across reloads/reconnects (avoids duplicate avatars).
  const guestId = useRef(null);
  if (!guestId.current) {
    let gid = sessionStorage.getItem("wb-guest-id");
    if (!gid) {
      gid = `guest-${(crypto.randomUUID?.() || `${performance.now()}`).toString().slice(0, 8)}`;
      sessionStorage.setItem("wb-guest-id", gid);
    }
    guestId.current = gid;
  }

  // Derive identity reactively from session so it updates once BetterAuth loads.
  const isGuest = !session?.user;
  const me = session?.user
    ? {
        userId: session.user.id,
        username: session.user.name || session.user.email || session.user.id,
      }
    : { userId: guestId.current, username: "Guest" };

  // --- Socket lifecycle ---
  // BetterAuth uses cookies — Socket.IO sends them automatically via withCredentials.
  useEffect(() => {
    const s = io(API_BASE, { withCredentials: true });
    setSocket(s);
    wireSocket(s);
    return () => s?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboardId]);

  // Extracted socket event wiring so it can be called after token is ready.
  const wireSocket = (s) => {
    setSocket(s);

    // Fires on first connect AND every reconnect — so we re-join the room,
    // re-announce presence, and re-hydrate the scene after a drop.
    s.on("connect", () => {
      setDisconnected(false);
      s.emit("joinWhiteboard", whiteboardId);
      s.emit("presence", {
        whiteboardId,
        userId: me.userId,
        username: me.username,
      });
    });
    s.on("disconnect", () => setDisconnected(true));
    s.on("accessDenied", ({ reason }) => {
      if (reason === "auth_required") {
        // Board is set to logged-in users only — redirect to login with returnTo.
        const returnTo = encodeURIComponent(window.location.pathname);
        window.location.assign(`/login?returnTo=${returnTo}`);
      }
    });

    // Apply a remote scene, reconciling with the current local elements so we
    // never drop a local element the broadcast didn't include yet. The
    // isApplyingRemote guard is cleared on a short timeout (not a microtask) so
    // Excalidraw's resulting onChange is reliably suppressed and doesn't echo.
    const applyRemoteScene = (scene) => {
      if (!scene || !apiRef.current) return;
      isApplyingRemote.current = true;
      // Include deleted tombstones so an incoming delete (higher version) wins
      // the reconcile and the element is removed locally — not resurrected.
      const local = apiRef.current.getSceneElementsIncludingDeleted();
      apiRef.current.updateScene({
        elements: reconcileElements(local, scene.elements || []),
        appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor },
        // Remote changes must NOT enter this user's undo stack — otherwise undo
        // reverts other people's strokes / jumps to an empty pre-sync snapshot.
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      if (scene.files && Object.keys(scene.files).length) {
        apiRef.current.addFiles(Object.values(scene.files));
      }
      clearTimeout(applyTimer.current);
      applyTimer.current = setTimeout(() => {
        isApplyingRemote.current = false;
      }, 80);
    };

    // On initial hydration, if a local draft is NEWER than the server scene
    // (e.g. a refresh happened before the last change synced), prefer the draft
    // and push it up. reconcileElements (id+version) makes this safe to merge.
    // Listen for live share mode changes from the owner.
    s.on("shareModeChanged", ({ shareMode: newMode }) => {
      setShareMode(newMode);
    });

    let hydrated = false;
    s.on("sceneInit", (scene) => {
      // Read share settings from the server's initial payload.
      if (scene?.shareMode) setShareMode(scene.shareMode);
      applyRemoteScene(scene);
      if (!hydrated) {
        hydrated = true;
        try {
          const raw = localStorage.getItem(`wb-draft-${whiteboardId}`);
          if (raw) {
            const draft = JSON.parse(raw);
            // Only restore the local draft if it's strictly NEWER than the
            // server snapshot (avoids resurrecting stale work after a sync).
            const serverTs = scene?.updatedAt || 0;
            const draftTs = draft?.t || 0;
            if (draft?.elements?.length && draftTs > serverTs && apiRef.current) {
              const merged = reconcileElements(
                apiRef.current.getSceneElementsIncludingDeleted(),
                draft.elements
              );
              isApplyingRemote.current = false;
              apiRef.current.updateScene({ elements: merged });
            } else {
              // Server is authoritative → drop the stale draft.
              localStorage.removeItem(`wb-draft-${whiteboardId}`);
            }
          }
        } catch {
          /* ignore bad draft */
        }
      }
    });
    s.on("sceneUpdate", applyRemoteScene);

    // Remote cursors + selections → Excalidraw collaborators Map.
    s.on("cursorUpdate", (p) => {
      const selectedElementIds = {};
      for (const id of p.selectedElementIds || []) selectedElementIds[id] = true;
      remoteCursors.current.set(p.socketId, {
        username: p.username,
        pointer: { x: p.x, y: p.y },
        button: p.button || "up",
        color: { background: p.color, stroke: p.color },
        selectedElementIds,
      });
      apiRef.current?.updateScene({
        collaborators: new Map(remoteCursors.current),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });
    s.on("cursorLeave", ({ socketId }) => {
      remoteCursors.current.delete(socketId);
      apiRef.current?.updateScene({
        collaborators: new Map(remoteCursors.current),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });

    // Presence avatar list.
    s.on("whiteboardUsers", (users) => setCollaborators(users || []));
  };  // end wireSocket

  // Cleanup timers and image cache on unmount / board change.
  useEffect(() => {
    const variants = imageVariants.current;
    return () => {
      clearTimeout(sceneTimer.current);
      clearTimeout(applyTimer.current);
      variants.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboardId]);

  // --- Local scene change → debounced broadcast (with echo guard) ---
  const handleChange = useCallback(
    (elements, appState, files) => {
      if (isApplyingRemote.current || !socket) return;
      clearTimeout(sceneTimer.current);
      sceneTimer.current = setTimeout(() => {
        // Emit including-deleted tombstones at flush time so deletions
        // propagate and stick (the merge keeps the higher version per id).
        const toSend = apiRef.current
          ? apiRef.current.getSceneElementsIncludingDeleted()
          : elements;
        socket.emit("sceneUpdate", {
          whiteboardId,
          elements: toSend,
          appState: { viewBackgroundColor: appState?.viewBackgroundColor },
          files: files || {},
        });
        // Autosave a local draft (best-effort) to survive a refresh/cold-nap
        // before the server confirms. Skipped if too large for localStorage.
        try {
          const draft = JSON.stringify({ t: Date.now(), elements: toSend });
          if (draft.length < 2_000_000) {
            localStorage.setItem(`wb-draft-${whiteboardId}`, draft);
          }
        } catch {
          /* quota / serialization — non-critical */
        }
      }, SCENE_DEBOUNCE_MS);
      // Keep image dark-mode correction in sync as files come/go.
      syncImageVariants();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [socket, whiteboardId, theme]
  );

  // Ensure each image file displays correctly for the current theme: cache the
  // original + a counter-inverted variant, and push the theme-appropriate one
  // (inverted in dark so Excalidraw's canvas invert cancels back to true color).
  const syncImageVariants = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const files = api.getFiles() || {};
    for (const [fileId, file] of Object.entries(files)) {
      if (!file?.dataURL) continue;
      let variant = imageVariants.current.get(fileId);
      if (!variant) {
        // First time we see this file: the current dataURL is the "original"
        // (unless it's already a remote-applied variant — best effort).
        variant = { original: file.dataURL, inverted: null };
        imageVariants.current.set(fileId, variant);
        variant.inverted = await counterInvertDataUrl(file.dataURL);
      }
      const want = theme === "dark" ? variant.inverted : variant.original;
      if (want && file.dataURL !== want) {
        isApplyingRemote.current = true;
        api.addFiles([{ ...file, dataURL: want }]);
        clearTimeout(applyTimer.current);
        applyTimer.current = setTimeout(() => (isApplyingRemote.current = false), 80);
      }
    }
  }, [theme]);

  // Re-apply the correct image variant whenever the theme changes.
  useEffect(() => {
    syncImageVariants();
  }, [theme, syncImageVariants]);

  // --- Local pointer → throttled cursor broadcast ---
  const handlePointer = useCallback(
    ({ pointer }) => {
      if (!socket || !pointer) return;
      const now = performance.now();
      if (now - cursorThrottle.current < CURSOR_THROTTLE_MS) return;
      cursorThrottle.current = now;
      // Include the current selection so peers can see what each user has
      // selected (Excalidraw renders collaborator selections natively).
      const sel = apiRef.current
        ? Object.keys(apiRef.current.getAppState().selectedElementIds || {})
        : [];
      socket.emit("cursorUpdate", {
        whiteboardId,
        socketId: socket.id,
        userId: me.userId,
        username: me.username,
        x: pointer.x,
        y: pointer.y,
        color: getColorForName(me.username),
        selectedElementIds: sel,
      });
    },
    [socket, whiteboardId, me]
  );

  // --- Board name (fetch + rename) ---
  useEffect(() => {
    if (isGuest) return;
    import("../../api/whiteboard").then(({ getWhiteboards, getBoardInfo }) => {
      if (isGuest) {
        getBoardInfo(whiteboardId).then((info) => {
          if (info?.name) setBoardName(info.name);
        });
      } else {
        getWhiteboards().then((boards) => {
          const found = Array.isArray(boards)
            ? boards.find((b) => b._id === whiteboardId)
            : null;
          if (found) setBoardName(found.name);
        });
      }
    });
  }, [whiteboardId, isGuest]);

  // Capture a thumbnail when leaving the board (unmount) and when the tab is
  // hidden/closed, so the dashboard card shows the last screen the user saw.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") captureRef.current?.();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      captureRef.current?.();
    };
  }, []);

  const commitName = async () => {
    if (isGuest) return;
    try {
      await updateWhiteboard(whiteboardId, boardName);
    } catch {
      /* non-owners can't rename; ignore */
    }
  };

  // --- Export ---
  const doExport = async (format) => {
    const api = apiRef.current;
    if (!api) return;
    const blob = await exportToBlob({
      elements: api.getSceneElements(),
      appState: api.getAppState(),
      files: api.getFiles(),
      mimeType: "image/png",
      exportPadding: 16,
    });
    if (format === "png") {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${boardName || "whiteboard"}.png`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    // PDF: embed the PNG into a jsPDF page sized to the image.
    const bitmap = await createImageBitmap(blob);
    const pdf = new jsPDF({
      orientation: bitmap.width >= bitmap.height ? "landscape" : "portrait",
      unit: "pt",
      format: [bitmap.width, bitmap.height],
    });
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, bitmap.width, bitmap.height);
    pdf.save(`${boardName || "whiteboard"}.pdf`);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  // Snapshot the current scene to a small PNG data URL and persist it as the
  // board's dashboard thumbnail ("last screen the user saw"). Best-effort,
  // guests skipped (they can't own boards).
  const captureThumbnail = async () => {
    const api = apiRef.current;
    if (!api || isGuest) return;
    const elements = api.getSceneElements();
    if (!elements.length) return;
    try {
      const blob = await exportToBlob({
        elements,
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        mimeType: "image/jpeg",
        quality: 0.6,
        exportPadding: 24,
        // Downscale: cap the longest side so the data URL stays small.
        getDimensions: (w, h) => {
          const max = 480;
          const scale = Math.min(1, max / Math.max(w, h));
          return { width: w * scale, height: h * scale, scale };
        },
      });
      const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
      if (typeof dataUrl === "string" && dataUrl.length < 200_000) {
        await saveThumbnail(whiteboardId, dataUrl);
      }
    } catch {
      /* non-critical */
    }
  };
  // Keep a ref so the unmount cleanup calls the latest version.
  const captureRef = useRef(captureThumbnail);
  captureRef.current = captureThumbnail;

  const clearCanvas = () => {
    const api = apiRef.current;
    if (!api) return;
    // Mark every element deleted (bump version) so the clear propagates and
    // sticks under the merge — replacing with [] would let peers resurrect them.
    const cleared = api.getSceneElementsIncludingDeleted().map((el) => ({
      ...el,
      isDeleted: true,
      version: (el.version ?? 0) + 1,
    }));
    api.updateScene({ elements: cleared });
  };

  // Zoom out / frame all content — the reliable "see everything" control,
  // especially useful on mobile where pinch-zoom-out is limited.
  const zoomToFit = () => {
    apiRef.current?.scrollToContent(undefined, { fitToViewport: true });
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  // Render the board to a downscaled image and send it for handwriting OCR;
  // the recognized text is added to this board's search index server-side.
  const extractTextNow = async () => {
    if (isGuest) return showToast("Sign in to use OCR text extraction.");
    const api = apiRef.current;
    if (!api) return;
    const els = api.getSceneElements();
    if (!els.length) return showToast("Nothing to extract yet.");
    showToast("Extracting text…");
    try {
      const blob = await exportToBlob({
        elements: els,
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        mimeType: "image/jpeg",
        quality: 0.85,
        getDimensions: (w, h) => {
          const max = 1600;
          const scale = Math.min(1, max / Math.max(w, h));
          return { width: w * scale, height: h * scale, scale };
        },
      });
      const dataUrl = await new Promise((res2) => {
        const r = new FileReader();
        r.onload = () => res2(r.result);
        r.readAsDataURL(blob);
      });
      const result = await extractText(whiteboardId, dataUrl);
      if (result.error) return showToast(result.error);
      if (!result.words) return showToast("No text detected.");
      setOcrResult(result.text);
    } catch {
      showToast("Couldn't extract text. Try again.");
    }
  };

  const sharePanelRef = useRef(null);

  // Close share panel on outside click only.
  useEffect(() => {
    if (!showSharePanel) return;
    const handler = (e) => {
      if (sharePanelRef.current && !sharePanelRef.current.contains(e.target)) {
        setShowSharePanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSharePanel]);

  // View-only mode: guests on a view-only board cannot draw.
  const isViewOnly = isGuest && shareMode === "view";

  // Owner toggles share mode (lock/unlock) — broadcasts to all peers via socket.
  const toggleShareMode = async () => {
    const next = shareMode === "edit" ? "view" : "edit";
    setShareMode(next);
    await updateShareSettings(whiteboardId, { shareMode: next });
    socket?.emit("shareModeChanged", { whiteboardId, shareMode: next });
  };

  const saveShareAccess = async (next) => {
    setShareAccess(next);
    await updateShareSettings(whiteboardId, { shareAccess: next });
  };

  const btn =
    "inline-flex items-center justify-center h-9 w-9 rounded-lg text-[var(--surface-muted)] hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-600/15 transition-colors";

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[var(--surface-bg)]">
      {/* Top bar */}
      <header className="z-10 flex shrink-0 items-center gap-1.5 border-b border-[var(--surface-border)] bg-[var(--surface-card)] px-2 py-2 sm:gap-2 sm:px-3">
        <button
          onClick={() => navigate("/whiteboards")}
          className={btn}
          title="Back to Whitebored"
        >
          <ArrowLeft size={18} />
        </button>
        <div
          className="hidden h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white sm:inline-flex"
          title="Whitebored"
        >
          W
        </div>

        <input
          value={boardName}
          onChange={(e) => setBoardName(e.target.value)}
          onBlur={commitName}
          disabled={isGuest}
          className="w-28 max-w-[220px] rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-[var(--surface-text)] outline-none focus:bg-brand-50 sm:w-auto dark:focus:bg-brand-600/10 disabled:opacity-70"
          title={isGuest ? "Sign in to rename" : "Rename board"}
        />

        {isGuest && (
          <a
            href={`/login?returnTo=${encodeURIComponent(window.location.pathname)}`}
            className="flex flex-col items-center rounded-md bg-accent-500/15 px-2.5 py-0.5 text-accent-600 hover:bg-accent-500/25 transition-colors leading-tight"
            title="Sign in for full access"
          >
            <span className="text-[9px] font-medium opacity-70">limited capabilities</span>
            <span className="text-xs font-semibold">Guest</span>
          </a>
        )}

        <div className="flex-1" />

        {/* Presence avatars (deduped by userId, defensive against dup sockets) */}
        <div className="mr-1 flex -space-x-2">
          {[...new Map(collaborators.map((u) => [u.userId, u])).values()]
            .slice(0, 5)
            .map((u) => (
              <div
                key={u.userId}
                title={u.username}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--surface-card)] text-[11px] font-semibold text-white"
                style={{ background: getColorForName(u.username) }}
              >
                {getInitials(u.username)}
              </div>
            ))}
        </div>

<button onClick={() => setOpenPanel(openPanel === "comments" ? null : "comments")} className={btn} title="Comments">
          <MessageSquare size={18} />
        </button>
        <button onClick={() => setOpenPanel(openPanel === "chat" ? null : "chat")} className={btn} title="Chat">
          <MessagesSquare size={18} />
        </button>

        {/* Share / copy link — opens share popup for owners, just copies for guests */}
        <div className="relative">
          <button
            onClick={() => !isGuest ? setShowSharePanel((v) => !v) : copyLink()}
            className={`${btn} ${showSharePanel ? "bg-brand-50 text-brand-600 dark:bg-brand-600/15" : ""}`}
            title={isGuest ? "Copy shareable link" : "Share & copy link"}
          >
            {copied ? <Check size={18} className="text-green-500" /> : <Link2 size={18} />}
          </button>

          {showSharePanel && !isGuest && (
            <div
              ref={sharePanelRef}
              className="absolute right-0 top-11 z-40 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-4 shadow-xl"
              style={{ width: 272 }}
            >
              <p className="mb-3 text-sm font-semibold text-[var(--surface-text)]">Share board</p>

              {/* shareMode toggle */}
              <div className="mb-3">
                <p className="mb-1.5 text-xs font-medium text-[var(--surface-muted)]">Guests can</p>
                <div className="flex overflow-hidden rounded-lg border border-[var(--surface-border)]">
                  {[["edit", "Edit"], ["view", "View only"]].map(([m, label]) => (
                    <button
                      key={m}
                      onClick={() => { setShareMode(m); updateShareSettings(whiteboardId, { shareMode: m }); socket?.emit("shareModeChanged", { whiteboardId, shareMode: m }); }}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${shareMode === m ? "bg-brand-600 text-white" : "text-[var(--surface-muted)] hover:bg-[var(--surface-border)]"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* shareAccess toggle */}
              <div className="mb-4">
                <p className="mb-1.5 text-xs font-medium text-[var(--surface-muted)]">Who can access</p>
                <div className="flex overflow-hidden rounded-lg border border-[var(--surface-border)]">
                  {[["anyone", "Anyone with link"], ["auth", "Signed-in only"]].map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => saveShareAccess(v)}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${shareAccess === v ? "bg-brand-600 text-white" : "text-[var(--surface-muted)] hover:bg-[var(--surface-border)]"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Copy link */}
              <button
                onClick={() => { copyLink(); }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
              >
                <Link2 size={14} />
                {copied ? "Link copied!" : "Copy share link"}
              </button>
            </div>
          )}
        </div>
        <button
          onClick={togglePenMode}
          className={`${btn} ${penMode ? "bg-brand-600 text-white hover:bg-brand-700" : ""}`}
          title={penMode ? "Pen mode on (palm rejection active)" : "Enable pen mode (palm rejection)"}
        >
          <PenLine size={18} />
        </button>
        <button onClick={toggleTheme} className={btn} title="Toggle theme">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {!isGuest && <UserMenu />}
      </header>

      {/* Canvas */}
      <div className="relative flex-1">
        {disconnected && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-amber-500/95 px-3 py-1 text-xs font-medium text-white shadow-lg">
            Reconnecting…
          </div>
        )}
        {toast && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg bg-slate-900/95 px-4 py-2 text-sm font-medium text-white shadow-lg">
            {toast}
          </div>
        )}
        <Excalidraw
          excalidrawAPI={(api) => (apiRef.current = api)}
          theme={theme}
          gridModeEnabled={gridMode}
          viewModeEnabled={isViewOnly}
          onChange={handleChange}
          onPointerUpdate={handlePointer}
          initialData={{
            appState: {
              viewBackgroundColor: "#ffffff",
              penMode,
            },
          }}
          UIOptions={{
            canvasActions: {
              // One export path (our menu); hide Excalidraw's own save/load/export.
              export: false,
              saveToActiveFile: false,
              loadScene: false,
              toggleTheme: false,
            },
          }}
        >
          {/* Custom menu fully replaces the default — removes excalidraw.com
              promo/social links and consolidates our actions. */}
          <MainMenu>
            <MainMenu.Item onSelect={() => doExport("png")} icon={<FileImage size={16} />}>
              Export PNG
            </MainMenu.Item>
            <MainMenu.Item onSelect={() => doExport("pdf")} icon={<FileText size={16} />}>
              Export PDF
            </MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.Item onSelect={zoomToFit} icon={<Maximize size={16} />}>
              Zoom to fit
            </MainMenu.Item>
            <MainMenu.Item onSelect={extractTextNow} icon={<ScanText size={16} />}>
              Extract text (OCR)
            </MainMenu.Item>
            <MainMenu.Item onSelect={toggleGrid} icon={<Grid3x3 size={16} />}>
              {gridMode ? "Hide grid" : "Show grid"}
            </MainMenu.Item>
            <MainMenu.Item onSelect={clearCanvas} icon={<Trash2 size={16} />}>
              Clear canvas
            </MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.Item
              onSelect={() => navigate("/whiteboards")}
              icon={<ArrowLeft size={16} />}
            >
              Back to dashboard
            </MainMenu.Item>
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        </Excalidraw>

        <Minimap apiRef={apiRef} />

        {openPanel === "comments" && (
          <CommentsSidebar
            whiteboardId={whiteboardId}
            socket={socket}
            open
            onClose={() => setOpenPanel(null)}
            currentUserId={me.userId}
          />
        )}
        {openPanel === "chat" && (
          <ChatBox
            socket={socket}
            userId={me.userId}
            whiteboardId={whiteboardId}
            username={me.username}
            onClose={() => setOpenPanel(null)}
          />
        )}
      </div>

      {/* OCR result modal */}
      {ocrResult !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { setOcrResult(null); setOcrCopied(false); }}
        >
          <div
            className="relative flex w-full max-w-lg flex-col rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--surface-border)] px-5 py-3">
              <span className="font-semibold text-[var(--surface-text)]">Extracted Text</span>
              <button
                onClick={() => { setOcrResult(null); setOcrCopied(false); }}
                className="rounded-lg p-1 text-[var(--surface-muted)] hover:bg-[var(--surface-border)] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 text-sm text-[var(--surface-text)] font-sans leading-relaxed">
              {ocrResult}
            </pre>
            <div className="flex justify-end border-t border-[var(--surface-border)] px-5 py-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(ocrResult);
                  setOcrCopied(true);
                  setTimeout(() => setOcrCopied(false), 2000);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
              >
                {ocrCopied ? "Copied!" : "Copy all"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
