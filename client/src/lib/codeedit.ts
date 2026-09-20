import type { BoxData, FileChange, NamedInput } from "../types.js";
import { fillPromptTemplate } from "./prompts.js";

/**
 * Pure helpers for the Code Edit worker.
 *
 * The contract that makes this box trustworthy: the MODEL writes whole files,
 * the APP computes the diff and the patch. A model-authored unified diff can
 * silently drop hunks or disagree with what is displayed; whole-file content
 * cannot, and it means the `.patch` you download is provably the change you
 * reviewed.
 *
 * Everything here is deterministic and unit-tested — the store only orchestrates
 * the fetches and the model calls.
 */

/** Caps: how much of a repository edit the app will hold and display. */
export const MAX_EDIT_FILES = 5;
export const MAX_EDIT_FILE_CHARS = 24_000;
export const MAX_PINNED_PATHS = 12;
/** Directories a change set may never touch (build output, dependencies). */
const FORBIDDEN_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", "vendor", ".next",
  ".nuxt", "target", "__pycache__", ".venv", "venv", ".idea", ".vscode", ".terraform",
]);

/** True when a path is safe to touch inside a repository. */
export function isSafeRepoPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  const p = path.trim();
  if (!p || p.length > 300) return false;
  if (p.startsWith("/") || p.startsWith("~")) return false;
  if (p.includes("\\") || p.includes("\0")) return false;
  if (/(^|\/)\.\.(\/|$)/.test(p)) return false;
  if (/^[a-zA-Z]:/.test(p)) return false; // Windows drive
  const segments = p.split("/");
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment.toLowerCase())) return false;
  }
  return true;
}

