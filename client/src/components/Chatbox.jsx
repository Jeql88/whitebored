import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { X, Send } from "lucide-react";

export default function ChatBox({ socket, userId, whiteboardId, username, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState({ x: null, y: 96 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const messagesEndRef = useRef(null);
  const chatboxRef = useRef(null);

  useEffect(() => {
    if (!socket) return;
    const handler = (msg) => {
      if (msg.whiteboardId === whiteboardId) {
        setMessages((prev) => [...prev, msg]);
      }
    };
    // Load the session history for this board (handles opening the panel after
    // join, and reload/reopen while the board still has people).
    const historyHandler = (list) => {
      if (Array.isArray(list)) {
        setMessages(list.filter((m) => m.whiteboardId === whiteboardId));
      }
    };
    socket.on("chatMessage", handler);
    socket.on("chatHistory", historyHandler);
    socket.emit("requestChatHistory", whiteboardId);
    return () => {
      socket.off("chatMessage", handler);
      socket.off("chatHistory", historyHandler);
    };
  }, [socket, whiteboardId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e) =>
      setPosition({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    const up = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging, offset]);

  const startDrag = (e) => {
    const rect = chatboxRef.current?.getBoundingClientRect();
    if (rect) {
      setOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setDragging(true);
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;
    socket.emit("chatMessage", {
      text: input,
      user: username || "Guest",
      userId,
      whiteboardId,
      time: new Date().toISOString(),
    });
    setInput("");
  };

  return (
    <div
      ref={chatboxRef}
      className="fixed z-40 flex h-[460px] w-80 flex-col overflow-hidden rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] shadow-2xl"
      style={{
        left: position.x !== null ? position.x : undefined,
        right: position.x === null ? 24 : undefined,
        top: position.y,
      }}
    >
      <div
        onMouseDown={startDrag}
        className="flex cursor-move select-none items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface-bg)] px-4 py-2.5"
      >
        <span className="text-sm font-semibold text-[var(--surface-text)]">Chat</span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-[var(--surface-muted)] hover:bg-[var(--surface-card)]"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((msg, i) => {
          const isMe = msg.userId === userId;
          return (
            <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  isMe
                    ? "bg-brand-600 text-white"
                    : "bg-[var(--surface-bg)] text-[var(--surface-text)]"
                }`}
              >
                <div className="mb-0.5 flex items-center gap-2 text-[10px] opacity-80">
                  <span className="font-semibold">{msg.user}</span>
                  {msg.time && (
                    <span>
                      {new Date(msg.time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
                <span>{msg.text}</span>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={sendMessage}
        className="flex gap-2 border-t border-[var(--surface-border)] p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          autoComplete="off"
          className="flex-1 rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 text-white hover:bg-brand-700"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

ChatBox.propTypes = {
  socket: PropTypes.object,
  userId: PropTypes.string,
  whiteboardId: PropTypes.string,
  username: PropTypes.string,
  onClose: PropTypes.func,
};
