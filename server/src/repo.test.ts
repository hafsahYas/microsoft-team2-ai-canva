import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BYTES_PER_FILE,
  MAX_EDIT_FILE_CHARS,
  isSafeRepoPath,
  RepoError,
  describeHttpError,
  fetchRepoDigest,
  isEntryPointPath,
  isIgnoredPath,
  isManifestPath,
  isTestPath,
  parseRepoRef,
  renderDigest,
  renderTree,
  scorePath,
  selectFiles,
} from "./repo.js";

/**
 * The Code Map box reads repositories through this module. Everything except
 * `fetchRepoDigest` is pure; that one is exercised with a stubbed `fetch`, so no
 * test touches the network.
 */

describe("parseRepoRef", () => {
  it("accepts the GitHub forms the client may send", () => {
    expect(parseRepoRef("https://github.com/alexbonti/ai-canva")).toEqual({ owner: "alexbonti", repo: "ai-canva", branch: "" });
    expect(parseRepoRef("github.com/alexbonti/ai-canva/")).toEqual({ owner: "alexbonti", repo: "ai-canva", branch: "" });
    expect(parseRepoRef("https://github.com/alexbonti/ai-canva.git")).toEqual({ owner: "alexbonti", repo: "ai-canva", branch: "" });
    expect(parseRepoRef("https://github.com/o/r/tree/develop")).toEqual({ owner: "o", repo: "r", branch: "develop" });
    expect(parseRepoRef("o/r#release-1")).toEqual({ owner: "o", repo: "r", branch: "release-1" });
    expect(parseRepoRef("alexbonti/ai-canva")).toEqual({ owner: "alexbonti", repo: "ai-canva", branch: "" });
  });

  it("rejects non-GitHub hosts and malformed refs (no request proxy)", () => {
    for (const bad of [
      "", "   ", undefined, null, 42,
      "https://evil.example.com/o/r",
      "https://gitlab.com/o/r",
      "https://github.com/onlyowner",
      "owner/../etc/passwd",
      "owner/re po",
    ]) {
      expect(parseRepoRef(bad as unknown)).toBeNull();
    }
  });
});

describe("path filtering", () => {
  it("ignores dependencies, build output, binaries and lockfiles", () => {
    for (const path of [
      "node_modules/react/index.js",
      "dist/index.js",
      "build/main.css",
      "coverage/lcov.info",
      ".git/config",
      "src/logo.png",
      "src/font.woff2",
      "package-lock.json",
      "pnpm-lock.yaml",
      "src/app.min.js",
      "src/app.js.map",
      "assets/report.pdf",
      "__pycache__/app.cpython-311.pyc",
    ]) {
      expect(isIgnoredPath(path), path).toBe(true);
    }
  });

  it("keeps real source, docs and describing config files", () => {
    for (const path of [
      "src/index.ts",
      "src/lib/store.ts",
      "README.md",
      "package.json",
      "tsconfig.json",
      "Dockerfile",
      ".github/workflows/ci.yml",
      ".env.example",
      ".eslintrc.json",
      "app/models/user.py",
      "cmd/server/main.go",
    ]) {
      expect(isIgnoredPath(path), path).toBe(false);
    }
  });

  it("classifies manifests, entry points and tests", () => {
    expect(isManifestPath("README.md")).toBe(true);
    expect(isManifestPath("package.json")).toBe(true);
    expect(isManifestPath("pyproject.toml")).toBe(true);
    expect(isManifestPath(".github/workflows/deploy.yml")).toBe(true);
    expect(isManifestPath("src/index.ts")).toBe(false);

    expect(isEntryPointPath("src/index.ts")).toBe(true);
    expect(isEntryPointPath("server/src/index.ts")).toBe(true);
    expect(isEntryPointPath("cmd/api/main.go")).toBe(true);
    expect(isEntryPointPath("src/components/Button.tsx")).toBe(false);

    expect(isTestPath("src/lib/repo.test.ts")).toBe(true);
    expect(isTestPath("tests/test_api.py")).toBe(true);
    expect(isTestPath("src/lib/repo.ts")).toBe(false);
  });
});

