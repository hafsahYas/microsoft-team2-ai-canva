/**
 * here.now deploy — publishing a box's code to a live URL.
 *
 * here.now is a static host for agents: publish a set of files and get
 * `https://{slug}.here.now/`. Publishing is a three-step flow, and a Site is NOT
 * live until the third step succeeds:
 *
 *   1. POST {base}/api/v1/publish          → a versionId + presigned upload URLs
 *   2. PUT each file's bytes to its URL    (straight to storage, not through here.now)
 *   3. POST the returned finalizeUrl       → the version goes live
 *
 * Anonymous Sites (no API key) expire after 24 hours and return a `claimToken` /
 * `claimUrl` EXACTLY ONCE — the caller has to keep them, because an anonymous
 * Site can only be updated with that claim token. With `HERENOW_API_KEY` set the
 * Site is permanent and belongs to the account instead.
 *
 * IMPORTANT: this file is duplicated as `functions/src/herenow.ts` (the API logic
 * is intentionally duplicated between the local Express server and the Cloud
 * Function). Keep the two in sync.
 */

/** One file to publish. */
export interface DeployFile {
  /** Site-relative path (`index.html` at the root, never leading-slash). */
  path: string;
  content: string;
  /** Optional; guessed from the extension when omitted. */
  contentType?: string;
}

/** What a successful deploy returns. */
export interface DeployResult {
  slug: string;
  siteUrl: string;
  /** Live version id — send it back as `baseVersionId` on the next update. */
  versionId: string;
  /** True when the content was byte-identical to what was already live. */
  unchanged: boolean;
  anonymous: boolean;
  /** ISO timestamp for an anonymous Site ("" when permanent). */
  expiresAt: string;
  /** Anonymous-only, returned once — the caller must store it or lose it. */
  claimToken: string;
  claimUrl: string;
  /** Non-fatal problems reported by finalize (e.g. an invalid manifest). */
  warnings: string[];
  fileCount: number;
  bytes: number;
}

// === Caps (our own, well inside here.now's 2,500 files / 10 GB) ===

export const MAX_DEPLOY_FILES = 400;
export const MAX_DEPLOY_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_DEPLOY_TOTAL_BYTES = 25 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * True when a path is safe to publish.
 *
 * `.herenow/` is refused on purpose: paths under it are reserved configuration
 * manifests (`.herenow/proxy.json`, `.herenow/data.json`) processed by here.now
 * rather than served — a generated box must never ship server-side configuration.
 */
export function isSafeSitePath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  const p = path.trim();
  if (!p || p.length > 200) return false;
  if (p.startsWith("/") || p.startsWith("~") || p.endsWith("/")) return false;
  if (p.includes("\\") || p.includes("\0")) return false;
  if (/(^|\/)\.\.(\/|$)/.test(p)) return false;
  if (p.startsWith(".")) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  return !/^\.herenow\//i.test(p) && !p.toLowerCase().startsWith(".herenow");
}

