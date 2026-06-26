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
  LogIn,
} from "lucide-react";

import { SOCKET_BASE } from "../../api/config";
import { updateWhiteboard, saveThumbnail, extractText, updateShareSettings, getCollaborators } from "../../api/whiteboard";
import { useTheme } from "../../theme/ThemeContext";
import { getColorForName, getInitials } from "../../utils/userColor";
import CommentsSidebar from "./CommentsSidebar";
import ChatBox from "../Chatbox";
import Minimap from "./Minimap";
import UserMenu from "../UserMenu";
import SharePanel from "./SharePanel";

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
  const [ownerId, setOwnerId] = useState(null);
  const [boardCollaborators, setBoardCollaborators] = useState([]);
  const [followedSocketId, setFollowedSocketId] = useState(null);
  const followedSocketIdRef = useRef(null);
  followedSocketIdRef.current = followedSocketId;

  const [gridMode, setGridMode] = useState(
    () => localStorage.getItem("wb-grid") === "1"
  );
  const toggleGrid = () =>
    setGridMode((v) => {
      localStorage.setItem("wb-grid", v ? "0" : "1");
      return !v;
    });

  const apiRef = useRef(null); // excalidrawAPI
  // Always-current socket so emit callbacks never close over a null/stale socket
  // (the `socket` state is null on the first renders — refs avoid dropped emits).
  const socketRef = useRef(null);
  const isApplyingRemote = useRef(false);
  const sceneTimer = useRef(null);
  const applyTimer = useRef(null);
  const cursorThrottle = useRef(0);
  const remoteCursors = useRef(new Map()); // socketId -> collaborator pointer

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

  // Always-current ref so socket callbacks (wired once) never close over a stale me.
  const meRef = useRef(me);
  meRef.current = me;

  // --- Socket lifecycle ---
  // BetterAuth uses cookies — Socket.IO sends them automatically via withCredentials.
  useEffect(() => {
    const s = io(SOCKET_BASE, { withCredentials: true });
    socketRef.current = s;
    setSocket(s);
    wireSocket(s);
    return () => {
      // Explicit leave so peers drop our avatar immediately (don't wait for the
      // ping timeout). Then disconnect.
      try { s.emit("leaveWhiteboard", whiteboardId); } catch { /* ignore */ }
      socketRef.current = null;
      s?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboardId]);

  // Extracted socket event wiring so it can be called after token is ready.
  const wireSocket = (s) => {
    setSocket(s);

    // Fires on first connect AND every reconnect — re-join the room. We do NOT
    // announce presence here: the server only joins the room after an async
    // access check, and it silently drops presence/scene events for a room the
    // socket hasn't joined yet. Presence is announced from `sceneInit` instead,
    // which the server emits only AFTER the join succeeds (see below).
    s.on("connect", () => {
      setDisconnected(false);
      s.emit("joinWhiteboard", whiteboardId);
    });
    s.on("disconnect", () => {
      setDisconnected(true);
      // Drop any remote cursors so this user's own view doesn't keep stale ones.
      remoteCursors.current.clear();
      apiRef.current?.updateScene({
        collaborators: new Map(),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });
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
      // The room is now joined server-side (sceneInit is emitted only after a
      // successful join), so it's safe to announce presence. Fires on initial
      // join AND every reconnect, so peers always see our avatar promptly.
      s.emit("presence", {
        whiteboardId,
        userId: meRef.current.userId,
        username: meRef.current.username,
      });
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
        // Store viewport so follow-camera can apply it.
        scrollX: p.scrollX,
        scrollY: p.scrollY,
        zoom: p.zoom,
      });
      apiRef.current?.updateScene({
        collaborators: new Map(remoteCursors.current),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      // Follow-camera: if we're following this socket, apply their viewport.
      if (followedSocketIdRef.current === p.socketId && apiRef.current &&
          p.scrollX != null && p.scrollY != null && p.zoom != null) {
        apiRef.current.updateScene({
          appState: {
            scrollX: p.scrollX,
            scrollY: p.scrollY,
            zoom: { value: p.zoom },
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    });
    s.on("cursorLeave", ({ socketId }) => {
      remoteCursors.current.delete(socketId);
      apiRef.current?.updateScene({
        collaborators: new Map(remoteCursors.current),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      // Stop following if the user we were following disconnected.
      if (followedSocketIdRef.current === socketId) {
        setFollowedSocketId(null);
        apiRef.current?.updateScene({
          appState: { userToFollow: null },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    });

    // Presence avatar list.
    s.on("whiteboardUsers", (users) => setCollaborators(users || []));
  };  // end wireSocket

  // Cleanup timers on unmount / board change.
  useEffect(() => {
    return () => {
      clearTimeout(sceneTimer.current);
      clearTimeout(applyTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboardId]);

  // --- Local scene change → debounced broadcast (with echo guard) ---
  const handleChange = useCallback(
    (elements, appState, files) => {
      if (isApplyingRemote.current || !socketRef.current) return;
      clearTimeout(sceneTimer.current);
      sceneTimer.current = setTimeout(() => {
        const s = socketRef.current;
        if (!s) return;
        // Emit including-deleted tombstones at flush time so deletions
        // propagate and stick (the merge keeps the higher version per id).
        const toSend = apiRef.current
          ? apiRef.current.getSceneElementsIncludingDeleted()
          : elements;
        s.emit("sceneUpdate", {
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whiteboardId]
  );

  // --- Local pointer → throttled cursor broadcast ---
  const handlePointer = useCallback(
    ({ pointer }) => {
      const s = socketRef.current;
      if (!s || !pointer) return;
      const now = performance.now();
      if (now - cursorThrottle.current < CURSOR_THROTTLE_MS) return;
      cursorThrottle.current = now;
      const appState = apiRef.current?.getAppState();
      const sel = appState ? Object.keys(appState.selectedElementIds || {}) : [];
      s.emit("cursorUpdate", {
        whiteboardId,
        socketId: s.id,
        userId: meRef.current.userId,
        username: meRef.current.username,
        x: pointer.x,
        y: pointer.y,
        color: getColorForName(meRef.current.username),
        selectedElementIds: sel,
        scrollX: appState?.scrollX,
        scrollY: appState?.scrollY,
        zoom: appState?.zoom?.value,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whiteboardId]
  );

  // --- Board name + share settings (fetch on mount) ---
  useEffect(() => {
    import("../../api/whiteboard").then(({ getWhiteboards, getBoardInfo }) => {
      // getBoardInfo is public (no auth required) and returns name, shareMode,
      // shareAccess, and ownerId — use it for everyone to populate share state.
      getBoardInfo(whiteboardId).then((info) => {
        if (info?.name) setBoardName(info.name);
        if (info?.shareMode) setShareMode(info.shareMode);
        if (info?.shareAccess) setShareAccess(info.shareAccess);
        if (info?.ownerId) setOwnerId(info.ownerId);
      });
      // Owners get an authoritative name from their board list (handles renaming).
      if (!isGuest) {
        getWhiteboards().then((boards) => {
          const found = Array.isArray(boards)
            ? boards.find((b) => b._id === whiteboardId)
            : null;
          if (found?.name) setBoardName(found.name);
        });
      }
    });
  }, [whiteboardId, isGuest]);

  // Capture a thumbnail when leaving the board (unmount) and when the tab is
  // hidden/closed, so the dashboard card shows the last screen the user saw.
  // Also announce departure so peers drop our avatar without waiting for the
  // socket ping timeout. `pagehide` is more reliable than `beforeunload` for
  // mobile Safari / bfcache and fires on hard tab-close where unmount won't run.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") captureRef.current?.();
    };
    const onPageHide = () => {
      try { socketRef.current?.emit("leaveWhiteboard", whiteboardId); } catch { /* ignore */ }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      captureRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboardId]);

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
    if (!api || isGuest || !isOwner) return;
    const elements = api.getSceneElements();
    if (!elements.length) return;
    try {
      const blob = await exportToBlob({
        elements,
        // Force a light-themed export so a dark-mode owner still produces a
        // normal light thumbnail that's consistent for everyone on the dashboard.
        appState: { ...api.getAppState(), exportBackground: true, theme: "light", viewBackgroundColor: "#ffffff" },
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

  // isOwner: current user is the board owner (ownerId set from getBoardInfo).
  const isOwner = !isGuest && !!ownerId && me.userId === ownerId;

  // View-only: anyone who isn't the owner and the board is set to view-only.
  // Defer until ownerId resolves (isGuest users have no ownerId to wait for).
  const isViewOnly = shareMode === "view" && (isGuest ? true : !!ownerId && !isOwner);

  // Load explicit collaborators when the owner opens the share panel.
  useEffect(() => {
    if (!showSharePanel || !isOwner) return;
    getCollaborators(whiteboardId)
      .then((data) => setBoardCollaborators(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [showSharePanel, isOwner, whiteboardId]);

  const saveShareAccess = async (next) => {
    try {
      await updateShareSettings(whiteboardId, { shareAccess: next });
      setShareAccess(next);
    } catch {
      showToast("Couldn't update share settings.");
    }
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

        <div className="flex-1" />

        {/* Presence avatars (deduped by userId, exclude self, clickable to follow camera) */}
        <div className="mr-1 flex -space-x-2">
          {[...new Map(collaborators.map((u) => [u.userId, u])).values()]
            .filter((u) => u.userId !== me.userId)
            .slice(0, 5)
            .map((u) => {
              const isFollowing = followedSocketId === u.socketId;
              return (
                <div
                  key={u.userId}
                  title={isFollowing ? `Following ${u.username} — click to unfollow` : `Follow ${u.username}'s camera`}
                  onClick={() => {
                    const api = apiRef.current;
                    if (!api) return;
                    const next = isFollowing ? null : u.socketId;
                    setFollowedSocketId(next);
                    api.updateScene({
                      appState: { userToFollow: next ? { socketId: u.socketId, username: u.username } : null },
                      captureUpdate: CaptureUpdateAction.NEVER,
                    });
                  }}
                  className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 text-[11px] font-semibold text-white transition-all ${
                    isFollowing
                      ? "border-brand-400 ring-2 ring-brand-400"
                      : "border-[var(--surface-card)] hover:border-brand-400"
                  }`}
                  style={{ background: getColorForName(u.username) }}
                >
                  {getInitials(u.username)}
                </div>
              );
            })}
        </div>

        {isGuest && (
          <a
            href={`/login?returnTo=${encodeURIComponent(window.location.pathname)}`}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition-colors"
            title="Sign in"
          >
            <LogIn size={14} />
            <span className="hidden sm:inline">Login</span>
          </a>
        )}

        <button onClick={() => setOpenPanel(openPanel === "comments" ? null : "comments")} className={btn} title="Comments">
          <MessageSquare size={18} />
        </button>
        <button onClick={() => setOpenPanel(openPanel === "chat" ? null : "chat")} className={btn} title="Chat">
          <MessagesSquare size={18} />
        </button>

        {/* Share / copy link — opens share popup for signed-in users, just copies for guests */}
        <div className="relative">
          <button
            onClick={() => !isGuest ? setShowSharePanel((v) => !v) : copyLink()}
            className={`${btn} ${showSharePanel ? "bg-brand-50 text-brand-600 dark:bg-brand-600/15" : ""}`}
            title={isGuest ? "Copy shareable link" : "Share & copy link"}
          >
            {copied ? <Check size={18} className="text-green-500" /> : <Link2 size={18} />}
          </button>

          {showSharePanel && !isGuest && (
            <SharePanel
              ref={sharePanelRef}
              whiteboardId={whiteboardId}
              shareMode={shareMode}
              shareAccess={shareAccess}
              boardCollaborators={boardCollaborators}
              setBoardCollaborators={setBoardCollaborators}
              isOwner={isOwner}
              ownerName={isOwner ? me.username : ""}
              currentUserId={me.userId}
              onShareModeChange={(m) => {
                updateShareSettings(whiteboardId, { shareMode: m })
                  .then(() => { setShareMode(m); socket?.emit("shareModeChanged", { whiteboardId, shareMode: m }); })
                  .catch(() => showToast("Couldn't update share settings."));
              }}
              onShareAccessChange={saveShareAccess}
              onClose={() => setShowSharePanel(false)}
              onCopyLink={copyLink}
              copied={copied}
            />
          )}
        </div>
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
          onUserFollow={(payload) => {
            if (payload.action === "UNFOLLOW") {
              setFollowedSocketId(null);
            } else {
              setFollowedSocketId(payload.userToFollow.socketId);
            }
          }}
          initialData={{
            appState: {
              viewBackgroundColor: "#ffffff",
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
