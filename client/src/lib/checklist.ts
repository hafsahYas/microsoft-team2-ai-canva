import type { ChecklistItem } from "../types.js";

/**
 * Pure logic for Checklist boxes — the team's shared to-do list.
 *
 * A checklist is stored as one array of `ChecklistItem`s in the box's BoxData,
 * so it syncs to everyone on the board through the normal board document
 * (last-write-wins between simultaneous users, exactly like a Note). There is
 * no AI and no pipeline wiring: the box is a collaboration tool.
 *
 * Everything here is a pure function taking the current items and returning
 * the next ones, so the component only wires them to `setChecklistItems` and
 * all the rules are unit-tested (`checklist.test.ts`).
 *
 * Invariants that matter:
 *  - every field of every item is ALWAYS defined (Firestore rejects
 *    `undefined` nested anywhere in a value) — `normalizeChecklist` enforces
 *    this for data that came back from a board document;
 *  - text is trimmed, single-lined and clamped, and the list length is capped,
 *    so one box can never grow the board document past Firestore's 1MB limit.
 */

/** Hard cap on tasks per checklist box (keeps the board doc small). */
export const MAX_CHECKLIST_ITEMS = 200;
/** Hard cap on one task's text length. */
export const MAX_CHECKLIST_TEXT = 500;

/** Monotonic counter so ids stay unique inside one millisecond. */
let idSeq = 0;

/** A fresh, collision-resistant item id (no crypto needed — ids are local). */
export function newChecklistItemId(now = Date.now()): string {
  idSeq = (idSeq + 1) % 1_000_000;
  return `item-${now.toString(36)}-${idSeq.toString(36)}`;
}

/**
 * Normalizes task text: newlines collapsed, trimmed, clamped. Also used as the
 * guard that stops a pasted document from becoming one enormous task.
 */
export function clampChecklistText(text: string): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > MAX_CHECKLIST_TEXT ? clean.slice(0, MAX_CHECKLIST_TEXT) : clean;
}

/** Options accepted by `makeChecklistItem` (all optional, for tests). */
export interface MakeItemOptions {
  id?: string;
  /** Start the task already ticked off (used by the paste parser). */
  done?: boolean;
  assignee?: string;
  now?: number;
}

/** Builds one item with every field defined. */
export function makeChecklistItem(
  text: string,
  by: string,
  opts: MakeItemOptions = {}
): ChecklistItem {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const clean = clampChecklistText(text);
  const done = !!opts.done;
  const author = (by || "").trim();
  return {
    id: opts.id || newChecklistItemId(now),
    text: clean,
    done,
    assignee: (opts.assignee || "").trim(),
    createdBy: author,
    createdAt: now,
    doneBy: done ? author : "",
    doneAt: done ? now : 0,
  };
}

/** One parsed line of pasted checklist text. */
export interface ParsedChecklistLine {
  text: string;
  done: boolean;
}

/**
 * Parses pasted multi-line text into tasks. Accepts what people actually
 * paste: Markdown task lists (`- [ ] x`, `- [x] x`), plain bullets
 * (`- x`, `* x`, `• x`), numbered lists (`1. x`, `2) x`) and bare lines.
 * Blank lines and marker-only lines are ignored.
 */
export function parseChecklistLines(input: string): ParsedChecklistLine[] {
  const out: ParsedChecklistLine[] = [];
  for (const raw of String(input ?? "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    let done = false;
    // "- [ ] task" / "* [x] task" / "1. [X] task" / "[ ] task"
    const checkbox = line.match(/^(?:[-*•]|\d+[.)])?\s*\[([ xX])\]\s*(.*)$/);
    if (checkbox) {
      done = checkbox[1].toLowerCase() === "x";
      line = checkbox[2].trim();
    } else {
      // A bare marker on its own line is not a task…
      if (/^(?:[-*•]|\d+[.)])$/.test(line)) continue;
      // …and a marker needs a space after it, so a task that genuinely starts
      // with a hyphen ("-50% latency") keeps its text.
      line = line.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
    }
    const text = clampChecklistText(line);
    if (!text) continue;
    out.push({ text, done });
  }
  return out;
}

/**
 * Appends tasks from raw text (parsed) or from an explicit list of strings.
 * Returns the new array; the number added is `next.length − items.length`.
 * The cap is respected — excess tasks are dropped, not silently merged.
 */
export function appendChecklistItems(
  items: ChecklistItem[],
  input: string | string[],
  by: string,
  opts: { now?: number } = {}
): ChecklistItem[] {
  const parsed: ParsedChecklistLine[] = Array.isArray(input)
    ? input.map((text) => ({ text: clampChecklistText(text), done: false }))
    : parseChecklistLines(input);
  const room = Math.max(0, MAX_CHECKLIST_ITEMS - items.length);
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const added: ChecklistItem[] = [];
  for (const line of parsed.slice(0, room)) {
    if (!line.text) continue;
    added.push(makeChecklistItem(line.text, by, { done: line.done, now }));
  }
  return added.length ? [...items, ...added] : items;
}

