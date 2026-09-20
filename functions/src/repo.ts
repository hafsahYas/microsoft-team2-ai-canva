/**
 * Repository digest for the Code Map box.
 *
 * Read-only GitHub access, deliberately narrow:
 *   - only github.com owner/repo references are accepted (never an arbitrary
 *     host, so the endpoint cannot be used as a request proxy);
 *   - the tree comes from ONE API call (`/git/trees/<branch>?recursive=1`),
 *     file contents come from raw.githubusercontent.com, which does not count
 *     against the API rate limit;
 *   - everything is capped (files, bytes per file, digest size, tree entries)
 *     so a huge repository degrades into an explicitly-truncated digest instead
 *     of an unbounded response.
 *
 * `GITHUB_TOKEN` is optional: public repositories work without it, and a token
 * unlocks private repositories and a much higher rate limit. The token is read
 * from the environment and never echoed back to the client.
 *
 * IMPORTANT: this file is duplicated as `server/src/repo.ts` (the API logic
 * is intentionally duplicated between the local Express server and the Cloud
 * Function). Keep the two in sync.
 */

/** A parsed GitHub repository reference. */
export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch/tag, or "" to use the repository's default branch. */
  branch: string;
}

/** One file's content, handed to the client in structured form (Code Edit). */
export interface RepoFileContent {
  path: string;
  content: string;
  /** True when the content was clipped — such a file must not be rewritten. */
  clipped: boolean;
}

/** What the endpoint returns to the client. */
export interface RepoDigest {
  repo: string;
  branch: string;
  /** The rendered digest the model reads (tree + selected file contents). */
  digest: string;
  /** Files whose contents are included in the digest. */
  files: number;
  /** Entries in the repository tree. */
  treeEntries: number;
  chars: number;
  truncated: boolean;
  /** Human-readable notes about what was skipped or capped. */
  notes: string[];
  /** The same contents in structured form (used by the Code Edit worker). */
  contents: RepoFileContent[];
  /** Requested paths (whole-file mode) that could not be read. */
  missing: string[];
}

// === Caps (all deliberately conservative) ===

export const MAX_FILES = 24;
/**
 * Per-file clip. A file bigger than this is still worth its head (module
 * comments, imports, the first definitions), so it is CLIPPED with a marker
 * rather than skipped — skipping big files is how an orientation brief ends up
 * missing the largest and often most interesting module.
 */
export const MAX_BYTES_PER_FILE = 20_000;
/** Above this, a file is assumed to be generated/bundled and is not downloaded. */
export const HARD_SKIP_BYTES = 400_000;
/**
 * Whole-file mode (the Code Edit box pins the paths it wants): an edit needs the
 * file in full, so the caps are per-file and total rather than a digest budget.
 * Anything still clipped is reported as clipped, and the box refuses to rewrite
 * a clipped file.
 */
export const MAX_EDIT_FILE_CHARS = 60_000;
export const MAX_EDIT_TOTAL_CHARS = 150_000;
export const MAX_EDIT_PATHS = 12;
export const MAX_DIGEST_CHARS = 60_000;
export const MAX_TREE_ENTRIES = 400;
/**
 * Category caps: a repository full of config files and tests must not crowd out
 * the source files that actually explain the system. Dependency manifests are
 * capped hardest — a monorepo has one per package, and the root one plus a couple
 * of packages is enough to see the stack.
 */
const MAX_DEP_MANIFESTS = 3;
const MAX_CONFIG_FILES = 4;
/** How many test files may be included (enough to reveal the framework). */
const MAX_TEST_FILES = 2;

/** Files fetched in parallel. */
const FETCH_CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 15_000;

/** GitHub names: letters, digits, `-`, `_`, `.` — no slashes, no spaces. */
const NAME = /^[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9_./-]+$/;

/**
 * Parses the reference forms the client may send. Returns null when the input is
 * not a plain GitHub owner/repo (so the route can answer 400 instead of fetching
 * something unexpected).
 */