/** Content type for a file, from its extension. */
export function contentTypeFor(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    jsx: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    csv: "text/csv; charset=utf-8",
    patch: "text/plain; charset=utf-8",
    diff: "text/plain; charset=utf-8",
    yml: "text/yaml; charset=utf-8",
    yaml: "text/yaml; charset=utf-8",
    toml: "text/plain; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

/** Validates and normalizes a deploy file set. Throws a DeployError when it cannot ship. */
export function validateDeployFiles(files: DeployFile[]): { files: DeployFile[]; bytes: number } {
  if (!Array.isArray(files) || files.length === 0) {
    throw new DeployError("There is nothing to publish — this box has no code yet.");
  }
  if (files.length > MAX_DEPLOY_FILES) {
    throw new DeployError(`Too many files to publish (${files.length}; the limit is ${MAX_DEPLOY_FILES}).`);
  }

  const seen = new Set<string>();
  let bytes = 0;
  const out: DeployFile[] = [];

  for (const file of files) {
    // Normalize the friendly `./index.html` form BEFORE the safety gate, which
    // (correctly) refuses paths that start with a dot.
    const raw = typeof file?.path === "string" ? file.path.trim().replace(/^\.\//, "").replace(/\/{2,}/g, "/") : "";
    if (!isSafeSitePath(raw)) {
      throw new DeployError(`Refusing to publish the path "${String(file?.path)}" — paths must be site-relative and outside .herenow/.`);
    }
    const path = raw;
    if (seen.has(path)) throw new DeployError(`Duplicate path in the deploy set: ${path}`);
    seen.add(path);

    const content = typeof file.content === "string" ? file.content : "";
    const size = Buffer.byteLength(content, "utf8");
    if (size > MAX_DEPLOY_FILE_BYTES) {
      throw new DeployError(`${path} is ${(size / 1024 / 1024).toFixed(1)} MB — the per-file limit is ${MAX_DEPLOY_FILE_BYTES / 1024 / 1024} MB.`);
    }
    bytes += size;
    if (bytes > MAX_DEPLOY_TOTAL_BYTES) {
      throw new DeployError(`The deploy set is over ${MAX_DEPLOY_TOTAL_BYTES / 1024 / 1024} MB — publish less at once.`);
    }
    out.push({ path, content, contentType: file.contentType || contentTypeFor(path) });
  }

  // A site with no index.html still works (here.now renders a directory listing),
  // so this is only a nudge for the caller — not an error.
  return { files: out, bytes };
}

/** An error whose message is meant for the user. */
export class DeployError extends Error {}

/** Maps here.now's responses onto messages a user can act on. */
export function describeDeployError(status: number, body: { code?: string; message?: string; details?: Record<string, unknown> } | null): string {
  const code = body?.code || "";
  const serverMessage = body?.message ? ` ${body.message}` : "";
  if (code === "version_conflict") {
    const current = (body?.details?.currentVersionId as string) || "a newer version";
    const by = (body?.details?.currentVersionSource as string) || "someone else";
    return `This site has changed since it was deployed (live version ${current}, changed by ${by}). Redeploy to replace it, or review the live version first.`;
  }
  if (status === 401 || status === 403) {
    return `here.now refused the request (HTTP ${status}).${serverMessage} An anonymous deploy needs no key; a configured HERENOW_API_KEY may be invalid or expired.`;
  }
  if (status === 429) return `here.now rate-limited this deploy.${serverMessage} Try again shortly.`;
  if (status === 400) return `here.now rejected the deploy (HTTP 400).${serverMessage}`;
  if (status === 409) return `here.now reported a conflict (HTTP 409).${serverMessage}`;
  if (status >= 500) return `here.now had a server error (HTTP ${status}).${serverMessage} Try again shortly.`;
  return `here.now returned HTTP ${status}.${serverMessage}`;
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function request<T>(url: string, init: RequestInit, what: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    throw new DeployError(`${what} failed: ${err?.name === "AbortError" ? "timed out" : err?.message || "network error"}.`);
  } finally {
    clearTimeout(timer);
  }
  const body = await readJson(res);
  if (!res.ok) {
    // Prefix with the step so a failure says WHICH part broke (create vs upload
    // vs finalize) — "HTTP 403" alone does not tell anyone what to do.
    throw new DeployError(`${what}: ${describeDeployError(res.status, body)}`);
  }
  return body as T;
}

interface CreateResponse {
  slug?: string;
  siteUrl?: string;
  anonymous?: boolean;
  expiresAt?: string | null;
  claimToken?: string;
  claimUrl?: string;
  warning?: string;
  upload?: {
    versionId?: string;
    finalizeUrl?: string;
    uploads?: { path: string; method?: string; url: string; headers?: Record<string, string> }[];
    skipped?: string[];
  };
}

interface FinalizeResponse {
  success?: boolean;
  slug?: string;
  siteUrl?: string;
  currentVersionId?: string;
  unchanged?: boolean;
  replayed?: boolean;
  warnings?: string[];
}

/**
 * Publishes a set of files to here.now and returns the live URL.
 *
 * `slug` + `claimToken` update an existing Site (the claim token is what makes an
 * anonymous Site updatable); `baseVersionId` turns the update into an optimistic
 * concurrency check, so a Site someone else edited is never silently clobbered —
 * here.now answers 409 version_conflict and we relay that.
 */
export async function deploySite(opts: {
  files: DeployFile[];
  slug?: string;
  claimToken?: string;
  baseVersionId?: string;
  displayName?: string;
  displayDescription?: string;
  apiKey?: string;
  apiBase?: string;
}): Promise<DeployResult> {
  const { files, bytes } = validateDeployFiles(opts.files);
  const apiBase = (opts.apiBase || "https://here.now").replace(/\/+$/, "");
  const apiKey = opts.apiKey?.trim() || "";
  const updating = Boolean(opts.slug);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const payload: Record<string, unknown> = {
    files: files.map((file) => ({ path: file.path, size: Buffer.byteLength(file.content, "utf8"), contentType: file.contentType })),
  };
  if (opts.displayName) payload.displayName = opts.displayName.slice(0, 80);
  if (opts.displayDescription) payload.displayDescription = opts.displayDescription.slice(0, 280);
  if (updating) {
    if (opts.claimToken) payload.claimToken = opts.claimToken;
    if (opts.baseVersionId) payload.baseVersionId = opts.baseVersionId;
  }

  const created = await request<CreateResponse>(
    updating ? `${apiBase}/api/v1/publish/${encodeURIComponent(opts.slug as string)}` : `${apiBase}/api/v1/publish`,
    { method: updating ? "PUT" : "POST", headers, body: JSON.stringify(payload) },
    updating ? "The site update" : "The site create"
  );

  const upload = created.upload;
  if (!upload?.finalizeUrl) {
    throw new DeployError("here.now accepted the request but returned no upload targets — nothing was published.");
  }

  // Push every file's bytes to its presigned URL (these go to storage, not to
  // here.now itself).
  const targets = upload.uploads || [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const target of targets) {
    const file = byPath.get(target.path);
    if (!file) continue;
    const putHeaders: Record<string, string> = { ...(target.headers || {}) };
    if (file.contentType && !Object.keys(putHeaders).some((h) => h.toLowerCase() === "content-type")) {
      putHeaders["content-type"] = file.contentType;
    }
    await request(
      target.url,
      { method: target.method || "PUT", headers: putHeaders, body: file.content },
      `Uploading ${file.path}`
    );
  }

  // A Site is not live until this succeeds.
  const finalized = await request<FinalizeResponse>(
    upload.finalizeUrl,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ versionId: upload.versionId }),
    },
    "The publish finalize"
  );

  const warnings: string[] = [];
  if (Array.isArray(finalized.warnings)) warnings.push(...finalized.warnings.filter((w): w is string => typeof w === "string"));
  if (created.warning) warnings.push(created.warning);

  return {
    slug: finalized.slug || created.slug || opts.slug || "",
    siteUrl: finalized.siteUrl || created.siteUrl || "",
    versionId: finalized.currentVersionId || upload.versionId || "",
    unchanged: Boolean(finalized.unchanged),
    anonymous: created.anonymous !== false,
    expiresAt: created.expiresAt || "",
    claimToken: created.claimToken || "",
    claimUrl: created.claimUrl || "",
    warnings,
    fileCount: files.length,
    bytes,
  };
}
