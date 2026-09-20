import { useMemo, useRef, useState } from "react";
import type { ChecklistItem } from "../types.js";
import {
  MAX_CHECKLIST_ITEMS,
  appendChecklistItems,
  checklistDisplayName,
  checklistStats,
  checklistToMarkdown,
  clearDoneChecklistItems,
  moveChecklistItem,
  normalizeChecklist,
  removeChecklistItem,
  setChecklistItemAssignee,
  setChecklistItemText,
  toggleChecklistItem,
} from "../lib/checklist.js";
import { useBoardStore } from "../store/boardStore.js";
import { useAuthStore } from "../store/authStore.js";

interface ChecklistPanelProps {
  boxId: string;
  /** The raw stored tasks (normalized here — old boards load cleanly). */
  items: ChecklistItem[] | undefined;
}

/**
 * The body of a Checklist box — the team's shared to-do list.
 *
 * Rendering only: every rule (add/parse, toggle with attribution, assign,
 * rename, reorder, clear done, caps) is a pure function in
 * `client/src/lib/checklist.ts` and is unit-tested there. The panel wires those
 * functions to `setChecklistItems`, which writes through the normal debounced
 * board save — so a tick by one teammate reaches everyone through Firestore.
 *
 * This component owns its own store subscriptions: BoxNode must not subscribe
 * to collaborators/presence (that would re-render every box on the canvas
 * whenever someone moves their cursor).
 */