/** Normalizes a path (`./a/b`, `a//b`, `a/b/`) into `a/b`. */
export function normalizeRepoPath(path: string): string {
  return path
    .trim()
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

/**
 * Parses a user-typed path list (newlines, commas or spaces) into safe, unique
 * repository paths.
 */
export function parsePathList(input: string | undefined, max = MAX_PINNED_PATHS): string[] {
  if (!input) return [];
  const tokens = input
    .split(/[\n,;]+|\s{2,}/)
    .flatMap((chunk) => chunk.split(/\s+/))
    .map((t) => t.trim().replace(/^[-*•]\s*/, ""));
  const out: string[] = [];
  for (const token of tokens) {
    const path = normalizeRepoPath(token.replace(/^`|`$/g, ""));
    if (!isSafeRepoPath(path) || out.includes(path)) continue;
    // A bare word with no separator and no extension is not a path.
    if (!path.includes("/") && !path.includes(".")) continue;
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Extracts the files an upstream SDLC Plan says will change — the plan stage's
 * `## Files to change` section is exactly a file list, so a Code Edit box
 * downstream of a plan needs no triage call at all.
 */
export function parsePlanFiles(planContent: string | undefined, max = MAX_PINNED_PATHS): string[] {
  if (!planContent) return [];
  const lines = planContent.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s*files?\b.*(change|touch|edit|modif)/i.test(l.trim()));
  const section = start === -1 ? [] : (() => {
    const body: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) break;
      body.push(lines[i]);
    }
    return body;
  })();

  const found: string[] = [];
  const push = (candidate: string) => {
    const path = normalizeRepoPath(candidate.replace(/^`|`$/g, "").replace(/[.,;:]$/, ""));
    if (!isSafeRepoPath(path) || found.includes(path)) return;
    if (!path.includes("/") && !path.includes(".")) return;
    found.push(path);
  };

  for (const raw of section) {
    const line = raw.trim();
    if (!line) continue;
    // `- \`src/x.ts\` — why`  |  `1. src/x.ts: why`  |  `src/x.ts — why`
    const bullet = line.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
    const body = bullet ? bullet[1].trim() : line;
    const fenced = body.match(/^`([^`]+)`/);
    if (fenced) {
      push(fenced[1]);
      continue;
    }
    const bare = body.match(/^([A-Za-z0-9_.@/-]+\/[A-Za-z0-9_.@/-]+|[\w-]+\.[A-Za-z0-9]{1,8})\b/);
    if (bare) push(bare[1]);
  }
  return found.slice(0, max);
}

/** The result of the triage call: which files to read before editing. */
export interface TriageResult {
  files: string[];
  plan: string;
}

/**
 * Parses the triage reply (the cheap "which files must be read?" call): a JSON
 * object with `files`, or — tolerantly — any paths it lists.
 */
export function parseTriage(text: string, max = MAX_PINNED_PATHS): TriageResult {
  const empty: TriageResult = { files: [], plan: "" };
  if (!text) return empty;

  const json = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].pop();
  const candidates: unknown[] = [];
  let plan = "";

  const body = json ? json[1] : text;
  try {
    const parsed = JSON.parse(body.trim());
    if (parsed && typeof parsed === "object") {
      const obj = parsed as { files?: unknown; plan?: unknown };
      if (Array.isArray(obj.files)) candidates.push(...obj.files);
      if (typeof obj.plan === "string") plan = obj.plan.trim();
    }
  } catch {
    // fall through to the path-scraping heuristic
  }

  const files = candidates.length > 0 ? candidates : scrapePaths(text);
  return { files: normalizePaths(files, max), plan };
}

function scrapePaths(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m =
      line.match(/^`([^`]+)`/) ||
      line.match(/^(?:[-*+]|\d+\.)\s+`([^`]+)`/) ||
      line.match(/^(?:[-*+]|\d+\.)\s+([A-Za-z0-9_.@/-]+(?:\.[A-Za-z0-9]{1,8})?)$/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Normalizes paths from UNTRUSTED sources (model output): raw paths are
 *  validated first, so `/etc/passwd` is refused rather than reinterpreted. */
function normalizePaths(paths: unknown[], max: number): string[] {
  const out: string[] = [];
  for (const candidate of paths) {
    if (typeof candidate !== "string") continue;
    const raw = candidate.replace(/^`|`$/g, "").trim();
    if (!isSafeRepoPath(raw)) continue;
    const path = normalizeRepoPath(raw);
    if (out.includes(path)) continue;
    if (!path.includes("/") && !path.includes(".")) continue;
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}

/** One raw change as the model returned it (before validation). */
interface RawChange {
  path: string;
  operation: string;
  content: string;
  reason: string;
}

/** The parsed shape of a model change-set reply. */
export interface ParsedChangeSet {
  summary: string;
  changes: RawChange[];
  notes: string[];
  /** Why parsing failed ("" when it succeeded). Surfaced to the user verbatim. */
  error: string;
}

/**
 * Parses the model's change set: one fenced JSON block (preferred — the prompt
 * demands it), tolerating a bare JSON object as well. A reply that is not JSON
 * is reported as an error rather than guessed at, because a guessed edit is
 * exactly what this box must never produce.
 */
export function parseChangeSet(text: string): ParsedChangeSet {
  const failed = (error: string): ParsedChangeSet => ({ summary: "", changes: [], notes: [], error });
  if (!text || !text.trim()) return failed("The model returned nothing.");

  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  const candidates = blocks.length > 0 ? [...blocks].reverse().map((b) => b[1]) : [text];

  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
        summary?: unknown;
        changes?: unknown;
        notes?: unknown;
      };
      if (!parsed || typeof parsed !== "object") continue;
      const changes: RawChange[] = [];
      for (const entry of Array.isArray(parsed.changes) ? parsed.changes : []) {
        if (!entry || typeof entry !== "object") continue;
        const c = entry as Record<string, unknown>;
        changes.push({
          path: typeof c.path === "string" ? c.path : "",
          operation: typeof c.operation === "string" ? c.operation : "update",
          content: typeof c.content === "string" ? c.content : "",
          reason: typeof c.reason === "string" ? c.reason : "",
        });
      }
      const notes = (Array.isArray(parsed.notes) ? parsed.notes : [])
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        .map((n) => n.trim());
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
        changes,
        notes,
        error: "",
      };
    } catch {
      // try the next candidate
    }
  }

  return failed(
    "The model's reply was not the JSON change set this box requires, so no edit was produced. Run it again, or simplify the change request."
  );
}

const OPERATIONS = new Set(["create", "update", "delete"]);

function normalizeOperation(raw: string): "create" | "update" | "delete" | null {
  const op = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (OPERATIONS.has(op)) return op as "create" | "update" | "delete";
  if (op === "edit" || op === "modify" || op === "change" || op === "replace") return "update";
  if (op === "add" || op === "new" || op === "createfile") return "create";
  if (op === "remove" || op === "deletefile") return "delete";
  return null;
}

/** What the app knows about a file before the edit (from the repository fetch). */
export interface KnownFile {
  path: string;
  content: string;
  /** True when the fetched content was clipped — such a file must not be edited. */
  clipped: boolean;
}

export interface ValidatedChangeSet {
  changes: FileChange[];
  /** Human-readable reasons why something was dropped — shown, never hidden. */
  dropped: string[];
}

/**
 * Turns the model's raw changes into a safe change set:
 * - paths must be safe and must have been read (never invent or touch a file the
 *   model never saw, and never edit a file whose content was clipped);
 * - a delete needs no content; a create/update needs some;
 * - oversized files keep the change but are reported, so the board never holds
 *   an unbounded blob silently;
 * - the file count is capped.
 */
export function validateChangeSet(
  parsed: ParsedChangeSet,
  known: KnownFile[],
  opts: { maxFiles?: number; maxFileChars?: number } = {}
): ValidatedChangeSet {
  const maxFiles = opts.maxFiles ?? MAX_EDIT_FILES;
  const maxFileChars = opts.maxFileChars ?? MAX_EDIT_FILE_CHARS;
  const byPath = new Map(known.map((f) => [f.path, f]));
  const seen = new Set<string>();
  const changes: FileChange[] = [];
  const dropped: string[] = [];

  for (const raw of parsed.changes) {
    if (!isSafeRepoPath(raw.path)) {
      dropped.push(`ignored an unsafe path: ${raw.path || "(empty)"}`);
      continue;
    }
    const path = normalizeRepoPath(raw.path);
    if (seen.has(path)) {
      dropped.push(`ignored a duplicate change for ${path}`);
      continue;
    }
    const knownFile = byPath.get(path);
    if (!knownFile) {
      dropped.push(`ignored a change to ${path} — that file's current content was never read`);
      continue;
    }
    if (knownFile.clipped) {
      dropped.push(`ignored a change to ${path} — its content was clipped, so a rewrite could lose the rest of the file`);
      continue;
    }
    const operation = normalizeOperation(raw.operation);
    if (!operation) {
      dropped.push(`ignored ${path} — unknown operation "${raw.operation}"`);
      continue;
    }
    if (operation !== "delete" && !raw.content.trim()) {
      dropped.push(`ignored ${path} — the reply contained no file content`);
      continue;
    }
    const content = operation === "delete" ? "" : raw.content;
    if (content.length > maxFileChars) {
      dropped.push(`ignored a change to ${path} — the new content is ${Math.round(content.length / 1000)}k characters (limit ${Math.round(maxFileChars / 1000)}k)`);
      continue;
    }
    if (operation === "update" && content === knownFile.content) {
      dropped.push(`${path} was reported as changed but is identical — left out of the change set`);
      continue;
    }
    if (changes.length >= maxFiles) {
      dropped.push(`ignored a change to ${path} — the change set is capped at ${maxFiles} files`);
      continue;
    }
    seen.add(path);
    const diff = lineDiff(operation === "create" ? "" : knownFile.content, content);
    changes.push({
      path,
      operation,
      content,
      original: operation === "create" ? "" : knownFile.content,
      added: diff.added,
      removed: diff.removed,
      reason: raw.reason.trim(),
    });
  }

  if (parsed.changes.length > 0 && changes.length === 0 && dropped.length === 0) {
    dropped.push("the model proposed no usable change");
  }

  return { changes, dropped };
}