export function parseRepoRef(input: unknown): RepoRef | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  const match = raw.match(
    /^(?:git@)?(?:https?:\/\/)?(?:www\.)?github\.com[/:]([^/\s#?]+)\/([^/\s#?]+)(.*)$/i
  );
  if (!match) {
    const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:[#@]([A-Za-z0-9_./-]+))?$/);
    if (!short) return null;
    return finish(short[1], short[2], short[3] || "");
  }

  const [, owner, repo, rest] = match;
  let branch = "";
  const tree = rest.match(/^\/(?:tree|blob)\/([^/\s#?]+)/i);
  if (tree) branch = tree[1];
  if (!branch) {
    const hash = rest.match(/#([A-Za-z0-9_./-]+)/);
    if (hash) branch = hash[1];
  }
  return finish(owner, repo, branch);
}

function finish(owner: string, repo: string, branch: string): RepoRef | null {
  const cleanRepo = repo.replace(/\.git$/i, "");
  if (!NAME.test(owner) || !NAME.test(cleanRepo) || !cleanRepo) return null;
  if (branch && !BRANCH.test(branch)) return null;
  return { owner, repo: cleanRepo, branch };
}

// === Path filtering ===

/** Directories that never belong in an orientation brief. */
const IGNORED_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage",
  "vendor", ".next", ".nuxt", ".output", ".cache", ".turbo", ".parcel-cache", "target",
  "__pycache__", ".venv", "venv", "env", ".idea", ".vscode", ".terraform", "pods",
  ".pytest_cache", ".mypy_cache", "storybook-static",
]);

/** Exact file names that are noise (lockfiles, generated metadata). */
const IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json",
  "cargo.lock", "poetry.lock", "pipfile.lock", "gemfile.lock", "composer.lock",
  "go.sum", "bun.lockb", "packages.lock.json", ".ds_store", "thumbs.db",
]);

/** Extensions whose contents are useless (or binary) in a text digest. */
const IGNORED_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "svg", "pdf", "zip", "gz",
  "tar", "tgz", "bz2", "7z", "rar", "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4",
  "mov", "avi", "wav", "ogg", "webm", "xls", "xlsx", "doc", "docx", "ppt", "pptx",
  "sqlite", "db", "bin", "exe", "dll", "so", "dylib", "class", "jar", "pyc", "snap",
  "map", "lock", "log", "min.js", "min.css",
]);

/** True when a path should never be fetched (build output, deps, binaries, locks). */
export function isIgnoredPath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  for (const segment of segments) {
    if (IGNORED_SEGMENTS.has(segment)) return true;
  }
  const base = segments[segments.length - 1] || "";
  if (IGNORED_FILES.has(base)) return true;
  // Hidden files are build/tooling noise, apart from the ones that describe the
  // project (`.eslintrc`, `.env.example`, …) — those are handled as manifests.
  if (base.startsWith(".") && !isManifestPath(path)) return true;
  const ext = base.includes(".") ? base.split(".").pop() as string : "";
  if (IGNORED_EXTS.has(ext)) return true;
  if (base.endsWith(".min.js") || base.endsWith(".min.css")) return true;
  return false;
}

/** Directories a requested path may never point into. */
const FORBIDDEN_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", "vendor", ".next",
  ".nuxt", "target", "__pycache__", ".venv", "venv", ".idea", ".vscode", ".terraform",
]);

/** True when a path is safe to read/request inside a repository. */
export function isSafeRepoPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  const p = path.trim();
  if (!p || p.length > 300) return false;
  if (p.startsWith("/") || p.startsWith("~") || p.startsWith(".")) return false;
  if (p.includes("\\") || p.includes("\u0000")) return false;
  if (/(^|\/)\.\.(\/|$)/.test(p)) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  for (const segment of p.split("/")) {
    if (FORBIDDEN_SEGMENTS.has(segment.toLowerCase())) return false;
  }
  return true;
}

/** True for test/spec/fixture files (capped separately). */
export function isTestPath(path: string): boolean {
  const base = path.split("/").pop() || "";
  return /(^|\.)(test|spec)\.[a-z]+$|_test\.(go|py|rb)$|(^|\/)tests?\/|__tests__|\.fixture\./i.test(base) ||
    /(^|\/)(tests?|__tests__|spec)\//i.test(path);
}

