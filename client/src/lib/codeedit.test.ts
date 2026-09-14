import { describe, expect, it } from "vitest";
import type { BoxData, FileChange, NamedInput } from "../types.js";
import {
  MAX_EDIT_FILES,
  buildEditPrompt,
  buildPatch,
  changeSetChars,
  computeLineDiff,
  filePatch,
  isSafeRepoPath,
  lineDiff,
  normalizeRepoPath,
  parseChangeSet,
  parsePathList,
  parsePlanFiles,
  parseTriage,
  renderChangeSet,
  summarizeChangeSet,
  toHunks,
  validateChangeSet,
} from "./codeedit.js";

describe("path safety", () => {
  it("accepts ordinary repository paths", () => {
    for (const path of ["src/index.ts", "client/src/lib/repo.ts", "docs/ARCHITECTURE.md", "Dockerfile", "a/b/c/d.py"]) {
      expect(isSafeRepoPath(path), path).toBe(true);
    }
  });

  it("refuses traversal, absolute paths, backslashes and build output", () => {
    for (const path of [
      "", "/etc/passwd", "~/secrets", "src/../../etc/passwd", "..", "../x.ts",
      "C:\\Windows\\system32", "src\\win.ts", "node_modules/x/index.js", "dist/index.js",
      ".git/config", "coverage/lcov.info", "target/debug/x", "a\u0000b",
    ]) {
      expect(isSafeRepoPath(path), path).toBe(false);
    }
    expect(isSafeRepoPath(undefined)).toBe(false);
    expect(isSafeRepoPath("x".repeat(400))).toBe(false);
  });

  it("normalizes the shapes people type", () => {
    expect(normalizeRepoPath("./src/index.ts")).toBe("src/index.ts");
    expect(normalizeRepoPath("/src/index.ts")).toBe("src/index.ts");
    expect(normalizeRepoPath("src//lib//a.ts")).toBe("src/lib/a.ts");
    expect(normalizeRepoPath("src/lib/a.ts/")).toBe("src/lib/a.ts");
  });
});

