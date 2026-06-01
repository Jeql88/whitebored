import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import jsPDF from "jspdf";
import {
  ArrowLeft,
  MessageSquare,
  MessagesSquare,
  Download,
  Link2,
  Check,
  Sun,
  Moon,
} from "lucide-react";

import { API_BASE } from "../../api/config";
import { updateWhiteboard } from "../../api/whiteboard";
import { useTheme } from "../../theme/ThemeContext";
import { getColorForName, getInitials } from "../../utils/userColor";
import CommentsSidebar from "./CommentsSidebar";
import ChatBox from "../Chatbox";

// Decode the JWT payload (userId/username) without verifying — display only.
function getUserFromToken() {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return { userId: payload.userId, username: payload.username, token };
  } catch {
    return null;
  }
}

const SCENE_DEBOUNCE_MS = 400;
const CURSOR_THROTTLE_MS = 50;

export default function WhiteboardEditor() {
  const { id: whiteboardId } = useParams();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [boardName, setBoardName] = useState("Untitled");
  const [collaborators, setCollaborators] = useState([]); // presence avatars
  const [openPanel, setOpenPanel] = useState(null); // 'comments' | 'chat' | null
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [socket, setSocket] = useState(null);

  const apiRef = useRef(null); // excalidrawAPI
  const isApplyingRemote = useRef(false);
  const sceneTimer = useRef(null);
  const cursorThrottle = useRef(0);
  const remoteCursors = useRef(new Map()); // socketId -> collaborator pointer

  // Identity: logged-in user or a stable guest id for shared links.
  const identity = useRef(null);
  if (!identity.current) {
    const fromToken = getUserFromToken();
    identity.current = fromToken || {
      userId: `guest-${Math.random().toString(36).slice(2, 10)}`,
      username: "Guest",
      token: null,
    };
  }
  const me = identity.current;
  const isGuest = !me.token;

  // --- Socket lifecycle ---
  useEffect(() => {
    const s = me.token
      ? io(API_BASE, { auth: { token: me.token } })
      : io(API_BASE);
    setSocket(s);

    s.on("connect", () => {
      s.emit("joinWhiteboard", whiteboardId);
      s.emit("presence", {
        whiteboardId,
        userId: me.userId,
        username: me.username,
      });
    });

    // Initial hydration.
    s.on("sceneInit", (scene) => {
      if (!scene || !apiRef.current) return;
      isApplyingRemote.current = true;
      apiRef.current.updateScene({
        elements: scene.elements || [],
        appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor },
      });
      if (scene.files && Object.keys(scene.files).length) {
        apiRef.current.addFiles(Object.values(scene.files));
      }
      queueMicrotask(() => (isApplyingRemote.current = false));
    });

    // Remote scene change.
    s.on("sceneUpdate", (scene) => {
      if (!apiRef.current) return;
      isApplyingRemote.current = true;
      apiRef.current.updateScene({
        elements: scene.elements || [],
        appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor },
      });
      if (scene.files && Object.keys(scene.files).length) {
        apiRef.current.addFiles(Object.values(scene.files));
      }
      queueMicrotask(() => (isApplyingRemote.current = false));
    });

    // Remote cursors → Excalidraw collaborators Map.
    s.on("cursorUpdate", (p) => {
      remoteCursors.current.set(p.socketId, {
        username: p.username,
        pointer: { x: p.x, y: p.y },
        button: p.button || "up",
        color: { background: p.color, stroke: p.color },
      });
      apiRef.current?.updateScene({
        collaborators: new Map(remoteCursors.current),
      });
    });
    s.on("cursorLeave", ({ socketId }) => {
      remoteCursors.current.delete(socketId);
      apiRef.current?.updateScene({
        collaborators: new Map(remoteCursors.current),
      });
    });

    // Presence avatar list.
    s.on("whiteboardUsers", (users) => setCollaborators(users || []));

    return () => s.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboardId]);

  // --- Local scene change → debounced broadcast (with echo guard) ---
  const handleChange = useCallback(
    (elements, appState, files) => {
      if (isApplyingRemote.current || !socket) return;
      clearTimeout(sceneTimer.current);
      sceneTimer.current = setTimeout(() => {
        socket.emit("sceneUpdate", {
          whiteboardId,
          elements,
          appState: { viewBackgroundColor: appState?.viewBackgroundColor },
          files: files || {},
        });
      }, SCENE_DEBOUNCE_MS);
    },
    [socket, whiteboardId]
  );

  // --- Local pointer → throttled cursor broadcast ---
  const handlePointer = useCallback(
    ({ pointer }) => {
      if (!socket || !pointer) return;
      const now = performance.now();
      if (now - cursorThrottle.current < CURSOR_THROTTLE_MS) return;
      cursorThrottle.current = now;
      socket.emit("cursorUpdate", {
        whiteboardId,
        socketId: socket.id,
        userId: me.userId,
        username: me.username,
        x: pointer.x,
        y: pointer.y,
        color: getColorForName(me.username),
      });
    },
    [socket, whiteboardId, me]
  );

  // --- Board name (fetch + rename) ---
  useEffect(() => {
    if (isGuest) return;
    import("../../api/whiteboard").then(({ getWhiteboards }) =>
      getWhiteboards().then((boards) => {
        const found = Array.isArray(boards)
          ? boards.find((b) => b._id === whiteboardId)
          : null;
        if (found) setBoardName(found.name);
      })
    );
  }, [whiteboardId, isGuest]);

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
    setExportOpen(false);
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

  const btn =
    "inline-flex items-center justify-center h-9 w-9 rounded-lg text-[var(--surface-muted)] hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-600/15 transition-colors";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--surface-bg)]">
      {/* Top bar */}
      <header className="z-10 flex items-center gap-2 border-b border-[var(--surface-border)] bg-[var(--surface-card)] px-3 py-2">
        <button
          onClick={() => navigate("/whiteboards")}
          className={btn}
          title="Back to dashboard"
        >
          <ArrowLeft size={18} />
        </button>

        <input
          value={boardName}
          onChange={(e) => setBoardName(e.target.value)}
          onBlur={commitName}
          disabled={isGuest}
          className="max-w-[220px] rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-[var(--surface-text)] outline-none focus:bg-brand-50 dark:focus:bg-brand-600/10 disabled:opacity-70"
          title={isGuest ? "Sign in to rename" : "Rename board"}
        />

        {isGuest && (
          <span className="rounded-md bg-accent-500/15 px-2 py-0.5 text-xs font-medium text-accent-600">
            Guest
          </span>
        )}

        <div className="flex-1" />

        {/* Presence avatars */}
        <div className="mr-1 flex -space-x-2">
          {collaborators.slice(0, 5).map((u) => (
            <div
              key={u.socketId}
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

        <div className="relative">
          <button onClick={() => setExportOpen((v) => !v)} className={btn} title="Export">
            <Download size={18} />
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-11 z-20 w-40 overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] shadow-lg">
              <button onClick={() => doExport("png")} className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50 dark:hover:bg-brand-600/15">
                Download PNG
              </button>
              <button onClick={() => doExport("pdf")} className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50 dark:hover:bg-brand-600/15">
                Export as PDF
              </button>
            </div>
          )}
        </div>

        <button onClick={copyLink} className={btn} title="Copy shareable link">
          {copied ? <Check size={18} className="text-green-500" /> : <Link2 size={18} />}
        </button>
        <button onClick={toggleTheme} className={btn} title="Toggle theme">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1">
        <Excalidraw
          excalidrawAPI={(api) => (apiRef.current = api)}
          theme={theme}
          onChange={handleChange}
          onPointerUpdate={handlePointer}
          initialData={{ appState: { viewBackgroundColor: "#ffffff" } }}
        />

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
    </div>
  );
}