export default function ChecklistPanel({ boxId, items }: ChecklistPanelProps) {
  const setChecklistItems = useBoardStore((s) => s.setChecklistItems);
  const me = useAuthStore((s) => s.user?.email || "");
  // Selected as a joined STRING: a fresh array from the selector would re-render
  // the panel on every presence snapshot while someone moves their mouse.
  const peopleKey = useBoardStore((s) => {
    // Dedupe case-insensitively but keep the first spelling seen (so the value
    // stored on a task always matches an option's value exactly).
    const seen = new Map<string, string>();
    const add = (email?: string | null) => {
      const clean = (email || "").trim();
      if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
    };
    add(me);
    for (const email of s.collaborators || []) add(email);
    for (const u of s.activeUsers || []) add(u.email);
    return Array.from(seen.values()).sort().join("|");
  });
  const people = useMemo(() => (peopleKey ? peopleKey.split("|") : []), [peopleKey]);

  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => normalizeChecklist(items), [items]);
  const stats = checklistStats(list);
  const full = list.length >= MAX_CHECKLIST_ITEMS;

  /** Applies a pure mutation to the shared list. */
  const mutate = (fn: (current: ChecklistItem[]) => ChecklistItem[]) => {
    setChecklistItems(boxId, fn(list));
  };

  const addDraft = (text: string) => {
    const next = appendChecklistItems(list, text, me);
    setChecklistItems(boxId, next);
    return next.length - list.length;
  };

  const submitDraft = () => {
    if (addDraft(draft) > 0) {
      setDraft("");
      // Keep the caret in the field so a whole list can be typed Enter-by-Enter.
      inputRef.current?.focus();
    }
  };

  const startEditing = (item: ChecklistItem) => {
    setEditingId(item.id);
    setEditDraft(item.text);
  };

  const commitEdit = () => {
    if (editingId) mutate((current) => setChecklistItemText(current, editingId, editDraft));
    setEditingId(null);
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(checklistToMarkdown(list));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="checklist-panel nodrag flex h-full flex-col gap-2" data-testid="checklist-panel">
      {/* Progress + list-level actions */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="checklist-progress text-[11px] font-semibold text-slate-500 tabular-nums">
            {stats.total === 0 ? "No tasks yet" : `${stats.done} of ${stats.total} done`}
          </span>
          <div className="flex items-center gap-1">
            {stats.done > 0 && (
              <button
                className="checklist-clear-done rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                title={`Remove the ${stats.done} finished task${stats.done === 1 ? "" : "s"}`}
                onClick={() => mutate((current) => clearDoneChecklistItems(current))}
              >
                🧹 Clear done
              </button>
            )}
            <button
              className="checklist-copy rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
              title="Copy the list as a Markdown checklist"
              onClick={copyMarkdown}
              disabled={stats.total === 0}
            >
              {copied ? "✅ Copied" : "📋 Copy"}
            </button>
          </div>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${stats.percent}%`, backgroundColor: "#059669" }}
          />
        </div>
      </div>

      {/* Add a task — multi-line pastes become several tasks at once. */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <input
          ref={inputRef}
          className="checklist-add-input nodrag min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 transition placeholder:text-slate-400 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-50"
          placeholder={full ? "List is full" : "Add a task…"}
          value={draft}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitDraft();
            }
            if (e.key === "Escape") setDraft("");
          }}
          onPaste={(e) => {
            const text = e.clipboardData?.getData("text") || "";
            // A pasted list (Markdown tasks, bullets, plain lines) imports in
            // one gesture instead of landing as one long task.
            if (!/\r?\n/.test(text.trim())) return;
            e.preventDefault();
            if (addDraft(text) > 0) setDraft("");
          }}
        />
        <button
          className="checklist-add-btn flex-shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-white transition disabled:opacity-40"
          style={{ backgroundColor: "#059669" }}
          disabled={!draft.trim() || full}
          onClick={submitDraft}
          title="Add the task (or paste a whole list)"
        >
          ＋ Add
        </button>
      </div>

      {/* The shared list */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {list.length === 0 && (
          <p className="checklist-empty px-1 pt-2 text-[11px] leading-snug text-slate-400">
            No tasks yet. Add the first one above — everyone on this board sees this list and
            can tick tasks off.
          </p>
        )}
        {list.map((item, index) => (
          <div
            key={item.id}
            data-testid="checklist-item"
            data-item-id={item.id}
            data-done={item.done ? "true" : "false"}
            className={
              "checklist-item group flex items-start gap-1.5 rounded-lg border px-1.5 py-1 transition " +
              (item.done
                ? "border-slate-100 bg-slate-50/70"
                : "border-slate-200/70 bg-white hover:border-slate-300")
            }
          >
            <input
              type="checkbox"
              className="checklist-check nodrag mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-emerald-600"
              checked={item.done}
              onChange={() => mutate((current) => toggleChecklistItem(current, item.id, me))}
              title={item.done ? "Put this task back" : "Tick this task off"}
            />
            <div className="min-w-0 flex-1">
              {editingId === item.id ? (
                <input
                  autoFocus
                  className="nodrag w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span
                  className={
                    "checklist-text block cursor-text break-words text-[12px] leading-snug " +
                    (item.done ? "text-slate-400 line-through" : "text-slate-700")
                  }
                  title={`Added by ${checklistDisplayName(item.createdBy) || "someone"} — click to edit`}
                  onClick={() => startEditing(item)}
                >
                  {item.text}
                </span>
              )}
              <div className="mt-0.5 flex items-center gap-1.5">
                <select
                  className={
                    "checklist-assign nodrag max-w-[110px] rounded-full border px-1 py-0 text-[10px] font-medium transition focus:outline-none " +
                    (item.assignee
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-400")
                  }
                  value={item.assignee}
                  onChange={(e) =>
                    mutate((current) => setChecklistItemAssignee(current, item.id, e.target.value))
                  }
                  title="Assign this task to a teammate on this board"
                >
                  <option value="">＋ assign</option>
                  {people.map((email) => (
                    <option key={email} value={email}>
                      {checklistDisplayName(email)}
                    </option>
                  ))}
                  {/* Keep an assignee who is no longer listed (left the board) selectable. */}
                  {item.assignee && !people.includes(item.assignee) && (
                    <option value={item.assignee}>{checklistDisplayName(item.assignee)}</option>
                  )}
                </select>
                {item.done && item.doneBy && (
                  <span className="checklist-done-by text-[10px] text-slate-400">
                    ✓ {checklistDisplayName(item.doneBy)}
                  </span>
                )}
              </div>
            </div>
            {/* Row actions stay out of the way until the row is hovered (always
                visible on touch devices via .touch-visible). */}
            <div className="checklist-row-actions touch-visible flex flex-shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
              <button
                className="checklist-move flex h-5 w-5 items-center justify-center rounded text-[9px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                title="Move up"
                disabled={index === 0}
                onClick={() => mutate((current) => moveChecklistItem(current, item.id, -1))}
              >
                ▲
              </button>
              <button
                className="checklist-move flex h-5 w-5 items-center justify-center rounded text-[9px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                title="Move down"
                disabled={index === list.length - 1}
                onClick={() => mutate((current) => moveChecklistItem(current, item.id, 1))}
              >
                ▼
              </button>
              <button
                className="checklist-delete flex h-5 w-5 items-center justify-center rounded text-[10px] text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                title="Delete this task"
                onClick={() => mutate((current) => removeChecklistItem(current, item.id))}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