describe("parsePathList", () => {
  it("reads one path per line, commas or spaces", () => {
    expect(parsePathList("src/a.ts\nsrc/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parsePathList("src/a.ts, src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parsePathList("- `src/a.ts`\n- src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("drops unsafe, duplicate and non-path tokens", () => {
    expect(parsePathList("src/a.ts\nsrc/a.ts\n../evil.ts\nnode_modules/x.js\njustaword\nREADME.md")).toEqual([
      "src/a.ts", "README.md",
    ]);
    expect(parsePathList("")).toEqual([]);
    expect(parsePathList(undefined)).toEqual([]);
    expect(parsePathList(Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`).join("\n")).length).toBe(12);
  });
});

describe("parsePlanFiles", () => {
  const plan = [
    "# Plan: add SSO",
    "",
    "## Files to change",
    "- `server/src/app.ts` — add the SAML route",
    "- `client/src/lib/api.ts` — call the endpoint",
    "- src/lib/sso.ts — new helper",
    "",
    "## Tests",
    '- "session cap" → Decision 1',
    "",
    "## Risks",
    "- `client/src/store/boardStore.ts` is big (not a change)",
  ].join("\n");

  it("extracts the file list from an upstream plan (so no triage call is needed)", () => {
    expect(parsePlanFiles(plan)).toEqual(["server/src/app.ts", "client/src/lib/api.ts", "src/lib/sso.ts"]);
  });

  it("stops at the next heading and stays quiet without a plan", () => {
    expect(parsePlanFiles("## Risks\n- src/x.ts")).toEqual([]);
    expect(parsePlanFiles("")).toEqual([]);
    expect(parsePlanFiles(undefined)).toEqual([]);
  });
});

describe("parseTriage", () => {
  it("reads the JSON triage reply", () => {
    const reply = '```json\n{"files":["src/a.ts","src/b.ts"],"plan":"add the flag"}\n```';
    expect(parseTriage(reply)).toEqual({ files: ["src/a.ts", "src/b.ts"], plan: "add the flag" });
  });

  it("falls back to scraping paths from prose, and drops unsafe ones", () => {
    const reply = "I would read:\n- `src/a.ts`\n- /etc/passwd\n- node_modules/x.js\n- src/b.ts\n";
    expect(parseTriage(reply).files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parseTriage("").files).toEqual([]);
  });
});

describe("parseChangeSet", () => {
  it("reads the fenced JSON change set", () => {
    const reply = [
      "Here is the change:",
      "```json",
      JSON.stringify({
        summary: "add a flag",
        changes: [{ path: "src/a.ts", operation: "update", content: "new\n", reason: "adds the flag" }],
        notes: ["not compiled", ""],
      }),
      "```",
    ].join("\n");
    const parsed = parseChangeSet(reply);
    expect(parsed.error).toBe("");
    expect(parsed.summary).toBe("add a flag");
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.notes).toEqual(["not compiled"]);
  });

  it("tolerates a bare JSON object and prose around it", () => {
    const parsed = parseChangeSet('Sure!\n{"summary":"x","changes":[{"path":"a.ts","operation":"create","content":"hi"}],"notes":[]}\nDone.');
    expect(parsed.error).toBe("");
    expect(parsed.changes[0].path).toBe("a.ts");
  });

  it("reports a non-JSON reply as an error instead of guessing an edit", () => {
    const parsed = parseChangeSet("I changed src/a.ts to use the new flag.");
    expect(parsed.changes).toEqual([]);
    expect(parsed.error).toMatch(/JSON change set/);
    expect(parseChangeSet("").error).toMatch(/returned nothing/);
  });
});

describe("validateChangeSet", () => {
  const known = [
    { path: "src/a.ts", content: "line1\nline2\n", clipped: false },
    { path: "src/big.ts", content: "clipped…", clipped: true },
  ];

  it("builds a change set with real line counts and the original content", () => {
    const parsed = parseChangeSet(
      '```json\n{"summary":"s","changes":[{"path":"src/a.ts","operation":"update","content":"line1\\nline2\\nline3\\n","reason":"adds a line"}],"notes":[]}\n```'
    );
    const { changes, dropped } = validateChangeSet(parsed, known);
    expect(dropped).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: "src/a.ts", operation: "update", added: 1, removed: 0, original: "line1\nline2\n" });
  });

  it("refuses files that were never read, clipped files, unsafe paths and unknown operations", () => {
    const parsed = parseChangeSet(
      '```json\n{"changes":[' +
        '{"path":"src/never-read.ts","operation":"update","content":"x"},' +
        '{"path":"src/big.ts","operation":"update","content":"x"},' +
        '{"path":"../../etc/passwd","operation":"update","content":"x"},' +
        '{"path":"src/a.ts","operation":"frobnicate","content":"x"}' +
        "],\"notes\":[]}\n```"
    );
    const { changes, dropped } = validateChangeSet(parsed, known);
    expect(changes).toEqual([]);
    expect(dropped.join(" | ")).toMatch(/never read/);
    expect(dropped.join(" | ")).toMatch(/clipped/);
    expect(dropped.join(" | ")).toMatch(/unsafe path/);
    expect(dropped.join(" | ")).toMatch(/unknown operation/);
  });

  it("drops no-op updates, empty content and overflow", () => {
    const raw = {
      changes: [
        { path: "src/a.ts", operation: "update", content: "line1\nline2\n" }, // identical → no-op
        { path: "src/a.ts", operation: "update", content: "line1\nline2\nline3\n" }, // the real change
        { path: "src/never.ts", operation: "update", content: "" },
      ],
      notes: [],
    };
    const { changes, dropped } = validateChangeSet(parseChangeSet("```json\n" + JSON.stringify(raw) + "\n```"), known);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: "src/a.ts", added: 1, removed: 0 });
    expect(dropped.join(" | ")).toMatch(/identical/);
    expect(dropped.join(" | ")).toMatch(/never read/);

    const many = {
      changes: Array.from({ length: 9 }, (_, i) => ({ path: `src/f${i}.ts`, operation: "create", content: "x\n" })),
      notes: [],
    };
    const manyKnown = Array.from({ length: 9 }, (_, i) => ({ path: `src/f${i}.ts`, content: "", clipped: false }));
    const capped = validateChangeSet(parseChangeSet("```json\n" + JSON.stringify(many) + "\n```"), manyKnown);
    expect(capped.changes.length).toBe(MAX_EDIT_FILES);
    expect(capped.dropped.join(" | ")).toMatch(/capped at/);
  });

  it("keeps a create without an original and a delete without content", () => {
    const parsed = parseChangeSet(
      '```json\n{"changes":[{"path":"src/new.ts","operation":"create","content":"hello\\n"},{"path":"src/a.ts","operation":"delete"}]}\n```'
    );
    const { changes } = validateChangeSet(parsed, [...known, { path: "src/new.ts", content: "", clipped: false }]);
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.path === "src/new.ts")).toMatchObject({ operation: "create", original: "", added: 1, removed: 0 });
    expect(changes.find((c) => c.path === "src/a.ts")).toMatchObject({ operation: "delete", content: "", removed: 2 });
  });
});