describe("selectFiles", () => {
  const tree = [
    "README.md",
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vitest.config.ts",
    "eslint.config.js",
    "firebase.json",
    "Dockerfile",
    ".github/workflows/ci.yml",
    ".env.example",
    "src/index.ts",
    "src/App.tsx",
    "src/store/boardStore.ts",
    "src/store/tokenStore.ts",
    "src/lib/prompts.ts",
    "src/lib/types.ts",
    "src/components/Canvas.tsx",
    "src/components/BoxNode.tsx",
    "server/src/index.ts",
    "server/src/app.ts",
    "server/src/ollama.ts",
    "functions/src/index.ts",
    "docs/ARCHITECTURE.md",
    "src/lib/repo.test.ts",
    "src/lib/slides.test.ts",
    "src/lib/timer.test.ts",
    "node_modules/react/index.js",
    "dist/index.js",
    "package-lock.json",
  ];

  it("leads with manifests and entry points, then spreads across directories", () => {
    const picked = selectFiles(tree);
    expect(picked).toContain("README.md");
    expect(picked).toContain("package.json");
    expect(picked).toContain("src/index.ts");
    expect(picked).toContain("server/src/index.ts");
    // Breadth: several different directories are represented, not just one.
    const dirs = new Set(picked.map((p) => p.split("/").slice(0, -1).join("/")));
    expect(dirs.size).toBeGreaterThanOrEqual(4);
    // Never the ignored ones.
    expect(picked.some((p) => p.includes("node_modules"))).toBe(false);
    expect(picked).not.toContain("package-lock.json");
    expect(picked).not.toContain("dist/index.js");
  });

  it("caps test files and the total file count", () => {
    const picked = selectFiles(tree);
    expect(picked.filter(isTestPath).length).toBeLessThanOrEqual(2);
    expect(picked.length).toBeLessThanOrEqual(24);
    expect(selectFiles(tree, { maxFiles: 5 }).length).toBeLessThanOrEqual(5);
  });

  it("is deterministic and prefers central-sounding source files", () => {
    const a = selectFiles(tree);
    const b = selectFiles(tree);
    expect(a).toEqual(b);
    expect(a).toContain("src/store/boardStore.ts");
  });

  it("leaves config files room but does not let them crowd out source", () => {
    const configHeavy = Array.from({ length: 30 }, (_, i) => `packages/p${i}/tsconfig.json`)
      .concat(Array.from({ length: 30 }, (_, i) => `packages/p${i}/src/index.ts`));
    const picked = selectFiles(configHeavy);
    expect(picked.filter((p) => p.endsWith("tsconfig.json")).length).toBeLessThanOrEqual(8);
    expect(picked.some((p) => p.endsWith("src/index.ts"))).toBe(true);
  });

  it("scores what explains the system above what merely configures it", () => {
    expect(scorePath("README.md")).toBeGreaterThan(scorePath("client/postcss.config.js"));
    expect(scorePath("package.json")).toBeGreaterThan(scorePath("client/tailwind.config.js"));
    expect(scorePath("server/src/app.ts")).toBeGreaterThan(scorePath("dsh-plugins/session-monitor/README.md"));
    expect(scorePath("client/src/store/boardStore.ts")).toBeGreaterThan(scorePath("client/src/index.css"));
    expect(scorePath("client/src/types.ts")).toBeGreaterThan(scorePath("client/vitest.config.ts"));
  });

  it("picks the architecture files of a real monorepo over cosmetic configs", () => {
    // A tree shaped like this repository, with a tight budget: the files that
    // explain the system must win over tooling configs and deep plugin noise.
    const monorepo = [
      "README.md", "AGENTS.md", "firebase.json", "package.json", "package-lock.json", ".gitignore",
      "client/package.json", "client/index.html", "client/postcss.config.js", "client/tailwind.config.js",
      "client/tsconfig.json", "client/vite.config.ts", "client/vitest.config.ts", "client/e2e.mjs",
      "client/src/index.css", "client/src/main.tsx", "client/src/App.tsx", "client/src/types.ts",
      "client/src/store/boardStore.ts", "client/src/lib/prompts.ts", "client/src/components/Canvas.tsx",
      "server/package.json", "server/src/index.ts", "server/src/app.ts", "server/src/ollama.ts",
      "functions/package.json", "functions/src/index.ts", "functions/src/repo.ts",
      "dsh-plugins/session-monitor/README.md", "dsh-plugins/session-monitor/lib/client.js",
      "docs/ARCHITECTURE.md", "docs/DEVLOG.md", "scripts/deploy.sh",
      "node_modules/react/index.js", "dist/index.js",
    ];
    const picked = selectFiles(monorepo, { maxFiles: 12 });

    for (const must of ["README.md", "client/src/types.ts", "client/src/store/boardStore.ts", "server/src/app.ts"]) {
      expect(picked, `expected ${must} in ${picked.join(", ")}`).toContain(must);
    }
    expect(picked).toContain("client/src/App.tsx");
    expect(picked.some((p) => p.startsWith("server/"))).toBe(true);
    expect(picked.some((p) => p.startsWith("functions/"))).toBe(true);
    // Tooling configs and deep plugin files lose to the architecture files.
    expect(picked).not.toContain("client/postcss.config.js");
    expect(picked).not.toContain("client/tailwind.config.js");
    expect(picked).not.toContain("dsh-plugins/session-monitor/lib/client.js");
    expect(picked).not.toContain("client/src/index.css");
    expect(picked.some((p) => p.includes("node_modules"))).toBe(false);
  });
});

