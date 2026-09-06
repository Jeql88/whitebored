import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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
  Sparkles,
  Link2,
  Check,
  Sun,
  Moon,
  Grid3x3,
  FileImage,
  FileText,
  NotebookPen,
  GraduationCap,
  Trash2,
  Maximize,
  ScanText,
  X,
  LogIn,
} from "lucide-react";

import { SOCKET_BASE } from "../../api/config";
import {
  updateWhiteboard,
  saveThumbnail,
  extractText,
  updateShareSettings,
  getCollaborators,
  getBoardDocuments,
  getBoardDocument,
  uploadBoardDocument,
  deleteBoardDocument,
  boardDocumentRawUrl,
  generateBoardCards,
  getFactCheck,
  runFactCheck,
  setFactCheckFlagStatus,
  getCoverage,
  runCoverage,
  getScope,
  saveScope,
  transcribeBoard,
  getTranscription,
  saveTranscription,
} from "../../api/whiteboard";
import { useTheme } from "../../theme/ThemeContext";
import { getColorForName, getInitials } from "../../utils/userColor";
import CommentsSidebar from "./CommentsSidebar";
import ChatPanel from "./ChatPanel";
import { addToNotesPayload } from "../../utils/addToNotes";
import { extractPdfPageTexts, hasTextLayer } from "../../utils/pdfText";
import { buildBoardCrops } from "../../utils/boardCrops";
import StudioSidebar from "./StudioSidebar";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, toggleTheme } = useTheme();

  const [boardName, setBoardName] = useState("Untitled");
  const [collaborators, setCollaborators] = useState([]); // presence avatars
  const [openPanel, setOpenPanel] = useState(null); // 'comments' | 'room' | 'aichat' | null
  const [aiChat, setAiChat] = useState([]); // AI "Chat" tab transcript (slice #13)

  // Sketch-to-Notes pipeline state. The transcription is the OCR text the user has
  // reviewed; notes stream in line-by-line over the socket and are the artifact the
  // rest of the pipeline (cards, coverage, fact-check) reads.
  const [notesLines, setNotesLines] = useState([]);
  // The prompt framing notes are written with. The type picker was removed from
  // the panel (one action, not a form to fill in first); lecture is the sensible
  // default for turning a board into notes.
  const [noteType] = useState("lecture");
  const [notesBusy, setNotesBusy] = useState(false);
  // The phase-1 artifact under review. Notes are gated behind confirming it
  // (D3): Phase 2 runs on corrected text, never on the raw read.
  const [transcript, setTranscript] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptConfirmed, setTranscriptConfirmed] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [activePage, setActivePage] = useState(1);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Which tool the single sidebar is showing, and the state each one reads.
  const [studioTab, setStudioTab] = useState("notes");
  const [factCheckFlags, setFactCheckFlags] = useState([]);
  const [coverageReport, setCoverageReport] = useState(null);
  const [scope, setScope] = useState({
    source: "notes",
    range: { kind: "all" },
    count: 10,
    difficulty: "mixed",
    format: "flashcards",
  });
  const [scopeDiff, setScopeDiff] = useState(null);

  // The sidebar overlays as a sheet on narrow screens and docks as a column on
  // wide ones (D22). Tracking it here means the canvas reflows once, on resize.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1024
  );
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [aiPending, setAiPending] = useState(false);
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

  // AI "Chat" tab (slice #13, D10/D11): listen for provenance-tagged replies from the
  // server's AI-chat channel. Each reply's message carries its verified source tag
  // (from your board / from a doc / general knowledge); the panel just renders it.
  useEffect(() => {
    if (!socket) return;
    const onReply = ({ boardId, message }) => {
      if (boardId !== whiteboardId || !message) return;
      setAiPending(false);
      setAiChat((prev) => [...prev, message]);
    };
    const onError = ({ boardId }) => {
      if (boardId && boardId !== whiteboardId) return;
      setAiPending(false);
      setAiChat((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Sorry — I couldn't answer that just now.",
          source: { bucket: "general", label: "general knowledge", addableToNotes: false },
        },
      ]);
    };
    socket.on("aiChatReply", onReply);
    socket.on("aiChatError", onError);
    return () => {
      socket.off("aiChatReply", onReply);
      socket.off("aiChatError", onError);
    };
  }, [socket, whiteboardId]);

  const sendAiChat = useCallback(
    (text) => {
      const s = socketRef.current;
      if (!s || !text?.trim()) return;
      setAiChat((prev) => [...prev, { role: "user", text }]);
      setAiPending(true);
      s.emit("aiChatMessage", { boardId: whiteboardId, text });
    },
    [whiteboardId]
  );

  // Notes stream in line-by-line (D9): each line has already passed the server's
  // local key-terms check, so nothing here flickers or gets retracted. notesDone
  // carries the persisted record, which is also what a reload restores from.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onLine = ({ boardId, line }) => {
      if (boardId !== whiteboardId) return;
      // notesLines is a plain array of lines, not a notes artifact — appending
      // directly. (appendLine() takes a whole { lines } artifact; passing an array
      // to it spread `undefined` and threw "t.lines is not iterable".)
      if (!line || typeof line.text !== "string" || !line.text.trim()) return;
      setNotesLines((prev) => [...prev, line]);
    };
    const onDone = ({ boardId, record }) => {
      if (boardId !== whiteboardId) return;
      setNotesLines(record?.lines || []);
      setNotesBusy(false);

      // Notes exist, so check them against any attached source and work out what
      // the source covers that the board does not. Both used to be their own tab
      // and their own button; neither is a place the user should have to go. Both
      // return empty when no document is attached, so this is free in that case
      // and never blocks the notes that just arrived.
      runFactCheck(whiteboardId)
        .then((r) => setFactCheckFlags(r?.flags || []))
        .catch(() => {});
      runCoverage(whiteboardId)
        .then((r) => setCoverageReport(r?.report || null))
        .catch(() => {});
    };
    const onErr = ({ boardId }) => {
      if (boardId !== whiteboardId) return;
      setNotesBusy(false);
      showToast("Couldn't generate notes. Try again.");
    };

    socket.on("notesLine", onLine);
    socket.on("notesDone", onDone);
    socket.on("notesError", onErr);
    return () => {
      socket.off("notesLine", onLine);
      socket.off("notesDone", onDone);
      socket.off("notesError", onErr);
    };
  }, [whiteboardId]);

  // Phase 2 (D3): notes generate ONLY from a confirmed artifact. Taking it as an
  // argument means the confirm handler can pass the freshly corrected version
  // without waiting for a state round-trip.
  const generateNotesFrom = useCallback(
    (artifact) => {
      const socket = socketRef.current;
      if (!socket || !artifact) return;
      setNotesLines([]);
      setNotesBusy(true);
      socket.emit("generateNotes", { boardId: whiteboardId, transcription: artifact, noteType });
    },
    [whiteboardId, noteType]
  );

  // ONE action, whole pipeline (D3 preserved). Reading the board and writing notes
  // used to be two deliberate steps with a mandatory review between them, so the
  // shortest path to notes was four clicks. It is now a single "Generate notes":
  // read → if the AI was sure of everything, go straight to notes; if it was NOT,
  // stop and show the review so the user fixes the gaps first.
  //
  // That keeps D3's actual guarantee — notes are never written from text the user
  // has not had the chance to correct — while only charging them the review step
  // when there is genuinely something to correct.
  const readBoard = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return null;
    const els = api.getSceneElements();
    if (!els.length) {
      showToast("Nothing on the board to read yet.");
      return null;
    }

    const crops = await buildBoardCrops(els, api.getFiles());
    if (!crops.length) {
      showToast("Nothing readable found on the board.");
      return null;
    }
    const result = await transcribeBoard(whiteboardId, crops);
    if (result?.error) {
      showToast(result.reason || result.error);
      return null;
    }
    return result.artifact;
  }, [whiteboardId]);

  const generateNotes = useCallback(async () => {
    if (notesBusy || transcribing) return;
    setTranscribing(true);
    showToast("Reading your board…");
    try {
      const artifact = await readBoard();
      if (!artifact) return;

      setTranscript(artifact);

      if (artifact.hasUnclear) {
        // Some words could not be read. Stop here — writing notes from guesses is
        // exactly what the review step exists to prevent.
        setTranscriptConfirmed(false);
        showToast("Some words were unclear — fill them in, then notes will generate.");
        return;
      }

      // Clean read: skip straight to notes.
      setTranscriptConfirmed(true);
      generateNotesFrom(artifact);
    } catch {
      showToast("Couldn't read the board. Try again.");
    } finally {
      setTranscribing(false);
    }
    // generateNotesFrom is declared below; it only closes over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readBoard, notesBusy, transcribing]);

  // Re-read a board that has changed since the last read.
  const rereadBoard = useCallback(async () => {
    setTranscript(null);
    setTranscriptConfirmed(false);
    setNotesLines([]);
    await generateNotes();
  }, [generateNotes]);

  // Persist each correction as it happens, so a reload does not lose the user's
  // fixes and Phase 2 always reads the corrected artifact.
  const correctTranscript = useCallback(
    (artifact) => {
      setTranscript(artifact);
      saveTranscription(whiteboardId, artifact).catch(() => {});
    },
    [whiteboardId]
  );

  // Confirming the gaps continues straight into notes — the user asked for notes,
  // the review was an interruption, so finishing it should not need a second click.
  const confirmTranscript = useCallback(
    (artifact) => {
      setTranscript(artifact);
      setTranscriptConfirmed(true);
      saveTranscription(whiteboardId, artifact).catch(() => {});
      generateNotesFrom(artifact);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whiteboardId]
  );

  // Regenerate over the EXISTING notes (D7): the server reconciles fresh output
  // against what is stored, so a line the user edited survives and a line whose
  // shapes were deleted retires. Distinct from a plain re-generate, which would
  // discard those edits.
  const regenerateNotes = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (!transcript || !transcriptConfirmed) {
      return showToast("Read the board and confirm the transcription first.");
    }
    const api = apiRef.current;
    setNotesBusy(true);
    setNotesLines([]);
    socket.emit("regenerateNotes", {
      boardId: whiteboardId,
      transcription: transcript,
      noteType,
      boardElementIds: api ? api.getSceneElements().map((el) => el.id) : [],
    });
  }, [whiteboardId, transcript, transcriptConfirmed, noteType]);

  // Click a note line → highlight the shapes it came from (story 9). The editor
  // already scrolls-to-content elsewhere; this reuses the same Excalidraw API.
  const highlightSources = useCallback((sourceElementIds) => {
    const api = apiRef.current;
    if (!api || !sourceElementIds?.length) return;
    const ids = new Set(sourceElementIds);
    const targets = api.getSceneElements().filter((el) => ids.has(el.id));
    if (!targets.length) return showToast("Those shapes are no longer on the board.");
    api.scrollToContent(targets, { fitToContent: true, animate: true });
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries([...ids].map((id) => [id, true])) } });
  }, []);

  // Move a chat answer into the notes artifact (slice #14, D11/D12). The payload
  // carries the answer's provenance so the stored line keeps it: a board answer
  // becomes a chat-origin line with its shapes, a document answer an
  // origin=document line with its citation. General knowledge never reaches here
  // — ChatPanel shows no button for it and the helper refuses it anyway (story 19).
  const addAiAnswerToNotes = useCallback(
    (message) => {
      const payload = addToNotesPayload(message);
      if (!payload) return;
      const s = socketRef.current;
      if (!s) return;
      s.emit("addChatToNotes", { boardId: whiteboardId, ...payload });
    },
    [whiteboardId]
  );

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

  // Excalidraw caches its canvas size, so when the docked sidebar opens or closes
  // the container changes width but the canvas does not — leaving pointer input
  // offset from the cursor. refresh() makes it re-measure. Deferred a frame so it
  // runs after the flex row has actually reflowed.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return undefined;
    const id = requestAnimationFrame(() => api.refresh());
    return () => cancelAnimationFrame(id);
  }, [openPanel, isNarrow]);

  // The study route links back as /whiteboard/:id?highlight=id1,id2 when the user
  // asks to see a card on the board (story 36). Consume it once the scene has
  // elements, then strip it from the URL so a refresh does not re-trigger.
  useEffect(() => {
    const raw = searchParams.get("highlight");
    if (!raw) return undefined;

    // The scene arrives asynchronously (Excalidraw mounts, then the socket or the
    // saved snapshot fills it), and there is no "scene ready" signal to hang this
    // on — so wait for elements to exist, then highlight once and give up after a
    // few seconds rather than polling forever on a board that is genuinely empty.
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      const api = apiRef.current;
      const ready = api && api.getSceneElements().length > 0;
      if (!ready && Date.now() < deadline) return;

      clearInterval(timer);
      if (ready) highlightSources(raw.split(",").filter(Boolean));
      const next = new URLSearchParams(searchParams);
      next.delete("highlight");
      setSearchParams(next, { replace: true });
    }, 200);

    return () => clearInterval(timer);
  }, [searchParams, setSearchParams, highlightSources]);

  // --- Documents (D13) ------------------------------------------------------

  const refreshDocuments = useCallback(async () => {
    try {
      setDocuments(await getBoardDocuments(whiteboardId));
    } catch {
      showToast("Couldn't load documents.");
    }
  }, [whiteboardId]);

  const openDocument = useCallback(
    async (docId) => {
      try {
        const doc = await getBoardDocument(whiteboardId, docId);
        setActiveDoc(doc);
        setActivePage(1);
      } catch {
        showToast("Couldn't open that document.");
      }
    },
    [whiteboardId]
  );

  // Upload a file. A PDF's per-page text is extracted in the BROWSER (D13 — the
  // server has no PDF infra); other kinds send their bytes and let the server
  // normalize. A PDF with no selectable text is refused by the server with a 422.
  const uploadDocument = useCallback(
    async (file) => {
      if (!file) return;
      setUploadingDoc(true);
      try {
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });

        const kind = file.type === "application/pdf" ? "pdf" : file.type.startsWith("image/") ? "image" : "text";
        const body = { kind, filename: file.name, contentType: file.type, data };
        if (kind === "text") body.text = await file.text();
        if (kind === "pdf") {
          // Page text is read in the browser (D13 — the server has no PDF infra).
          showToast("Reading PDF text…");
          body.pageTexts = await extractPdfPageTexts(file);
          // Catch a scan HERE rather than uploading megabytes the server will
          // refuse: the user gets the real reason instead of a generic 422.
          if (!hasTextLayer(body.pageTexts)) {
            return showToast("That PDF has no selectable text (it looks scanned), so it can't be searched yet.");
          }
        }

        const summary = await uploadBoardDocument(whiteboardId, body);
        if (summary?.error) return showToast(summary.error);
        await refreshDocuments();
        showToast(`Added ${file.name}.`);
      } catch {
        showToast("Couldn't upload that file.");
      } finally {
        setUploadingDoc(false);
      }
    },
    [whiteboardId, refreshDocuments]
  );

  const removeDocument = useCallback(
    async (docId) => {
      try {
        await deleteBoardDocument(whiteboardId, docId);
        if (activeDoc && activeDoc.docId === docId) setActiveDoc(null);
        await refreshDocuments();
      } catch {
        showToast("Couldn't delete that document.");
      }
    },
    [whiteboardId, activeDoc, refreshDocuments]
  );

  // The topics a source covers that the board does not (D16). Surfaced at the end
  // of the notes, never auto-added.
  const coverageGaps = useMemo(
    () => (coverageReport?.topics || []).filter((t) => t.status === "gap"),
    [coverageReport]
  );

  // --- Fact-check, coverage, scope ------------------------------------------

  // Restore a stored transcription so a reload returns to where the user was —
  // re-reading the board would cost another model call. An artifact with no gaps
  // left is treated as already reviewed.
  useEffect(() => {
    if (isGuest) return undefined;
    let cancelled = false;
    getTranscription(whiteboardId)
      .then((r) => {
        if (cancelled || !r?.artifact) return;
        setTranscript(r.artifact);
        setTranscriptConfirmed(!r.artifact.hasUnclear);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [whiteboardId, isGuest]);

  // Scope persists per board (D19), so restore it rather than resetting the bar
  // to defaults on every reload.
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    getScope(whiteboardId)
      .then((saved) => {
        if (!cancelled && saved && !saved.error) setScope(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [whiteboardId, isGuest]);

  // Pull whatever the last passes stored when the sidebar opens, so the tabs show
  // prior results immediately instead of looking empty until a re-run.
  useEffect(() => {
    if (openPanel !== "studio" || isGuest) return;
    getFactCheck(whiteboardId)
      .then((r) => setFactCheckFlags(r?.flags || []))
      .catch(() => {});
    getCoverage(whiteboardId)
      .then((r) => setCoverageReport(r?.report || null))
      .catch(() => {});
  }, [openPanel, whiteboardId, isGuest]);

  // Persist scope whenever it settles, so the bar restores what the user left.
  const updateScope = useCallback(
    (next) => {
      setScope(next);
      setScopeDiff(null);
      saveScope(whiteboardId, next).catch(() => {});
    },
    [whiteboardId]
  );

  // Jump the Documents tab to a citation's page. Both fact-check flags and
  // coverage gaps cite {docId, page}, so one handler serves both.
  const jumpToCitation = useCallback(
    async (citation) => {
      if (!citation?.docId) return;
      setStudioTab("documents");
      if (!activeDoc || activeDoc.docId !== citation.docId) {
        await openDocument(citation.docId);
      }
      if (Number.isInteger(citation.page)) setActivePage(citation.page);
    },
    [activeDoc, openDocument]
  );

  // Accept a flag: the server never auto-edits notes, so accepting only records
  // the decision and (when it offers one) surfaces a suggested line edit.
  const acceptFlag = useCallback(
    (flag) => {
      setFactCheckFlags((prev) =>
        prev.map((f) => (f.id === flag.id ? { ...f, status: "accepted" } : f))
      );
      setFactCheckFlagStatus(whiteboardId, flag.id, "accepted").catch(() => {});
    },
    [whiteboardId]
  );

  // Dismissals persist server-side across regeneration; locally we just drop it
  // from the open list so the user is not re-nagged in this session.
  const dismissFlag = useCallback(
    (flag) => {
      setFactCheckFlags((prev) =>
        prev.map((f) => (f.id === flag.id ? { ...f, status: "dismissed" } : f))
      );
      // The dismissal must reach the server: that is what keeps it dismissed
      // across the next regeneration.
      setFactCheckFlagStatus(whiteboardId, flag.id, "dismissed").catch(() => {});
    },
    [whiteboardId]
  );

  const confirmScopeRange = useCallback(() => {
    setScope((prev) => {
      const next = { ...prev, range: { ...prev.range, confirmed: true } };
      saveScope(whiteboardId, next).catch(() => {});
      return next;
    });
    setScopeDiff(null);
  }, [whiteboardId]);

  // Generate study material for the current scope. Cards are built from the
  // board's notes server-side; regeneration keeps a reviewed card's schedule.
  const generateStudy = useCallback(async () => {
    if (!notesLines.length) {
      return showToast("Generate notes first — cards are built from them.");
    }
    showToast("Building your deck…");
    try {
      const api = apiRef.current;
      const boardElementIds = api ? api.getSceneElements().map((el) => el.id) : [];
      const result = await generateBoardCards(whiteboardId, {
        deck: scope.source === "documents" ? "document" : "notes",
        boardElementIds,
      });
      if (result?.error) return showToast(result.error);
      showToast(`Made ${result.cards?.length ?? 0} cards. Open Study to review them.`);
    } catch {
      showToast("Couldn't build the deck. Try again.");
    }
  }, [whiteboardId, notesLines.length, scope.source]);

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
        <button
          onClick={() => setOpenPanel(openPanel === "studio" ? null : "studio")}
          className={`${btn} ${openPanel === "studio" ? "bg-brand-50 text-brand-600 dark:bg-brand-600/15" : ""}`}
          title="Study tools"
        >
          <Sparkles size={18} />
        </button>
        <button onClick={() => navigate(`/whiteboard/${whiteboardId}/study`)} className={btn} title="Study">
          <GraduationCap size={18} />
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

      {/* Canvas + docked tool column. A flex ROW so the docked sidebar is a real
          sibling and the canvas reflows around it, rather than the sidebar
          landing below the canvas in normal flow. */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
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

        </div>

        {openPanel === "comments" && (
          <CommentsSidebar
            whiteboardId={whiteboardId}
            socket={socket}
            open
            onClose={() => setOpenPanel(null)}
            currentUserId={me.userId}
          />
        )}
        {openPanel === "studio" && (
          <StudioSidebar
            variant={isNarrow ? "sheet" : "docked"}
            activeTab={studioTab}
            onTabChange={setStudioTab}
            onClose={() => setOpenPanel(null)}
            transcript={transcript}
            transcriptConfirmed={transcriptConfirmed}
            transcribing={transcribing}
            onReread={rereadBoard}
            onCorrectTranscript={correctTranscript}
            onConfirmTranscript={confirmTranscript}
            onGenerateNotes={generateNotes}
            onRegenerateNotes={regenerateNotes}
            notesLines={notesLines}
            notesBusy={notesBusy}
            onHighlight={highlightSources}
            messages={aiChat}
            chatPending={aiPending}
            onSendChat={sendAiChat}
            onAddToNotes={addAiAnswerToNotes}
            documents={documents}
            activeDoc={activeDoc}
            activePage={activePage}
            rawUrl={(doc) => boardDocumentRawUrl(whiteboardId, doc.docId)}
            onUpload={uploadDocument}
            onSelectDocument={openDocument}
            onJumpToPage={setActivePage}
            onDeleteDocument={removeDocument}
            uploadingDoc={uploadingDoc}
            flags={factCheckFlags}
            onAcceptFlag={acceptFlag}
            onDismissFlag={dismissFlag}
            onCitationClick={jumpToCitation}
            coverageGaps={coverageGaps}
            scope={scope}
            scopeDiff={scopeDiff}
            onScopeChange={updateScope}
            onConfirmScope={confirmScopeRange}
            onGenerateStudy={generateStudy}
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