describe("computeLineDiff / toHunks / lineDiff", () => {
  it("counts added and removed lines", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\n")).toEqual({ added: 1, removed: 1 });
    expect(lineDiff("a\n", "a\nb\n")).toEqual({ added: 1, removed: 0 });
    expect(lineDiff("a\nb\n", "a\n")).toEqual({ added: 0, removed: 1 });
    expect(lineDiff("same\n", "same\n")).toEqual({ added: 0, removed: 0 });
    expect(lineDiff("", "a\nb\n")).toEqual({ added: 2, removed: 0 });
  });

  it("produces a readable operation list", () => {
    const ops = computeLineDiff("a\nb\nc\n", "a\nc\nd\n");
    expect(ops).toEqual([
      { type: " ", line: "a" },
      { type: "-", line: "b" },
      { type: " ", line: "c" },
      { type: "+", line: "d" },
    ]);
  });

  it("groups changes into hunks with context and correct line numbers", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    const afterLines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    afterLines[10] = "CHANGED";
    const after = afterLines.join("\n") + "\n";
    const hunks = toHunks(computeLineDiff(before, after));
    expect(hunks).toHaveLength(1);
    // One changed line at before-line 11, with 3 lines of context either side.
    expect(hunks[0].beforeStart).toBe(8);
    expect(hunks[0].afterStart).toBe(8);
    expect(hunks[0].beforeCount).toBe(7);
    expect(hunks[0].afterCount).toBe(7);
    expect(hunks[0].lines.length).toBe(8); // 3 context + 1 removed + 1 added + 3 context
    expect(hunks[0].lines.some((l) => l.line === "CHANGED")).toBe(true);
    expect(hunks[0].lines[3]).toEqual({ type: "-", line: "line11" });
  });

  it("splits far-apart changes into separate hunks", () => {
    const before = Array.from({ length: 60 }, (_, i) => `l${i}`).join("\n");
    const after = before.split("\n").map((l, i) => (i === 2 || i === 50 ? l + "_x" : l)).join("\n");
    expect(toHunks(computeLineDiff(before, after))).toHaveLength(2);
  });

  it("returns no hunks for identical content", () => {
    expect(toHunks(computeLineDiff("a\n", "a\n"))).toEqual([]);
  });
});