/** True for the files that describe the project (manifests, docs, CI, config). */
export function isManifestPath(path: string): boolean {
  const base = (path.split("/").pop() || "").toLowerCase();
  return (
    /^readme(\.|$)/.test(base) ||
    /^(package\.json|pyproject\.toml|setup\.py|requirements.*\.txt|pipfile|go\.mod|cargo\.toml|pom\.xml|build\.gradle|settings\.gradle|gemfile|composer\.json|mix\.exs|pubspec\.yaml)$/.test(base) ||
    /^(tsconfig.*\.json|jsconfig.*\.json|vite\.config\..*|webpack\.config\..*|rollup\.config\..*|next\.config\..*|nuxt\.config\..*|tailwind\.config\..*|postcss\.config\..*|babel\.config\..*|jest\.config\..*|vitest\.config\..*|playwright\.config\..*|eslint\.config\..*|\.eslintrc.*|firebase\.json|netlify\.toml|vercel\.json|dockerfile|docker-compose\.ya?ml|makefile|justfile|procfile|nginx\.conf)$/.test(base) ||
    /^\.env\.(example|sample|template)$/.test(base) ||
    path.toLowerCase().startsWith(".github/workflows/")
  );
}

const ENTRY_NAMES = /^(index|main|app|server|client|router|routes|cli|worker|manage)\.[a-z]+$/i;
/** Extensions that can meaningfully be an entry point (NOT `.css`, `.md`, …). */
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|kts|php|cs|swift|dart|ex|exs|scala|sh)$/i;

/** True for plausible process entry points. */
export function isEntryPointPath(path: string): boolean {
  const base = path.split("/").pop() || "";
  if (!CODE_EXT.test(base)) return false;
  // A basename like `client.js` / `server.py` only means "entry point" near the
  // top of the tree — `dsh-plugins/x/lib/client.js` is just a module.
  if (ENTRY_NAMES.test(base) && path.split("/").length <= 3) return true;
  return (
    /^(src|app|server|packages\/[^/]+\/src)\/(index|main)\.[a-z]+$/i.test(path) ||
    /^cmd\/[^/]+\/main\.go$/i.test(path) ||
    /^(src|app)\/App\.[jt]sx?$/i.test(path)
  );
}

/** Files that usually hold the shapes everything else depends on. */
const KEY_NAME = /(types?|schema|models?|store|state|api|client|config|constants|utils|helpers|service|core|lib|database|db|auth|hooks)\.[a-z]+$/i;

/** Directories whose files usually carry the system's architecture. */
const CODE_DIR = /(^|\/)(src|lib|app|server|api|functions|packages|core|services?)\//i;

/**
 * Value of a path for an orientation brief. Higher wins. Manifests are scored by
 * how much they actually tell you (a root README and the dependency manifest
 * first; a tailwind/postcss config far behind), and everything gets a depth
 * penalty so a root-level file beats an equally interesting nested one.
 */