/**
 * Applies a per-item edit. Returns the SAME array when the id is unknown or
 * the edit changed nothing, so a no-op interaction never marks the board dirty
 * (`setChecklistItems` → `updateBoxData` → a scheduled save).
 */
function mapChecklistItem(
  items: ChecklistItem[],
  itemId: string,
  fn: (item: ChecklistItem) => ChecklistItem
): ChecklistItem[] {
  let changed = false;
  const next = items.map((it) => {
    if (it.id !== itemId) return it;
    const updated = fn(it);
    if (updated !== it) changed = true;
    return updated;
  });
  return changed ? next : items;
}

/** Ticks a task off, or puts it back — recording who did it and when. */
export function toggleChecklistItem(
  items: ChecklistItem[],
  itemId: string,
  by: string,
  now = Date.now()
): ChecklistItem[] {
  const author = (by || "").trim();
  return mapChecklistItem(items, itemId, (it) => {
    const done = !it.done;
    return {
      ...it,
      done,
      doneBy: done ? author : "",
      doneAt: done ? now : 0,
    };
  });
}

/** Renames a task. Empty (or whitespace-only) input is a no-op. */
export function setChecklistItemText(
  items: ChecklistItem[],
  itemId: string,
  text: string
): ChecklistItem[] {
  const clean = clampChecklistText(text);
  if (!clean) return items;
  return mapChecklistItem(items, itemId, (it) =>
    it.text === clean ? it : { ...it, text: clean }
  );
}

/** Assigns a task to a teammate ("" clears the assignment). */
export function setChecklistItemAssignee(
  items: ChecklistItem[],
  itemId: string,
  assignee: string
): ChecklistItem[] {
  const clean = (assignee || "").trim();
  return mapChecklistItem(items, itemId, (it) =>
    it.assignee === clean ? it : { ...it, assignee: clean }
  );
}

/** Removes one task (same array when the id is unknown). */
export function removeChecklistItem(
  items: ChecklistItem[],
  itemId: string
): ChecklistItem[] {
  const next = items.filter((it) => it.id !== itemId);
  return next.length === items.length ? items : next;
}

/** Removes every finished task (returns the same array when none are done). */
export function clearDoneChecklistItems(items: ChecklistItem[]): ChecklistItem[] {
  const next = items.filter((it) => !it.done);
  return next.length === items.length ? items : next;
}

/**
 * Moves one task up (`-1`) or down (`+1`). Out-of-range moves are a no-op, so
 * the first ▲ / last ▼ buttons can be pressed without corrupting the order.
 */
export function moveChecklistItem(
  items: ChecklistItem[],
  itemId: string,
  delta: -1 | 1
): ChecklistItem[] {
  const from = items.findIndex((it) => it.id === itemId);
  if (from < 0) return items;
  const to = from + delta;
  if (to < 0 || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Progress readout for the panel header. */
export interface ChecklistStats {
  total: number;
  done: number;
  open: number;
  /** Whole percent of tasks done (0 when the list is empty). */
  percent: number;
}

export function checklistStats(items: ChecklistItem[]): ChecklistStats {
  const total = items.length;
  let done = 0;
  for (const it of items) if (it.done) done++;
  return {
    total,
    done,
    open: total - done,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

/** The task list as a Markdown checklist (for copying into a doc or chat). */
export function checklistToMarkdown(items: ChecklistItem[]): string {
  return items
    .map((it) => {
      const box = it.done ? "[x]" : "[ ]";
      const who = it.assignee ? ` (@${checklistDisplayName(it.assignee)})` : "";
      return `- ${box} ${it.text}${who}`;
    })
    .join("\n");
}

/** Short human name for an email: the part before the "@" ("" stays ""). */
export function checklistDisplayName(email: string): string {
  const clean = (email || "").trim();
  if (!clean) return "";
  const at = clean.indexOf("@");
  return at > 0 ? clean.slice(0, at) : clean;
}

/**
 * Repairs checklist data that came back from a board document: drops entries
 * that are not objects or carry no text, coerces every field to the right type
 * (filling in a fresh id / 0 / "" instead of `undefined`), and re-applies the
 * length cap. Old boards — and anything written by an older client — load
 * cleanly through this.
 */
export function normalizeChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChecklistItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const it = entry as Partial<ChecklistItem>;
    const text = clampChecklistText(typeof it.text === "string" ? it.text : "");
    if (!text) continue;
    const done = it.done === true;
    const createdAt = typeof it.createdAt === "number" && it.createdAt > 0 ? it.createdAt : 0;
    out.push({
      id: typeof it.id === "string" && it.id ? it.id : newChecklistItemId(),
      text,
      done,
      assignee: typeof it.assignee === "string" ? it.assignee.trim() : "",
      createdBy: typeof it.createdBy === "string" ? it.createdBy.trim() : "",
      createdAt,
      doneBy: done && typeof it.doneBy === "string" ? it.doneBy.trim() : "",
      doneAt: done && typeof it.doneAt === "number" && it.doneAt > 0 ? it.doneAt : 0,
    });
    if (out.length >= MAX_CHECKLIST_ITEMS) break;
  }
  return out;
}