describe("filePatch / buildPatch", () => {
  const update: FileChange = {
    path: "src/a.ts", operation: "update", content: "one\ntwo\nthree\n", original: "one\nTWO\nthree\n",
    added: 1, removed: 1, reason: "lowercase",
  };

  it("writes a git-style unified diff for an update", () => {
    const patch = filePatch(update);
    expect(patch).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(patch).toContain("--- a/src/a.ts");
    expect(patch).toContain("+++ b/src/a.ts");
    expect(patch).toMatch(/@@ -1,3 \+1,3 @@/);
    expect(patch).toContain("-TWO");
    expect(patch).toContain("+two");
  });

  it("marks new and deleted files the way git expects", () => {
    const created = filePatch({ path: "src/new.ts", operation: "create", content: "hello\n", original: "" });
    expect(created).toContain("new file mode 100644");
    expect(created).toContain("--- /dev/null");
    expect(created).toContain("@@ -0,0 +1,1 @@");
    expect(created).toContain("+hello");

    const deleted = filePatch({ path: "src/old.ts", operation: "delete", content: "", original: "bye\n" });
    expect(deleted).toContain("deleted file mode 100644");
    expect(deleted).toContain("+++ /dev/null");
    expect(deleted).toContain("@@ -1,1 +0,0 @@");
    expect(deleted).toContain("-bye");
  });

  it("emits nothing for a file with no changes, and the whole set otherwise", () => {
    expect(filePatch({ path: "x", operation: "update", content: "same\n", original: "same\n" })).toBe("");
    const patch = buildPatch([update, { path: "src/new.ts", operation: "create", content: "hi\n", original: "", added: 1, removed: 0, reason: "" }]);
    expect(patch.match(/diff --git/g)).toHaveLength(2);
    expect(buildPatch([])).toBe("");
    expect(buildPatch(undefined)).toBe("");
  });
});

describe("summaries", () => {
  const set: FileChange[] = [
    { path: "a.ts", operation: "update", content: "x\n", original: "y\n", added: 1, removed: 1, reason: "why" },
    { path: "b.ts", operation: "create", content: "z\n", original: "", added: 5, removed: 0, reason: "" },
  ];

  it("summarizes the change set", () => {
    expect(summarizeChangeSet(set)).toEqual({ files: 2, added: 6, removed: 1 });
    expect(summarizeChangeSet(undefined)).toEqual({ files: 0, added: 0, removed: 0 });
  });

  it("renders the Markdown a downstream box (Review) consumes", () => {
    const doc = renderChangeSet(set, "my change");
    expect(doc).toContain("# Change set — my change");
    expect(doc).toContain("2 file(s) · +6 −1");
    expect(doc).toContain("## a.ts (update, +1 −1)");
    expect(doc).toContain("why");
    expect(doc).toContain("```diff");
  });

  it("accounts for the stored size", () => {
    expect(changeSetChars(set)).toBe(2 + 2 + 2 + 0);
    expect(changeSetChars(undefined)).toBe(0);
  });
});

function data(patch: Partial<BoxData> = {}): BoxData {
  return { content: "", prompt: "", systemPrompt: "", output: "", status: "idle", ...patch } as BoxData;
}

describe("buildEditPrompt", () => {
  const files = [{ path: "src/a.ts", content: "export const x = 1;\n", clipped: false }];

  it("includes the change request, the tree and the current file contents", () => {
    const prompt = buildEditPrompt(
      { prompt: "Apply:\n{{inputs}}", repo: { slug: "o/r", branch: "main" }, tree: ["src/a.ts", "src/b.ts"], files },
      [{ name: "Request", output: "Rename x to y" }]
    );
    expect(prompt).toContain("Rename x to y");
    expect(prompt).toContain("## Repository\no/r@main");
    expect(prompt).toContain("src/b.ts");
    expect(prompt).toContain("#### src/a.ts (1 lines)");
    expect(prompt).toContain("export const x = 1;");
    expect(prompt).not.toContain("## Connected context"); // already in {{inputs}}
  });

  it("appends connected context the template did not reference", () => {
    const prompt = buildEditPrompt(
      { prompt: "Apply the request.", repo: null, tree: [], files, missing: ["src/big.ts"] },
      [{ name: "Plan", output: "Change src/a.ts to add a flag" }]
    );
    expect(prompt).toContain("## Connected context");
    expect(prompt).toContain("Plan:");
    expect(prompt).toContain("Files that could NOT be read");
    expect(prompt).toContain("- src/big.ts");
  });

  it("tells the model to change nothing when no file content was available", () => {
    const prompt = buildEditPrompt({ prompt: "Apply it", repo: null, fetchError: "Repository not found." }, []);
    expect(prompt).toContain("## Repository files");
    expect(prompt).toContain("Repository not found.");
    expect(prompt).toContain('Return an empty `changes` array');
  });
});