// === Diffing (the app computes it, the model never writes a diff) ===

/** Total characters a change set may hold (the board document has limits). */
export const MAX_CHANGE_SET_CHARS = 240_000;

/** Number of context lines around each change in a patch hunk. */
const CONTEXT = 3;
/** Above this many lines, skip the exact diff and report a whole-file replace. */
const MAX_DIFF_LINES = 4_000;

type DiffOp = { type: " " | "-" | "+"; line: string };

/**
 * Splits text into lines the way a diff does: a trailing newline TERMINATES the
 * last line instead of creating an empty one ("a\nb\n" is two lines).
 */
export function splitLines(text: string): string[] {
  if (!text) return [];
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

/** Number of lines in a file's content ("" is 0 lines). */
export function countLines(text: string): number {
  return splitLines(text).length;
}

/**
 * Internal sentinel marking "the last line of this text has no newline".
 *
 * git treats a missing final newline as part of the line's content, so a line
 * whose newline status changes is not "unchanged" — without this, a patch would
 * claim a context line that git itself considers different, and `git apply`
 * refuses it (verified by src/lib/codeedit.patch.test.ts).
 */
const NO_NEWLINE = "\u0000";

function diffLines(text: string): string[] {
  const lines = splitLines(text);
  if (lines.length > 0 && !text.endsWith("\n")) lines[lines.length - 1] += NO_NEWLINE;
  return lines;
}

/** LCS line diff (falls back to a coarse replace for very large files). */
export function computeLineDiff(before: string, after: string): DiffOp[] {
  const a = diffLines(before);
  const b = diffLines(after);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [
      ...a.map((line) => ({ type: "-" as const, line })),
      ...b.map((line) => ({ type: "+" as const, line })),
    ];
  }

  // LCS table (rolling rows to keep memory sane).
  const m = a.length;
  const n = b.length;
  const table: Uint32Array[] = [];
  for (let i = 0; i <= m; i++) table.push(new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: " ", line: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "-", line: a[i] });
      i++;
    } else {
      ops.push({ type: "+", line: b[j] });
      j++;
    }
  }
  while (i < m) ops.push({ type: "-", line: a[i++] });
  while (j < n) ops.push({ type: "+", line: b[j++] });
  // The sentinel has done its job (it decided the comparison) — never let it
  // reach the patch or the screen.
  return ops.map((op) => ({ type: op.type, line: op.line.replace(/\u0000$/, "") }));
}