describe("renderTree / renderDigest", () => {
  it("renders a nested tree with directory names, capped at the entry count", () => {
    const { text, shown } = renderTree(["README.md", "src/index.ts", "src/lib/prompts.ts"]);
    expect(shown).toBe(3);
    expect(text).toBe(["README.md", "src/", "  index.ts", "  lib/", "    prompts.ts"].join("\n"));

    const capped = renderTree(["README.md", "src/index.ts", "src/lib/prompts.ts"], 2);
    expect(capped.shown).toBe(2);
    expect(capped.text).toContain("… and 1 more path(s)");
    expect(capped.text).not.toContain("prompts.ts");
  });

  it("labels the digest with the ref, branch, counts, contents and notes", () => {
    const digest = renderDigest({
      ref: { owner: "o", repo: "r", branch: "main" },
      branch: "main",
      tree: ["src/index.ts", "README.md"],
      files: [{ path: "src/index.ts", content: "export const x = 1;" }],
      notes: ["Ignored 3 generated/binary/lock file(s)."],
      truncated: false,
    });
    expect(digest).toContain("Repository: o/r@main");
    expect(digest).toContain("Tree entries: 2");
    expect(digest).toContain("Files with contents included: 1");
    expect(digest).toContain("### src/index.ts");
    expect(digest).toContain("```ts");
    expect(digest).toContain("export const x = 1;");
    expect(digest).toContain("## Digest notes");
  });
});

describe("isSafeRepoPath", () => {
  it("accepts repository paths and refuses anything else", () => {
    for (const path of ["src/app.ts", "client/src/lib/repo.ts", "Dockerfile"]) expect(isSafeRepoPath(path), path).toBe(true);
    for (const path of ["", "/etc/passwd", "~/x", "../x.ts", "a/../../b", "node_modules/x.js", ".git/config", "C:\\x", "src\\win.ts", "a\u0000b", undefined, 42]) {
      expect(isSafeRepoPath(path as unknown), String(path)).toBe(false);
    }
  });
});

describe("describeHttpError", () => {
  it("tells the user what to do, and mentions the token when one is missing", () => {
    expect(describeHttpError(404, undefined)).toContain("GITHUB_TOKEN");
    expect(describeHttpError(404, "t")).toContain("not found");
    expect(describeHttpError(403, undefined)).toContain("60 requests/hour");
    expect(describeHttpError(403, "t")).toContain("rate limit");
    expect(describeHttpError(401, "t")).toContain("token");
    expect(describeHttpError(500, undefined)).toContain("HTTP 500");
  });
});

// === fetchRepoDigest with a stubbed network ===

const TREE = [
  { path: "README.md", type: "blob", size: 100 },
  { path: "package.json", type: "blob", size: 200 },
  { path: "src/index.ts", type: "blob", size: 120 },
  { path: "src/huge.ts", type: "blob", size: MAX_BYTES_PER_FILE + 1 },
  { path: "node_modules/react/index.js", type: "blob", size: 10 },
  { path: "package-lock.json", type: "blob", size: 9_000_000 },
  { path: "assets/logo.png", type: "blob", size: 5_000 },
];

