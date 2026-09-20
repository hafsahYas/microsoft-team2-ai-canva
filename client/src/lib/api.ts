const API_BASE = "/api";

export interface GenerateRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenerateResponse {
  content: string;
  model?: string;
  usage?: TokenUsage;
  error?: string;
}

/**
 * Calls the backend to generate text content via the Ollama backend.
 */
export async function generate(
  req: GenerateRequest
): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export interface GenerateImageRequest {
  prompt: string;
  imageUrl?: string;
}

export interface GenerateImageResponse {
  imageUrl: string;
  error?: string;
}

/**
 * Calls the backend to generate a cartoon profile image via fal.ai.
 * If imageUrl is provided, uses image-to-image (cartoonify).
 * Otherwise, uses text-to-image (flux schnell) as fallback.
 */
export async function generateImage(
  req: GenerateImageRequest
): Promise<GenerateImageResponse> {
  const res = await fetch(`${API_BASE}/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export interface StitchResponse {
  html: string;
  imageUrl: string;
  error?: string;
}

interface StitchJobResponse {
  jobId?: string;
  status: "queued" | "running" | "done" | "error";
  html?: string | null;
  imageUrl?: string | null;
  error?: string | null;
}

/**
 * Starts an asynchronous Stitch UI generation job.
 *
 * Stitch generation is slow (40s+), so the server returns immediately with a
 * job id and runs the work in the background. Callers then poll
 * `pollStitchJob` until it reports "done" or "error".
 */
export async function startStitchJob(prompt: string): Promise<string> {
  const res = await fetch(`${API_BASE}/stitch-generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as StitchJobResponse;
  if (!data.jobId) {
    throw new Error("Stitch did not return a job id.");
  }
  return data.jobId;
}

/**
 * Polls a Stitch job until it completes (done) or fails (error), returning the
 * generated HTML and screenshot URL. Throws on error or timeout.
 *
 * @param jobId - The job id returned by `startStitchJob`.
 * @param opts - Optional poll interval ms and max wait ms.
 */
export async function pollStitchJob(
  jobId: string,
  opts: { intervalMs?: number; maxWaitMs?: number } = {}
): Promise<StitchResponse> {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxWaitMs = opts.maxWaitMs ?? 10 * 60 * 1000; // 10 min safety ceiling
  const deadline = Date.now() + maxWaitMs;

  for (;;) {
    const status = await readStitchJob(jobId);
    if (status.status === "done") {
      if (!status.html) throw new Error("Stitch finished but returned no HTML.");
      return { html: status.html, imageUrl: status.imageUrl || "" };
    }
    if (status.status === "error") {
      throw new Error(status.error || "Stitch UI generation failed.");
    }
    if (Date.now() > deadline) {
      throw new Error("Stitch UI generation timed out.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function readStitchJob(jobId: string): Promise<StitchJobResponse> {
  const res = await fetch(`${API_BASE}/stitch-status/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Backwards-compatible single call: start a job and wait for it to finish. */
export async function generateStitchUI(
  prompt: string
): Promise<StitchResponse> {
  const jobId = await startStitchJob(prompt);
  return pollStitchJob(jobId);
}

export async function checkHealth(): Promise<{
  status: string;
  ollamaKey: string;
  falKey: string;
}> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

/** One file the backend read, in structured form (used by Code Edit). */
export interface RepoFileContent {
  path: string;
  content: string;
  /** True when the content was clipped — such a file must not be rewritten. */
  clipped: boolean;
}

/** What the backend read from a repository (see server/src/repo.ts). */
export interface RepoDigestResponse {
  ok?: boolean;
  repo: string;
  branch: string;
  /** The rendered digest (file tree + selected file contents) for the prompt. */
  digest: string;
  files: number;
  treeEntries: number;
  chars: number;
  truncated: boolean;
  notes: string[];
  /** The same contents in structured form. */
  contents: RepoFileContent[];
  /** Requested paths (whole-file mode) that could not be read. */
  missing: string[];
}

/**
 * Asks the backend for a repository digest (the Code Map box).
 *
 * The server does the GitHub access — the browser never calls GitHub directly,
 * so a server-side `GITHUB_TOKEN` (when configured) can unlock private
 * repositories without the token ever reaching the client.
 */
export async function fetchRepoDigest(repoUrl: string, paths?: string[]): Promise<RepoDigestResponse> {
  const res = await fetch(`${API_BASE}/repo-digest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paths && paths.length > 0 ? { repoUrl, paths } : { repoUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
/** One file published to a here.now Site. */
export interface DeployFilePayload {
  path: string;
  content: string;
}

/** What a here.now deploy returns (see server/src/herenow.ts). */
export interface DeployResponse {
  ok?: boolean;
  slug: string;
  siteUrl: string;
  /** Live version id — pass it back as `baseVersionId` to update safely. */
  versionId: string;
  unchanged: boolean;
  anonymous: boolean;
  /** ISO timestamp for an anonymous Site ("" when permanent). */
  expiresAt: string;
  /** Anonymous-only, returned ONCE — losing it means losing update access. */
  claimToken: string;
  claimUrl: string;
  warnings: string[];
  fileCount: number;
  bytes: number;
}

/**
 * Publishes files to a live here.now URL (the box deploy button).
 *
 * The backend does the publishing — the API key (when configured) stays
 * server-side. Without a key the Site is anonymous: it expires in 24 hours and
 * the returned claim token is the only way to update it afterwards.
 */
export async function publishSite(req: {
  files: DeployFilePayload[];
  slug?: string;
  claimToken?: string;
  baseVersionId?: string;
  displayName?: string;
  displayDescription?: string;
}): Promise<DeployResponse> {
  const res = await fetch(`${API_BASE}/herenow-deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