/** Added/removed line counts for a file list badge. */
export function lineDiff(before: string, after: string): { added: number; removed: number } {
  const ops = computeLineDiff(before, after);
  return {
    added: ops.filter((o) => o.type === "+").length,
    removed: ops.filter((o) => o.type === "-").length,
  };
}

interface Hunk {
  beforeStart: number;
  beforeCount: number;
  afterStart: number;
  afterCount: number;
  lines: DiffOp[];
}

/** Groups diff operations into hunks with CONTEXT lines around each change. */
export function toHunks(ops: DiffOp[]): Hunk[] {
  const changed = ops.map((op, index) => (op.type === " " ? -1 : index)).filter((i) => i >= 0);
  if (changed.length === 0) return [];

  const ranges: { start: number; end: number }[] = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(ops.length - 1, index + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }

  let beforeLine = 1;
  let afterLine = 1;
  const lineNumbers = ops.map((op) => {
    const at = { before: beforeLine, after: afterLine };
    if (op.type !== "+") beforeLine++;
    if (op.type !== "-") afterLine++;
    return at;
  });

  return ranges.map(({ start, end }) => {
    const lines = ops.slice(start, end + 1);
    return {
      beforeStart: lineNumbers[start].before,
      beforeCount: lines.filter((l) => l.type !== "+").length,
      afterStart: lineNumbers[start].after,
      afterCount: lines.filter((l) => l.type !== "-").length,
      lines,
    };
  });
}

/** Renders one file as a git unified-diff section (`git apply`-able). */
export function filePatch(change: Pick<FileChange, "path" | "operation" | "content" | "original">): string {
  const { path, operation, content, original } = change;
  const lines: string[] = [`diff --git a/${path} b/${path}`];

  if (operation === "create") {
    lines.push("new file mode 100644");
    lines.push("--- /dev/null");
    lines.push(`+++ b/${path}`);
    const body = splitLines(content);
    lines.push(`@@ -0,0 +1,${body.length} @@`);
    for (const line of body) lines.push("+" + line);
    if (body.length > 0 && !content.endsWith("\n")) lines.push("\\ No newline at end of file");
    return lines.join("\n") + "\n";
  }

  if (operation === "delete") {
    lines.push("deleted file mode 100644");
    lines.push(`--- a/${path}`);
    lines.push("+++ /dev/null");
    const body = splitLines(original);
    lines.push(`@@ -1,${body.length} +0,0 @@`);
    for (const line of body) lines.push("-" + line);
    if (body.length > 0 && !original.endsWith("\n")) lines.push("\\ No newline at end of file");
    return lines.join("\n") + "\n";
  }

  lines.push(`--- a/${path}`);
  lines.push(`+++ b/${path}`);
  const hunks = toHunks(computeLineDiff(original, content));
  if (hunks.length === 0) return "";
  hunks.forEach((hunk, index) => {
    // The hunk body is kept separate from the file header above: the header lines
    // start with `---` / `+++` and would otherwise be mistaken for content.
    const body: string[] = [];
    body.push(`@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`);
    for (const op of hunk.lines) body.push(op.type + op.line);

    // git wants "\ No newline at end of file" after the last line of EACH side
    // that lacks a final newline. That line can be an unchanged context line
    // (nothing added or removed at the tail), which is why this looks at those too.
    if (index === hunks.length - 1) {
      const lastOf = (prefix: string) => {
        for (let i = body.length - 1; i >= 1; i--) if (body[i].startsWith(prefix)) return i;
        return -1;
      };
      const contextTail = lastOf(" ");
      const targets = new Set<number>();
      if (content.length > 0 && !content.endsWith("\n")) {
        const at = lastOf("+");
        targets.add(at >= 0 ? at : contextTail);
      }
      if (original.length > 0 && !original.endsWith("\n")) {
        const at = lastOf("-");
        targets.add(at >= 0 ? at : contextTail);
      }
      // One marker per line, however many sides end there.
      [...targets].filter((at) => at >= 0).sort((a, b) => b - a).forEach((at) => {
        body.splice(at + 1, 0, "\\ No newline at end of file");
      });
    }

    lines.push(...body);
  });
  return lines.join("\n") + "\n";
}

