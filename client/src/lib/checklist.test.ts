import { describe, expect, it } from "vitest";
import {
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT,
  appendChecklistItems,
  checklistDisplayName,
  checklistStats,
  checklistToMarkdown,
  clampChecklistText,
  clearDoneChecklistItems,
  makeChecklistItem,
  moveChecklistItem,
  normalizeChecklist,
  parseChecklistLines,
  removeChecklistItem,
  setChecklistItemAssignee,
  setChecklistItemText,
  toggleChecklistItem,
} from "./checklist.js";
import type { ChecklistItem } from "../types.js";

/** Deterministic factory: item ids/clock are injected so tests never flake. */
const item = (text: string, done = false, id = text) =>
  makeChecklistItem(text, "alice@x.co", { id, done, now: 1_000 });

const items = (...texts: string[]) => texts.map((t) => item(t));

describe("clampChecklistText", () => {
  it("collapses newlines and trims", () => {
    expect(clampChecklistText("  write \n the   runbook  ")).toBe("write the runbook");
  });

  it("clamps to the max task length", () => {
    expect(clampChecklistText("x".repeat(MAX_CHECKLIST_TEXT + 50))).toHaveLength(
      MAX_CHECKLIST_TEXT
    );
  });
});

describe("makeChecklistItem", () => {
  it("defines every field (Firestore rejects nested undefined)", () => {
    const it = makeChecklistItem("Ship it", "bob@x.co", { id: "i1", now: 42 });
    expect(it).toEqual({
      id: "i1",
      text: "Ship it",
      done: false,
      assignee: "",
      createdBy: "bob@x.co",
      createdAt: 42,
      doneBy: "",
      doneAt: 0,
    });
    expect(Object.values(it).every((v) => v !== undefined)).toBe(true);
  });

  it("records the author and time when created already done", () => {
    const it = makeChecklistItem("Old task", "bob@x.co", { done: true, now: 7 });
    expect(it.done).toBe(true);
    expect(it.doneBy).toBe("bob@x.co");
    expect(it.doneAt).toBe(7);
  });

  it("generates unique ids", () => {
    const a = makeChecklistItem("a", "");
    const b = makeChecklistItem("b", "");
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^item-/);
  });
});

describe("parseChecklistLines", () => {
  it("parses markdown task lists, bullets and numbered lists", () => {
    const parsed = parseChecklistLines(
      ["- [ ] draft the plan", "- [x] book the room", "* milk", "• bread", "1. eggs", "2) tea", "plain line", "", "   "].join(
        "\n"
      )
    );
    expect(parsed).toEqual([
      { text: "draft the plan", done: false },
      { text: "book the room", done: true },
      { text: "milk", done: false },
      { text: "bread", done: false },
      { text: "eggs", done: false },
      { text: "tea", done: false },
      { text: "plain line", done: false },
    ]);
  });

  it("accepts a checkbox with no bullet and uppercase X", () => {
    expect(parseChecklistLines("[X] done already")).toEqual([
      { text: "done already", done: true },
    ]);
  });

  it("ignores marker-only lines and blank input", () => {
    expect(parseChecklistLines("- [ ]\n-\n  \n")).toEqual([]);
    expect(parseChecklistLines("")).toEqual([]);
  });

  it("keeps a hyphen inside the text", () => {
    expect(parseChecklistLines("- well-known issue")).toEqual([
      { text: "well-known issue", done: false },
    ]);
    // A task that starts with a hyphen is not a bullet list.
    expect(parseChecklistLines("-50% latency target")).toEqual([
      { text: "-50% latency target", done: false },
    ]);
  });
});