function stubFetch(handlers: (url: string) => { status?: number; body?: unknown; text?: string; reject?: boolean }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const { status = 200, body, text, reject } = handlers(url);
    if (reject) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => text ?? "",
    } as unknown as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRepoDigest", () => {
  it("resolves the default branch, fetches the tree and the selected files, and notes what it dropped", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/repos/o/r")) return { body: { default_branch: "main" } };
      if (url.includes("/git/trees/")) return { body: { tree: TREE } };
      if (url.includes("README.md")) return { text: "# Project\nDoes things." };
      if (url.includes("package.json")) return { text: '{"name":"x"}' };
      if (url.includes("src/index.ts")) return { text: "export const start = () => {};" };
      if (url.includes("src/huge.ts")) return { text: "y".repeat(MAX_BYTES_PER_FILE + 5_000) };
      return { text: "" };
    });

    const digest = await fetchRepoDigest({ owner: "o", repo: "r", branch: "" });
    expect(digest.repo).toBe("o/r");
    expect(digest.branch).toBe("main");
    expect(digest.files).toBeGreaterThanOrEqual(3);
    expect(digest.treeEntries).toBe(TREE.length);
    expect(digest.digest).toContain("Does things.");
    expect(digest.digest).toContain("export const start");
    expect(digest.notes.join(" ")).toContain('default branch "main"');
    expect(digest.notes.join(" ")).toContain("Ignored");
    // A big file is CLIPPED, not skipped — its head is still informative.
    expect(digest.notes.join(" ")).toContain("Clipped 1 large file(s)");
    expect(digest.digest).toContain("[clipped at 20 KB]");
    // Only ONE API call for the tree + one for the metadata; contents come from raw.
    expect(calls.filter((c) => c.startsWith("https://api.github.com")).length).toBe(2);
    expect(calls.some((c) => c.startsWith("https://raw.githubusercontent.com/o/r/main/"))).toBe(true);
  });

  it("refuses to download absurdly large (generated/bundled) files", async () => {
    const fetched: string[] = [];
    stubFetch((url) => {
      fetched.push(url);
      if (url.includes("/git/trees/")) {
        return {
          body: {
            tree: [
              { path: "README.md", type: "blob", size: 10 },
              { path: "src/bundle.js", type: "blob", size: 500_000 },
            ],
          },
        };
      }
      return { text: "# Hi" };
    });
    const digest = await fetchRepoDigest({ owner: "o", repo: "r", branch: "main" });
    expect(digest.notes.join(" ")).toContain("generated/bundled");
    expect(fetched.some((u) => u.includes("src/bundle.js"))).toBe(false);
  });

  it("spends the character budget on the most valuable files first, not alphabetically", async () => {
    stubFetch((url) => {
      if (url.includes("/git/trees/")) {
        return {
          body: {
            tree: [
              { path: "aaa/notes.txt", type: "blob", size: 100 },
              { path: "server/src/app.ts", type: "blob", size: 100 },
              { path: "client/src/types.ts", type: "blob", size: 100 },
            ],
          },
        };
      }
      return { text: "x".repeat(80) };
    });
    const digest = await fetchRepoDigest({ owner: "o", repo: "r", branch: "main" }, { maxChars: 200 });
    expect(digest.digest).toContain("server/src/app.ts");
    expect(digest.digest).toContain("client/src/types.ts");
  });

  it("uses a given branch without asking for the default one", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/git/trees/develop")) return { body: { tree: TREE } };
      return { text: "content" };
    });
    const digest = await fetchRepoDigest({ owner: "o", repo: "r", branch: "develop" });
    expect(digest.branch).toBe("develop");
    expect(calls.some((c) => c.endsWith("/repos/o/r"))).toBe(false);
    expect(calls[0]).toContain("/git/trees/develop");
  });

  it("maps GitHub failures onto actionable errors", async () => {
    stubFetch(() => ({ status: 404 }));
    await expect(fetchRepoDigest({ owner: "o", repo: "nope", branch: "main" })).rejects.toThrow(RepoError);
    await expect(fetchRepoDigest({ owner: "o", repo: "nope", branch: "main" })).rejects.toThrow(/GITHUB_TOKEN/);

    stubFetch(() => ({ status: 403 }));
    await expect(fetchRepoDigest({ owner: "o", repo: "r", branch: "main" })).rejects.toThrow(/rate limit/i);

    stubFetch((url) => (url.includes("/git/trees/") ? { status: 500 } : { body: { default_branch: "main" } }));
    await expect(fetchRepoDigest({ owner: "o", repo: "r", branch: "" })).rejects.toThrow(/HTTP 500/);
  });

  it("reports unreadable files instead of failing the whole digest", async () => {
    stubFetch((url) => {
      if (url.includes("/git/trees/")) return { body: { tree: [TREE[0], TREE[2]] } };
      if (url.includes("src/index.ts")) return { status: 500 };
      return { text: "# Fine" };
    });
    const digest = await fetchRepoDigest({ owner: "o", repo: "r", branch: "main" });
    expect(digest.files).toBe(1);
    expect(digest.notes.join(" ")).toContain("Could not read 1 file(s)");
    expect(digest.digest).toContain("# Fine");
  });

  it("drops binary files and caps the digest when the budget runs out", async () => {
    stubFetch((url) => {
      if (url.includes("/git/trees/")) {
        return { body: { tree: [{ path: "a.ts", type: "blob", size: 10 }, { path: "b.ts", type: "blob", size: 10 }] } };
      }
      if (url.includes("b.ts")) return { text: "binary\u0000data" };
      return { text: "x".repeat(500) };
    });
    const capped = await fetchRepoDigest({ owner: "o", repo: "r", branch: "main" }, { maxChars: 100 });
    expect(capped.files).toBe(1);
    expect(capped.truncated).toBe(true);
    expect(capped.notes.join(" ")).toContain("Could not read 1 file(s)");
    expect(capped.notes.join(" ")).toContain("capped");
  });

  it("reads exactly the requested paths in whole-file mode (Code Edit)", async () => {
    const tree = [
      { path: "src/app.ts", type: "blob", size: 100 },
      { path: "src/big.ts", type: "blob", size: MAX_EDIT_FILE_CHARS + 500 },
      { path: "README.md", type: "blob", size: 50 },
    ];
    stubFetch((url) => {
      if (url.includes("/git/trees/")) return { body: { tree } };
      if (url.includes("big.ts")) return { text: "z".repeat(MAX_EDIT_FILE_CHARS + 200) };
      return { text: "export const x = 1;\n" };
    });

    const digest = await fetchRepoDigest({ owner: "o", repo: "r", branch: "main" }, { paths: ["src/app.ts", "src/big.ts", "src/gone.ts"] });
    expect(digest.contents.map((c) => c.path)).toEqual(["src/app.ts", "src/big.ts"]);
    expect(digest.contents.find((c) => c.path === "src/app.ts")).toMatchObject({ content: "export const x = 1;\n", clipped: false });
    // A file too big to hold in full is still returned, but flagged as clipped so
    // the caller refuses to rewrite it (a rewrite would lose the rest).
    expect(digest.contents.find((c) => c.path === "src/big.ts")?.clipped).toBe(true);
    expect(digest.missing).toEqual(["src/gone.ts"]);
    expect(digest.notes.join(" ")).toContain("src/gone.ts");
    // Whole-file mode ignores the digest ranking: README is not pulled in.
    expect(digest.contents.some((c) => c.path === "README.md")).toBe(false);
  });

  it("refuses unsafe or out-of-scope requested paths", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/git/trees/")) {
        return { body: { tree: [{ path: "src/app.ts", type: "blob", size: 10 }, { path: "node_modules/x.js", type: "blob", size: 10 }] } };
      }
      return { text: "content" };
    });
    const digest = await fetchRepoDigest(
      { owner: "o", repo: "r", branch: "main" },
      { paths: ["../etc/passwd", "/etc/passwd", "node_modules/x.js", "src/app.ts", "src/app.ts"] }
    );
    expect(digest.contents.map((c) => c.path)).toEqual(["src/app.ts"]);
    expect(calls.some((c) => c.includes("passwd") || c.includes("node_modules"))).toBe(false);
  });

  it("still returns structured contents for a ranked digest", async () => {
    stubFetch((url) => {
      if (url.includes("/git/trees/")) return { body: { tree: [{ path: "README.md", type: "blob", size: 10 }, { path: "src/index.ts", type: "blob", size: 10 }] } };
      return { text: "# hi" };
    });
    const digest = await fetchRepoDigest({ owner: "o", repo: "r", branch: "main" });
    expect(digest.missing).toEqual([]);
    expect(digest.contents.length).toBe(digest.files);
    expect(digest.contents.every((c) => c.clipped === false)).toBe(true);
  });

  it("never sends the token to a non-GitHub host and always sends it to GitHub", async () => {
    const seen: { url: string; auth?: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (url.includes("/git/trees/")) return { ok: true, status: 200, json: async () => ({ tree: [TREE[0]] }) } as unknown as Response;
      return { ok: true, status: 200, text: async () => "hi" } as unknown as Response;
    });
    await fetchRepoDigest({ owner: "o", repo: "r", branch: "main" }, { token: "secret-token" });
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call.url).toMatch(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//);
      expect(call.auth).toBe("Bearer secret-token");
    }
  });
});
