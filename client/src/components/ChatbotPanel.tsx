import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { useBoardStore } from "../store/boardStore.js";
import { chatbotName } from "../lib/chatbot.js";
import StickFigure from "./StickFigure.js";

interface ChatbotPanelProps {
  id: string;
  onClose: () => void;
}

/**
 * The chat panel for a Chatbot companion, portaled to document.body (like
 * CodeModal) so it escapes React Flow's transformed node container.
 * Header: avatar + editable name + personality editor + clear/close.
 * Body: the shared transcript; several board members chat with the same bot.
 */
export default function ChatbotPanel({ id, onClose }: ChatbotPanelProps) {
  const boxData = useBoardStore((s) => s.boxData[id]);
  const nodeTitle = useBoardStore(
    (s) => (s.nodes.find((n) => n.id === id)?.data?.title as string) || ""
  );
  const sendChatMessage = useBoardStore((s) => s.sendChatMessage);
  const clearChat = useBoardStore((s) => s.clearChat);
  const setBoxName = useBoardStore((s) => s.setBoxName);
  const updateBoxData = useBoardStore((s) => s.updateBoxData);

  const [draft, setDraft] = useState("");
  const [showPersona, setShowPersona] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const name = chatbotName(nodeTitle);
  const busy = boxData?.status === "running";
  const hasError = boxData?.status === "error";
  const messages = boxData?.chatMessages || [];

  // Keep the transcript scrolled to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  // Escape closes the panel (outside-click intentionally does not — a chat
  // window stays put until dismissed).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!boxData) return null;

  const send = () => {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    sendChatMessage(id, t);
  };

  /**
   * Retry a failed reply: drop the trailing exchange (the user message(s)
   * with no bot answer) and re-send the text.
   */
  const retry = () => {
    const msgs = boxData.chatMessages || [];
    let lastBot = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "bot") { lastBot = i; break; }
    }
    const failed = msgs.slice(lastBot + 1);
    const text = failed
      .filter((m) => m.role === "user")
      .map((m) => m.text)
      .join("\n");
    updateBoxData(id, { chatMessages: msgs.slice(0, lastBot + 1) });
    if (text) sendChatMessage(id, text);
  };

  return createPortal(
    <div
      data-testid="chatbot-panel"
      className="fixed z-50 flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
      style={{ right: 16, bottom: 16, width: 360, height: "min(560px, calc(100vh - 96px))" }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 flex-shrink-0">
        <StickFigure size={26} tone="#e11d48" busy={busy} hideShadow />
        <input
          value={name}
          onChange={(e) => setBoxName(id, e.target.value)}
          className="flex-1 min-w-0 text-sm font-semibold text-slate-700 bg-transparent rounded px-1 py-0.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-rose-300"
          title="Rename this companion"
          aria-label="Companion name"
        />
        <button
          onClick={() => setShowPersona((v) => !v)}
          className={"w-6 h-6 flex items-center justify-center rounded text-sm transition " + (showPersona ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}
          title="Personality — describe who this companion is"
        >
          🧠
        </button>
        <button
          onClick={() => clearChat(id)}
          className="w-6 h-6 flex items-center justify-center rounded text-sm bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
          title="Clear conversation"
        >
          🧹
        </button>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-sm text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          title="Close chat"
        >
          ✕
        </button>
      </div>

      {/* Personality editor */}
      {showPersona && (
        <div className="px-3 py-2 border-b border-slate-100 bg-rose-50/40 flex-shrink-0">
          <p className="text-[11px] font-medium text-slate-500 mb-1">
            Personality — describe who this companion is and how it talks:
          </p>
          <textarea
            className="w-full min-h-[60px] resize-y rounded-lg border border-rose-200 bg-white p-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-200"
            placeholder="e.g. A sarcastic senior designer who still gives genuinely useful advice; short sentences; loves questioning assumptions."
            value={boxData.personality || ""}
            onChange={(e) => updateBoxData(id, { personality: e.target.value })}
          />
          {!boxData.personality && (
            <p className="mt-1 text-[10px] text-slate-400">
              Empty = a friendly default brainstorm buddy.
            </p>
          )}
        </div>
      )}

      {/* Transcript */}
      <div
        ref={scrollRef}
        data-testid="chat-transcript"
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2"
      >
        {messages.map((m) => (
          <div key={m.id} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={
                "max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-snug " +
                (m.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-slate-100 text-slate-700 rounded-bl-sm")
              }
            >
              {m.role === "user" && m.by && (
                <div className="text-[9px] opacity-70 mb-0.5">{m.by}</div>
              )}
              {m.role === "bot" ? (
                <div className="markdown-output text-slate-700 text-[13px]">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="chatbot-dots bg-slate-100 rounded-xl rounded-bl-sm px-3 py-2.5">
              <span /><span /><span />
            </div>
          </div>
        )}
        {messages.length === 0 && !busy && (
          <div className="text-[12px] text-slate-400 text-center pt-8">
            Say hi to your companion 👋
          </div>
        )}
      </div>

      {/* Error + retry */}
      {hasError && !busy && (
        <div className="px-3 py-1.5 border-t border-red-100 bg-red-50 flex items-center gap-2 text-[12px] text-red-600 flex-shrink-0">
          <span className="flex-1 min-w-0 truncate" title={boxData.error}>
            ⚠️ {boxData.error}
          </span>
          <button
            onClick={retry}
            className="text-[12px] font-medium text-red-700 bg-white border border-red-200 rounded-lg px-2 py-0.5 hover:bg-red-100 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2 px-3 py-2 border-t border-slate-100 flex-shrink-0">
        <textarea
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Message ${name}…`}
          className="flex-1 min-h-[36px] max-h-[96px] resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-200"
        />
        <button
          onClick={send}
          disabled={busy || !draft.trim()}
          className="px-3 py-2 rounded-lg text-[13px] font-medium text-white transition disabled:opacity-40"
          style={{ backgroundColor: "#e11d48" }}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>

      {/* Token usage footer */}
      {boxData.tokens && (
        <div className="px-3 py-1 border-t border-slate-100 text-right text-[10px] text-slate-400 flex-shrink-0">
          ⚡ {boxData.tokens.totalTokens.toLocaleString()} tok total
        </div>
      )}
    </div>,
    document.body
  );
}