/** The full patch for a change set — download it and `git apply` it. */
export function buildPatch(changeSet: FileChange[] | undefined): string {
  if (!changeSet || changeSet.length === 0) return "";
  return changeSet.map((change) => filePatch(change)).join("");
}

/** `+12 −4` style summary for the box header. */
export function summarizeChangeSet(changeSet: FileChange[] | undefined): {
  files: number;
  added: number;
  removed: number;
} {
  const list = changeSet || [];
  return {
    files: list.length,
    added: list.reduce((sum, c) => sum + c.added, 0),
    removed: list.reduce((sum, c) => sum + c.removed, 0),
  };
}

/**
 * The Markdown rendering of a change set. This is stored as the box's `output`,
 * so a downstream box (the SDLC Review stage, which consumes a diff) receives the
 * change through the normal `{{inputs}}` path.
 */
export function renderChangeSet(changeSet: FileChange[], summary: string): string {
  const totals = summarizeChangeSet(changeSet);
  const lines: string[] = [
    `# Change set — ${summary || `${totals.files} file${totals.files === 1 ? "" : "s"}`}`,
    "",
    `${totals.files} file(s) · +${totals.added} −${totals.removed}`,
    "",
  ];
  for (const change of changeSet) {
    lines.push(`## ${change.path} (${change.operation}, +${change.added} −${change.removed})`, "");
    if (change.reason) lines.push(change.reason, "");
    const patch = filePatch(change).trim();
    if (patch) lines.push("```diff", patch, "```", "");
  }
  return lines.join("\n").trim() + "\n";
}

/** Total characters a change set occupies (original + new content). */
export function changeSetChars(changeSet: FileChange[] | undefined): number {
  return (changeSet || []).reduce((sum, c) => sum + c.content.length + c.original.length, 0);
}

/**
 * Builds the prompt for the edit call: the user's template filled with the
 * change request and connected inputs, then the repository tree and the CURRENT
 * content of every file the model may touch (with explicit clipped/missing
 * warnings, so it never rewrites a file it could not fully see).
 */
export function buildEditPrompt(
  opts: {
    prompt: string;
    repo: { slug: string; branch: string } | null;
    tree?: string[];
    files?: KnownFile[];
    missing?: string[];
    fetchError?: string;
  },
  namedInputs: NamedInput[]
): string {
  let filled = fillPromptTemplate(opts.prompt, namedInputs);

  const context = namedInputs.filter((input) => {
    const text = (input.output || "").trim();
    return text.length > 0 && !filled.includes(text.slice(0, 80));
  });
  if (context.length > 0) {
    filled +=
      "\n\n## Connected context\n" +
      context.map((input) => `${input.name}:\n${input.output.trim()}`).join("\n\n---\n\n");
  }

  const repo = opts.repo;
  const tree = opts.tree || [];
  const files = opts.files || [];

  if (files.length === 0) {
    filled +=
      "\n\n## Repository files\n" +
      (opts.fetchError
        ? `The repository could not be read: ${opts.fetchError}\n`
        : "No file content was available for this change.\n") +
      "Without the current content of the files you cannot make this change. Return an empty " +
      "`changes` array and explain in `notes` which files you would need.";
    return filled;
  }

  filled +=
    `\n\n## Repository\n${repo ? `${repo.slug}@${repo.branch}` : "(unknown)"}\n` +
    `Only these files may be changed; their CURRENT content is below.\n`;

  if (tree.length > 0) {
    filled += `\n### File tree (${tree.length} entries)\n\n${tree.slice(0, 200).join("\n")}\n`;
  }

  filled += "\n### Current file contents\n";
  for (const file of files) {
    const lines = countLines(file.content);
    filled += `\n#### ${file.path} (${lines} lines)\n\n\`\`\`\n${file.content}\n\`\`\`\n`;
  }

  if ((opts.missing || []).length > 0) {
    filled +=
      "\n### Files that could NOT be read (do not touch these)\n" +
      (opts.missing || []).map((path) => `- ${path}`).join("\n") +
      "\n";
  }

  return filled;
}

/**
 * Convenience: the change request a Code Edit box is working from — its own
 * textarea, plus whatever is connected upstream.
 */
export function changeRequestText(data: BoxData, namedInputs: NamedInput[]): string {
  const own = (data.content || "").trim();
  const upstream = namedInputs
    .map((input) => (input.output || "").trim())
    .filter(Boolean)
    .join("\n\n");
  return [own, upstream].filter(Boolean).join("\n\n");
}