export function scorePath(path: string): number {
  const base = (path.split("/").pop() || "").toLowerCase();
  const depth = path.split("/").length - 1;
  const depthPenalty = depth * 2;

  if (isManifestPath(path)) {
    let score = 30;
    if (/^readme(\.|$)/.test(base) && depth <= 1) score = 100;
    else if (isDependencyManifest(path)) score = depth <= 1 ? 95 : 75;
    else if (/\.github\/workflows\//.test(path.toLowerCase())) score = 60;
    else if (/^(dockerfile|docker-compose\..*|makefile|firebase\.json|\.env\.(example|sample|template))$/.test(base)) score = 70;
    else if (/^(tsconfig.*\.json|jsconfig.*\.json|vite\.config\..*|next\.config\..*|nuxt\.config\..*|webpack\.config\..*|rollup\.config\..*)$/.test(base)) score = 62;
    // Cosmetic/tooling configs (tailwind, postcss, eslint, prettier, …) say
    // little about what the system does.
    return score - depthPenalty;
  }

  // Orientation docs (especially at the root) explain the system better than most
  // config files.
  if (/\.(md|mdx|rst)$/i.test(base)) {
    if (/^(readme|agents|claude|architecture|overview|onboarding|getting-started|contributing)/.test(base)) {
      return (depth === 0 ? 90 : 70) - depthPenalty;
    }
    return (depth <= 1 ? 60 : 40) - depthPenalty;
  }

  if (isEntryPointPath(path)) {
    const inCodeDir = CODE_DIR.test(path);
    return (inCodeDir ? 90 : 72) - depthPenalty;
  }

  if (KEY_NAME.test(base)) return (CODE_DIR.test(path) ? 78 : 62) - depthPenalty;
  if (isTestPath(path)) return 45 - depthPenalty;
  if (CODE_DIR.test(path) && CODE_EXT.test(base)) return 58 - depthPenalty;
  if (CODE_EXT.test(base) || /\.(ya?ml|json|toml|sql|graphql|proto)$/i.test(base)) return 34 - depthPenalty;
  return 12 - depthPenalty;
}

/** True for the file that declares a package's dependencies. */
export function isDependencyManifest(path: string): boolean {
  const base = (path.split("/").pop() || "").toLowerCase();
  return /^(package\.json|pyproject\.toml|requirements.*\.txt|go\.mod|cargo\.toml|pom\.xml|build\.gradle|settings\.gradle|gemfile|composer\.json|setup\.py|pipfile|mix\.exs|pubspec\.yaml)$/.test(base);
}

/**
 * Picks which files to include in the digest: highest-value files first (README,
 * dependency manifests, entry points, central abstractions like `types`/`store`/
 * `api`), with category and per-directory caps so no single directory, config
 * cluster or test suite can consume the whole budget. Deterministic for a given
 * tree.
 */
export function selectFiles(tree: string[], opts: { maxFiles?: number } = {}): string[] {
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const candidates = tree
    .filter((p) => p && !p.endsWith("/") && !isIgnoredPath(p))
    .map((path) => ({ path, score: scorePath(path) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const picked: string[] = [];
  const perDir = new Map<string, number>();
  const perKind = new Map<string, number>();
  const dirOf = (path: string) => (path.includes("/") ? path.split("/").slice(0, -1).join("/") : ".");
  const kindOf = (path: string): "dep" | "config" | "test" | "other" => {
    if (isManifestPath(path)) return isDependencyManifest(path) ? "dep" : "config";
    if (isTestPath(path)) return "test";
    return "other";
  };
  const caps: Record<string, number> = { dep: MAX_DEP_MANIFESTS, config: MAX_CONFIG_FILES, test: MAX_TEST_FILES, other: Infinity };

  const take = (path: string, dirCap: number): boolean => {
    if (picked.length >= maxFiles || picked.includes(path)) return false;
    const dir = dirOf(path);
    if ((perDir.get(dir) || 0) >= dirCap) return false;
    const kind = kindOf(path);
    if ((perKind.get(kind) || 0) >= caps[kind]) return false;
    picked.push(path);
    perDir.set(dir, (perDir.get(dir) || 0) + 1);
    perKind.set(kind, (perKind.get(kind) || 0) + 1);
    return true;
  };

  // Pass 1: the files worth including on their own merit, in value order, with a
  // per-directory cap of 3 so one package cannot dominate the digest.
  for (const { path, score } of candidates) {
    if (picked.length >= maxFiles) break;
    if (score < 55) break;
    take(path, 3);
  }
  // Pass 2: breadth — fill the remaining budget from directories that have not
  // contributed yet, then let the biggest ones add a second file.
  for (const dirCap of [1, 2]) {
    for (const { path } of candidates) {
      if (picked.length >= maxFiles) break;
      take(path, dirCap);
    }
  }

  // Returned in VALUE order (highest first): the digest character budget is spent
  // in this order, so the files that explain the system get in before the budget
  // runs out. `renderDigest` re-sorts them by path for reading.
  return picked;
}

/** Extension → fence language for the digest's code blocks. */
function fenceLang(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", py: "python", rb: "ruby",
    go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", php: "php", cs: "csharp",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", sh: "bash", bash: "bash", zsh: "bash", sql: "sql",
    json: "json", yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml", html: "html", css: "css",
    scss: "scss", md: "markdown", dart: "dart", ex: "elixir", exs: "elixir", vue: "vue",
    svelte: "svelte", gradle: "groovy", properties: "properties", txt: "text",
  };
  return map[ext] || "";
}

/**
 * Renders the file tree as a nested listing with directory headers, capped at
 * `maxEntries` paths. Directory names are kept (a bare indented list of basenames
 * would lose which directory a file lives in).
 */
export function renderTree(paths: string[], maxEntries = MAX_TREE_ENTRIES): { text: string; shown: number } {
  const shownPaths = paths.slice(0, maxEntries);
  const lines: string[] = [];
  const seenDirs = new Set<string>();

  for (const path of shownPaths) {
    const parts = path.split("/");
    const dirs = parts.slice(0, -1);
    let walking = "";
    for (const dir of dirs) {
      walking = walking ? `${walking}/${dir}` : dir;
      if (seenDirs.has(walking)) continue;
      seenDirs.add(walking);
      lines.push("  ".repeat(walking.split("/").length - 1) + dir + "/");
    }
    lines.push("  ".repeat(dirs.length) + parts[parts.length - 1]);
  }

  if (paths.length > shownPaths.length) {
    lines.push(`… and ${paths.length - shownPaths.length} more path(s)`);
  }

  return { text: lines.join("\n"), shown: shownPaths.length };
}

/** Renders the digest the model reads. */
export function renderDigest(input: {
  ref: RepoRef;
  branch: string;
  tree: string[];
  files: { path: string; content: string }[];
  notes: string[];
  truncated: boolean;
}): string {
  const { text: treeText, shown } = renderTree(input.tree);
  const parts: string[] = [
    `Repository: ${input.ref.owner}/${input.ref.repo}@${input.branch}`,
    `Tree entries: ${input.tree.length}${shown < input.tree.length ? ` (first ${shown} shown)` : ""}`,
    `Files with contents included: ${input.files.length}`,
    "",
    "## File tree",
    "",
    treeText || "(no files)",
    "",
    "## File contents",
    "",
  ];
  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const kb = (Buffer.byteLength(file.content, "utf8") / 1024).toFixed(1);
    parts.push(`### ${file.path} (${kb} KB)`, "", "```" + fenceLang(file.path), file.content, "```", "");
  }
  if (input.notes.length > 0) {
    parts.push("## Digest notes", "", ...input.notes.map((n) => `- ${n}`), "");
  }
  return parts.join("\n").trim();
}

// === Fetching ===

/** Error carrying a message meant for the user. */
export class RepoError extends Error {}

function headers(token: string | undefined, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Accept: accept,
    "User-Agent": "ai-canva-code-map",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function get(url: string, token: string | undefined, accept?: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: headers(token, accept), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Maps GitHub's status codes onto messages a user can act on. */
export function describeHttpError(status: number, token: string | undefined): string {
  if (status === 404) {
    return token
      ? "Repository, branch or path not found — check the repository name and branch, and that the token can see it."
      : "Repository or branch not found. If it is private, set GITHUB_TOKEN on the server.";
  }
  if (status === 401) return "GitHub rejected the token (GITHUB_TOKEN is invalid or expired).";
  if (status === 403 || status === 429) {
    return token
      ? "GitHub rate limit or access restriction hit — try again shortly."
      : "GitHub rate limit reached (60 requests/hour without a token). Set GITHUB_TOKEN on the server for 5,000/hour.";
  }
  if (status === 451) return "GitHub refused to serve this repository for legal reasons.";
  return `GitHub returned HTTP ${status}.`;
}

/**
 * Fetches a repository and builds the digest: one API call for the tree (plus one
 * for the default branch when none was given), then the selected file contents
 * from raw.githubusercontent.com.
 */
export async function fetchRepoDigest(
  ref: RepoRef,
  opts: {
    token?: string;
    maxFiles?: number;
    maxChars?: number;
    /** Whole-file mode: read exactly these paths (the Code Edit box). */
    paths?: string[];
  } = {}
): Promise<RepoDigest> {
  const token = opts.token || undefined;
  const notes: string[] = [];
  const apiBase = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;

  let branch = ref.branch;
  if (!branch) {
    const metaRes = await get(apiBase, token);
    if (!metaRes.ok) throw new RepoError(describeHttpError(metaRes.status, token));
    const meta = (await metaRes.json()) as { default_branch?: string };
    branch = meta.default_branch || "main";
    notes.push(`No branch given — used the default branch "${branch}".`);
  }

  const treeRes = await get(`${apiBase}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
  if (!treeRes.ok) throw new RepoError(describeHttpError(treeRes.status, token));
  const treeBody = (await treeRes.json()) as {
    tree?: { path?: string; type?: string; size?: number }[];
    truncated?: boolean;
  };
  const entries = (treeBody.tree || []).filter((e) => e.type === "blob" && e.path);
  const allPaths = entries.map((e) => e.path as string);
  if (treeBody.truncated) {
    notes.push("GitHub truncated the tree itself (very large repository) — the map may miss files.");
  }
  if (allPaths.length === 0) throw new RepoError("This repository has no files to read.");

  const ignored = allPaths.filter(isIgnoredPath).length;
  if (ignored > 0) notes.push(`Ignored ${ignored} generated/binary/lock file(s) (build output, deps, images, lockfiles).`);

  // Whole-file mode ("read exactly these files") vs. digest mode ("pick the files
  // that explain this repository").
  const requested: string[] = [];
  for (const raw of opts.paths || []) {
    if (typeof raw !== "string") continue;
    const path = raw.trim().replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
    if (!isSafeRepoPath(path) || requested.includes(path)) continue;
    requested.push(path);
    if (requested.length >= MAX_EDIT_PATHS) break;
  }
  const wholeFiles = requested.length > 0;
  const inTree = new Set(allPaths);
  const missing = wholeFiles ? requested.filter((path) => !inTree.has(path)) : [];
  const selected = wholeFiles ? requested.filter((path) => inTree.has(path)) : selectFiles(allPaths, { maxFiles: opts.maxFiles });

  if (wholeFiles && missing.length > 0) {
    notes.push(`Requested path(s) not found in the tree: ${missing.slice(0, 8).join(", ")}.`);
  }

  const sizes = new Map(entries.map((e) => [e.path as string, e.size || 0]));

  const tooBig: string[] = [];
  const fetchable = selected.filter((path) => {
    const size = sizes.get(path) || 0;
    if (size > HARD_SKIP_BYTES) {
      tooBig.push(path);
      return false;
    }
    return true;
  });
  if (tooBig.length > 0) {
    notes.push(`Skipped ${tooBig.length} file(s) larger than ${Math.round(HARD_SKIP_BYTES / 1000)} KB (generated/bundled): ${tooBig.slice(0, 6).join(", ")}.`);
  }

  const maxChars = opts.maxChars ?? (wholeFiles ? MAX_EDIT_TOTAL_CHARS : MAX_DIGEST_CHARS);
  const perFileCap = wholeFiles ? MAX_EDIT_FILE_CHARS : MAX_BYTES_PER_FILE;
  const files: { path: string; content: string }[] = [];
  const failed: string[] = [];
  const clipped: string[] = [];
  let chars = 0;
  let truncated = false;

  // Fetch in small parallel batches so a big repository does not hit GitHub with
  // 24 simultaneous requests.
  for (let i = 0; i < fetchable.length; i += FETCH_CONCURRENCY) {
    if (chars >= maxChars) {
      truncated = true;
      notes.push(`Digest stopped at the ${Math.round(maxChars / 1000)}k character cap after ${files.length} file(s).`);
      break;
    }
    const batch = fetchable.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (path) => {
        const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(branch)}/${path}`;
        try {
          const res = await get(url, token, "text/plain");
          if (!res.ok) return { path, error: describeHttpError(res.status, token) as string };
          const text = await res.text();
          // A NUL byte is a reliable "this is binary" signal for text digests.
          if (text.includes("\u0000")) return { path, error: "binary content" };
          return { path, content: text };
        } catch (err: any) {
          return { path, error: err?.name === "AbortError" ? "timed out" : "fetch failed" };
        }
      })
    );
    for (const result of results) {
      if ("content" in result && typeof result.content === "string") {
        const remaining = maxChars - chars;
        const perFile = Math.min(perFileCap, remaining);
        let content = result.content;
        if (content.length > perFile) {
          content = content.slice(0, perFile) + `\n…[clipped at ${Math.round(perFile / 1000)} KB]`;
          clipped.push(result.path);
          truncated = true;
        }
        files.push({ path: result.path, content });
        chars += content.length;
      } else if ("error" in result) {
        failed.push(`${result.path} (${result.error})`);
      }
    }
  }

  if (clipped.length > 0) {
    notes.push(`Clipped ${clipped.length} large file(s) to the first ${Math.round(perFileCap / 1000)} KB: ${clipped.slice(0, 6).join(", ")}.`);
  }
  if (failed.length > 0) notes.push(`Could not read ${failed.length} file(s): ${failed.slice(0, 6).join(", ")}.`);
  if (truncated) notes.push("The digest was capped — it is NOT the whole repository.");

  const digest = renderDigest({ ref, branch, tree: allPaths, files, notes, truncated });
  const clippedSet = new Set(clipped);

  return {
    repo: `${ref.owner}/${ref.repo}`,
    branch,
    digest,
    files: files.length,
    treeEntries: allPaths.length,
    chars: digest.length,
    truncated,
    notes,
    // Structured contents for callers that edit files (the Code Edit worker);
    // `clipped` tells them a rewrite would lose the rest of the file.
    contents: files.map((file) => ({
      path: file.path,
      content: file.content,
      clipped: clippedSet.has(file.path),
    })),
    missing,
  };
}
