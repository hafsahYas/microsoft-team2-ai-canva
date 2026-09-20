import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPatch, parseChangeSet, summarizeChangeSet, validateChangeSet } from "./codeedit.js";

/**
 * The promise of the Code Edit box is that the `.patch` you download is exactly
 * the change you reviewed, and that it actually applies. These tests prove it
 * with REAL `git apply` in a throwaway repository, so the patch format can never
 * silently drift.
 *
 * Skipped when git is unavailable (nothing else in the suite needs it).
 */

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasGit = gitAvailable();
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A committed scratch repository with the given files. */
function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "codeedit-patch-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  run(["init", "-q"]);
  run(["add", "-A"]);
  run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return dir;
}

const read = (dir: string, rel: string) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), "utf8") : null);
const apply = (dir: string, patch: string) => {
  const patchPath = join(dir, "change.patch");
  writeFileSync(patchPath, patch);
  execFileSync("git", ["apply", "--check", "change.patch"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["apply", "change.patch"], { cwd: dir, stdio: "ignore" });
};

describe.skipIf(!hasGit)("codeedit patches apply with real git", () => {
  const base = {
    "src/app.ts": "export function main() {\n  return 1;\n}\n",
    "src/legacy.ts": "// old\n",
    "src/untouched.ts": "// never touched\n",
  };

  it("applies an update, a creation without a trailing newline, and a deletion", () => {
    const dir = makeRepo(base);
    const reply = "```json\n" + JSON.stringify({
      summary: "rename main and add a helper",
      changes: [
        { path: "src/app.ts", operation: "update", content: "export function start() {\n  return 1;\n}\n\nexport const helper = () => start();\n", reason: "rename" },
        { path: "src/helper.ts", operation: "create", content: "export const noNewlineAtEnd = true;", reason: "new module" },
        { path: "src/legacy.ts", operation: "delete", reason: "dead code" },
        { path: "src/untouched.ts", operation: "update", content: "// never touched\n", reason: "no-op" },
      ],
      notes: [],
    }) + "\n```";

    const known = Object.keys(base).concat("src/helper.ts").map((path) => ({
      path,
      content: read(dir, path) || "",
      clipped: false,
    }));
    const { changes, dropped } = validateChangeSet(parseChangeSet(reply), known);
    expect(summarizeChangeSet(changes)).toEqual({ files: 3, added: 4, removed: 2 });
    expect(dropped.join(" | ")).toMatch(/identical/); // the no-op file is never pushed

    apply(dir, buildPatch(changes));
    expect(read(dir, "src/app.ts")).toBe("export function start() {\n  return 1;\n}\n\nexport const helper = () => start();\n");
    expect(read(dir, "src/helper.ts")).toBe("export const noNewlineAtEnd = true;");
    expect(read(dir, "src/legacy.ts")).toBeNull();
    expect(read(dir, "src/untouched.ts")).toBe("// never touched\n");
  });

  it("applies a single-line change to a large file", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const dir = makeRepo({ "big.txt": lines.join("\n") + "\n" });
    const edited = [...lines];
    edited[150] = "line 151 CHANGED";
    const reply = "```json\n" + JSON.stringify({
      summary: "one line", changes: [{ path: "big.txt", operation: "update", content: edited.join("\n") + "\n", reason: "fix" }], notes: [],
    }) + "\n```";
    const { changes } = validateChangeSet(parseChangeSet(reply), [{ path: "big.txt", content: read(dir, "big.txt") || "", clipped: false }]);
    expect(changes[0]).toMatchObject({ added: 1, removed: 1 });

    apply(dir, buildPatch(changes));
    expect(read(dir, "big.txt")).toBe(edited.join("\n") + "\n");
    // Only one line changed on disk — git agrees with what the box displayed.
    const diff = execFileSync("git", ["diff", "--numstat"], { cwd: dir }).toString().trim();
    expect(diff).toBe("1\t1\tbig.txt");
  });

  it("keeps a file that does not end with a newline byte-identical after an edit", () => {
    const dir = makeRepo({ "noeol.txt": "first\nsecond" });
    const reply = "```json\n" + JSON.stringify({
      summary: "append", changes: [{ path: "noeol.txt", operation: "update", content: "first\nsecond\nthird", reason: "append" }], notes: [],
    }) + "\n```";
    const { changes } = validateChangeSet(parseChangeSet(reply), [{ path: "noeol.txt", content: read(dir, "noeol.txt") || "", clipped: false }]);
    apply(dir, buildPatch(changes));
    expect(read(dir, "noeol.txt")).toBe("first\nsecond\nthird");
  });
});