describe("appendChecklistItems", () => {
  it("appends parsed lines with ids, author and the parsed done state", () => {
    const next = appendChecklistItems([], "- [ ] a\n- [x] b", "bob@x.co", { now: 5 });
    expect(next).toHaveLength(2);
    expect(next[0].text).toBe("a");
    expect(next[0].done).toBe(false);
    expect(next[1].done).toBe(true);
    expect(next[1].createdBy).toBe("bob@x.co");
    expect(next[1].createdAt).toBe(5);
    expect(next[1].doneBy).toBe("bob@x.co");
  });

  it("appends an explicit array of strings as open tasks", () => {
    const next = appendChecklistItems(items("first"), ["second", "third"], "me@x.co");
    expect(next.map((i) => i.text)).toEqual(["first", "second", "third"]);
    expect(next.slice(1).every((i) => i.createdBy === "me@x.co" && !i.done)).toBe(true);
  });

  it("adds nothing (and keeps the array identity) for blank input", () => {
    const current = items("only");
    expect(appendChecklistItems(current, "   \n  ", "me@x.co")).toBe(current);
  });

  it("respects the item cap instead of growing the board document forever", () => {
    const full = Array.from({ length: MAX_CHECKLIST_ITEMS }, (_, i) => item(`t${i}`, false, `id${i}`));
    const next = appendChecklistItems(full, "one too many", "me@x.co");
    expect(next).toBe(full);
    expect(next).toHaveLength(MAX_CHECKLIST_ITEMS);
  });

  it("fills the remaining room when the list is near the cap", () => {
    const near = Array.from({ length: MAX_CHECKLIST_ITEMS - 1 }, (_, i) => item(`t${i}`, false, `id${i}`));
    const next = appendChecklistItems(near, "a\nb\nc", "me@x.co");
    expect(next).toHaveLength(MAX_CHECKLIST_ITEMS);
    expect(next[next.length - 1].text).toBe("a");
  });
});

describe("toggleChecklistItem", () => {
  it("ticks a task off with attribution", () => {
    const next = toggleChecklistItem(items("a", "b"), "a", "bob@x.co", 99);
    expect(next[0]).toMatchObject({ done: true, doneBy: "bob@x.co", doneAt: 99 });
    expect(next[1].done).toBe(false);
  });

  it("un-ticks and clears the attribution", () => {
    const done = toggleChecklistItem(items("a"), "a", "bob@x.co", 99);
    const back = toggleChecklistItem(done, "a", "carol@x.co", 120);
    expect(back[0]).toMatchObject({ done: false, doneBy: "", doneAt: 0 });
  });

  it("ignores an unknown id but keeps the array identity", () => {
    const current = items("a");
    expect(toggleChecklistItem(current, "nope", "bob@x.co")).toBe(current);
  });
});

describe("setChecklistItemText", () => {
  it("renames a task", () => {
    expect(setChecklistItemText(items("a"), "a", "  new name ")[0].text).toBe("new name");
  });

  it("refuses to blank a task (empty input is a no-op)", () => {
    const current = items("a");
    expect(setChecklistItemText(current, "a", "   ")).toBe(current);
  });
});

describe("setChecklistItemAssignee", () => {
  it("assigns and clears", () => {
    const assigned = setChecklistItemAssignee(items("a"), "a", " bob@x.co ");
    expect(assigned[0].assignee).toBe("bob@x.co");
    expect(setChecklistItemAssignee(assigned, "a", "")[0].assignee).toBe("");
  });
});

describe("removeChecklistItem / clearDoneChecklistItems", () => {
  it("removes one task", () => {
    expect(removeChecklistItem(items("a", "b"), "a").map((i) => i.text)).toEqual(["b"]);
  });

  it("clears finished tasks and keeps the identity when none are done", () => {
    const some = [item("a", true), item("b"), item("c", true)];
    expect(clearDoneChecklistItems(some).map((i) => i.text)).toEqual(["b"]);
    const open = items("x");
    expect(clearDoneChecklistItems(open)).toBe(open);
  });
});

describe("moveChecklistItem", () => {
  it("moves a task up and down", () => {
    expect(moveChecklistItem(items("a", "b", "c"), "b", -1).map((i) => i.text)).toEqual(["b", "a", "c"]);
    expect(moveChecklistItem(items("a", "b", "c"), "b", 1).map((i) => i.text)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at the edges and for unknown ids", () => {
    const current = items("a", "b");
    expect(moveChecklistItem(current, "a", -1)).toBe(current);
    expect(moveChecklistItem(current, "b", 1)).toBe(current);
    expect(moveChecklistItem(current, "zzz", 1)).toBe(current);
  });
});

describe("checklistStats", () => {
  it("counts done/open and rounds the percentage", () => {
    expect(checklistStats([item("a", true), item("b"), item("c"), item("d")])).toEqual({
      total: 4,
      done: 1,
      open: 3,
      percent: 25,
    });
  });

  it("is 0% for an empty list (never NaN)", () => {
    expect(checklistStats([])).toEqual({ total: 0, done: 0, open: 0, percent: 0 });
  });

  it("is 100% when everything is done", () => {
    expect(checklistStats([item("a", true)]).percent).toBe(100);
  });
});

describe("checklistToMarkdown", () => {
  it("renders a Markdown checklist with assignees", () => {
    const list = [
      { ...item("write the runbook"), assignee: "bob@x.co" },
      item("ship it", true),
    ];
    expect(checklistToMarkdown(list)).toBe("- [ ] write the runbook (@bob)\n- [x] ship it");
  });

  it("renders an empty string for an empty list", () => {
    expect(checklistToMarkdown([])).toBe("");
  });
});

describe("checklistDisplayName", () => {
  it("takes the part before the @", () => {
    expect(checklistDisplayName("alessiobonti@gmail.com")).toBe("alessiobonti");
    expect(checklistDisplayName("")).toBe("");
    expect(checklistDisplayName("local")).toBe("local");
  });
});

describe("normalizeChecklist", () => {
  it("returns [] for anything that is not an array", () => {
    expect(normalizeChecklist(undefined)).toEqual([]);
    expect(normalizeChecklist(null)).toEqual([]);
    expect(normalizeChecklist({ text: "x" })).toEqual([]);
  });

  it("fills every field with a defined value (Firestore-safe)", () => {
    const [only] = normalizeChecklist([{ text: "legacy task", done: true }]);
    expect(only).toMatchObject({
      text: "legacy task",
      done: true,
      assignee: "",
      createdBy: "",
      createdAt: 0,
      doneBy: "",
      doneAt: 0,
    });
    expect(typeof only.id).toBe("string");
    expect(only.id.length).toBeGreaterThan(0);
    expect(Object.values(only).every((v) => v !== undefined)).toBe(true);
  });

  it("drops junk entries and keeps the good ones", () => {
    const list = normalizeChecklist([
      null,
      "nope",
      { text: "   " },
      { text: "keep me", id: "i9" },
    ]);
    expect(list.map((i) => i.text)).toEqual(["keep me"]);
    expect(list[0].id).toBe("i9");
  });

  it("is idempotent for already-clean data", () => {
    const clean = [item("a", true), item("b")];
    expect(normalizeChecklist(clean)).toEqual(clean);
  });

  it("applies the length cap to a huge stored list", () => {
    const huge: unknown[] = Array.from({ length: MAX_CHECKLIST_ITEMS + 25 }, () => ({ text: "t" }));
    expect(normalizeChecklist(huge)).toHaveLength(MAX_CHECKLIST_ITEMS);
  });

  it("drops doneBy/doneAt on an open task", () => {
    const [only] = normalizeChecklist([
      { id: "i1", text: "open", done: false, doneBy: "ghost@x.co", doneAt: 5 },
    ]);
    expect(only.doneBy).toBe("");
    expect(only.doneAt).toBe(0);
  });
});

describe("a full team session on one checklist", () => {
  it("adds, assigns, ticks, reorders and exports", () => {
    let list: ChecklistItem[] = [];
    list = appendChecklistItems(list, "Kickoff deck\nOwner: write the runbook", "alice@x.co", {
      now: 10,
    });
    list = setChecklistItemAssignee(list, list[1].id, "bob@x.co");
    list = toggleChecklistItem(list, list[0].id, "bob@x.co", 20);
    list = moveChecklistItem(list, list[1].id, -1);
    expect(checklistToMarkdown(list)).toBe(
      "- [ ] Owner: write the runbook (@bob)\n- [x] Kickoff deck"
    );
    expect(checklistStats(list)).toMatchObject({ total: 2, done: 1, open: 1, percent: 50 });
    // Bob ticked the first task, Alice created both.
    const closed = list.find((i) => i.done)!;
    expect(closed.doneBy).toBe("bob@x.co");
    expect(list.every((i) => i.createdBy === "alice@x.co")).toBe(true);
  });
});
