import { onRequest } from "firebase-functions/v2/https";
import express, { type Request } from "express";
import cors from "cors";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { generateContent } from "./ollama.js";
import { generateCartoonImage } from "./fal.js";
import { enqueueStitchJob } from "./stitchJobs.js";
import { RepoError, fetchRepoDigest, parseRepoRef } from "./repo.js";
import { DeployError, deploySite, type DeployFile } from "./herenow.js";

// Initialize the Admin SDK (uses the Cloud Function's default credentials).
initializeApp();

/**
 * Counts registered users (and those created in the last `newWindowMs`) from
 * Firebase Authentication. Auth is the authoritative source of registered users —
 * the `users` collection only tracks login heartbeats and undercounts accounts
 * that signed up before client-side tracking existed.
 */
async function countAuthUsers(now: number, newWindowMs: number): Promise<{ total: number; newLast7d: number }> {
  const auth = getAuth();
  const cutoff = now - newWindowMs;
  let total = 0;
  let newLast7d = 0;
  let nextPageToken: string | undefined;
  do {
    const result = await auth.listUsers(1000, nextPageToken);
    for (const u of result.users) {
      total += 1;
      const createdMs = u.metadata?.creationTime
        ? new Date(u.metadata.creationTime).getTime()
        : 0;
      if (createdMs >= cutoff) newLast7d += 1;
    }
    nextPageToken = result.pageToken;
  } while (nextPageToken);
  return { total, newLast7d };
}

/**
 * Verifies that a request is from an admin. Returns the caller's UID on
 * success, or an error descriptor `{ status, error }` on failure.
 */
async function requireAdmin(req: Request): Promise<{ uid: string } | { status: number; error: string }> {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return { status: 401, error: "Missing authorization token" };
  }
  let uid: string;
  try {
    uid = (await getAuth().verifyIdToken(token)).uid;
  } catch {
    return { status: 401, error: "Invalid or expired token" };
  }
  const adminSnap = await getFirestore().doc(`admins/${uid}`).get();
  if (!adminSnap.exists) {
    return { status: 403, error: "Forbidden" };
  }
  return { uid };
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

app.post("/api/generate", async (req, res) => {
  try {
    const { systemPrompt, userPrompt } = req.body as { systemPrompt?: string; userPrompt?: string };
    if (!userPrompt || typeof userPrompt !== "string") {
      return res.status(400).json({ error: "userPrompt is required" });
    }
    const result = await generateContent(systemPrompt || "You are a helpful assistant.", userPrompt);
    res.json({
      content: result.content,
      model: result.model,
      usage: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      },
    });
  } catch (err: any) {
    console.error("[/api/generate] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to generate content" });
  }
});

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, imageUrl } = req.body as { prompt?: string; imageUrl?: string };
    if (!prompt && !imageUrl) {
      return res.status(400).json({ error: "Either prompt or imageUrl is required" });
    }
    const resultUrl = await generateCartoonImage({ prompt: prompt || "Cartoon style profile picture", imageUrl });
    res.json({ imageUrl: resultUrl });
  } catch (err: any) {
    console.error("[/api/generate-image] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to generate image" });
  }
});

app.post("/api/stitch-generate", async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }
    // Fire-and-return: enqueue a background job instead of blocking.
    // Stitch generation is slow (40s+) and would exceed the ~60s Firebase
    // Hosting rewrite timeout if we awaited it here.
    const jobId = await enqueueStitchJob(prompt);
    res.json({ jobId, status: "queued" });
  } catch (err: any) {
    console.error("[/api/stitch-generate] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to start UI generation" });
  }
});

/**
 * GET /api/stitch-status/:jobId
 * Returns the job state, including html/imageUrl when done.
 */
app.get("/api/stitch-status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({ error: "jobId is required" });
    }
    const snap = await getFirestore().doc(`stitchJobs/${jobId}`).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Job not found" });
    }
    const data = snap.data();
    if (!data) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json({
      status: data.status,
      html: data.html ?? null,
      imageUrl: data.imageUrl ?? null,
      error: data.error ?? null,
    });
  } catch (err: any) {
    console.error("[/api/stitch-status] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to read UI job" });
  }
});

/**
 * POST /api/repo-digest
 * Body: { repoUrl: string }   e.g. "https://github.com/owner/repo" or "owner/repo#branch"
 * Returns: { repo, branch, digest, files, treeEntries, chars, truncated, notes }
 *
 * Read-only GitHub access for the Code Map box (see ./repo.ts — keep it in sync
 * with server/src/repo.ts). Only github.com owner/repo references are accepted,
 * so this cannot be used as a general request proxy. `GITHUB_TOKEN` is optional
 * (public repos work without it; a token unlocks private repos + 5,000 req/hr).
 */
app.post("/api/repo-digest", async (req, res) => {
  const { repoUrl, paths } = req.body as { repoUrl?: string; paths?: unknown };
  const ref = parseRepoRef(repoUrl);
  if (!ref) {
    return res.status(400).json({
      error:
        "Provide a GitHub repository like https://github.com/owner/repo (or owner/repo, optionally owner/repo#branch).",
    });
  }
  try {
    // `paths` switches the endpoint into whole-file mode: the Code Edit box pins
    // the files it needs in full instead of asking for a ranked digest.
    const digest = await fetchRepoDigest(ref, {
      token: process.env.GITHUB_TOKEN,
      paths: Array.isArray(paths) ? (paths as string[]) : undefined,
    });
    res.json({ ok: true, ...digest });
  } catch (err: any) {
    const status = err instanceof RepoError ? 502 : 500;
    console.error("[/api/repo-digest] Error:", err.message);
    res.status(status).json({ error: err.message || "Failed to read the repository" });
  }
});

/**
 * POST /api/herenow-deploy
 * Body: { files: [{ path, content }], slug?, claimToken?, baseVersionId?, displayName?, displayDescription? }
 * Returns: { slug, siteUrl, versionId, unchanged, anonymous, expiresAt, claimToken, claimUrl, warnings, ... }
 *
 * Publishes a box's code to a live here.now URL (see ./herenow.ts — keep it in
 * sync with server/src/herenow.ts). Without HERENOW_API_KEY the Site is
 * anonymous: it expires in 24 hours, and the claimToken/claimUrl returned here
 * are the ONLY way to update that Site later.
 */
app.post("/api/herenow-deploy", async (req, res) => {
  const body = req.body as {
    files?: DeployFile[];
    slug?: string;
    claimToken?: string;
    baseVersionId?: string;
    displayName?: string;
    displayDescription?: string;
  };
  try {
    const result = await deploySite({
      files: Array.isArray(body?.files) ? body.files : [],
      slug: typeof body?.slug === "string" ? body.slug : undefined,
      claimToken: typeof body?.claimToken === "string" ? body.claimToken : undefined,
      baseVersionId: typeof body?.baseVersionId === "string" ? body.baseVersionId : undefined,
      displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
      displayDescription: typeof body?.displayDescription === "string" ? body.displayDescription : undefined,
      apiKey: process.env.HERENOW_API_KEY,
    });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err instanceof DeployError ? 400 : 500;
    console.error("[/api/herenow-deploy] Error:", err.message);
    res.status(status).json({ error: err.message || "Failed to publish the site" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    ollamaKey: process.env.OLLAMA_API_KEY ? "configured" : "missing",
    falKey: process.env.FAL_KEY ? "configured" : "missing",
    stitchKey: process.env.STITCH_API_KEY ? "configured" : "missing",
    // Optional: public repositories are read without it.
    githubToken: process.env.GITHUB_TOKEN ? "configured" : "optional",
    // Optional: without it, here.now deploys are anonymous (24h) Sites.
    herenowKey: process.env.HERENOW_API_KEY ? "configured" : "anonymous",
  });
});

/**
 * GET /api/admin/stats
 * Admin-only. Returns system-wide usage stats (users, boards, storage).
 *
 * Auth: `Authorization: Bearer <Firebase ID token>`. The caller must be an
 * admin (a doc must exist at `admins/{uid}`). Stats are computed with the
 * Admin SDK so sensitive aggregates are never exposed to client Firestore rules.
 */
app.get("/api/admin/stats", async (req, res) => {
  try {
    // Verify the caller is an admin.
    const auth = await requireAdmin(req);
    if ("status" in auth) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const db = getFirestore();
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

    // Total/new users come from Auth; active users come from the heartbeat
    // docs the client writes to the `users` collection. Boards/storage from
    // Firestore/Storage.
    const [authUsers, boardsTotal, boardsNew, usersActive] = await Promise.all([
      countAuthUsers(now, 7 * DAY_MS),
      db.collection("boards").count().get(),
      db.collection("boards").where("createdAt", ">=", now - 7 * DAY_MS).count().get(),
      db.collection("users").where("lastActive", ">=", now - ACTIVE_WINDOW_MS).count().get(),
    ]);

    // Storage usage: sum file sizes in the default bucket.
    let storageBytes = 0;
    let storageFiles = 0;
    const [files] = await getStorage().bucket().getFiles();
    for (const f of files) {
      storageBytes += Number(f.metadata?.size || 0);
      storageFiles += 1;
    }

    // LLM tokens used across all users (sum each user's rolling totals,
    // maintained client-side via Firestore increment).
    const tokenTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    try {
      const totalsSnap = await db.collection("usageTotals").get();
      totalsSnap.forEach((doc) => {
        const d = doc.data();
        tokenTotals.promptTokens += Number(d.promptTokens || 0);
        tokenTotals.completionTokens += Number(d.completionTokens || 0);
        tokenTotals.totalTokens += Number(d.totalTokens || 0);
      });
    } catch {
      // Leave totals at 0 on failure.
    }

    res.json({
      generatedAt: now,
      users: {
        total: authUsers.total,
        activeLast5m: usersActive.data().count,
        newLast7d: authUsers.newLast7d,
      },
      boards: {
        total: boardsTotal.data().count,
        newLast7d: boardsNew.data().count,
      },
      storage: { bytes: storageBytes, files: storageFiles },
      tokens: tokenTotals,
    });
  } catch (err: any) {
    console.error("[/api/admin/stats] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to load admin stats" });
  }
});

/**
 * GET /api/admin/users?pageToken=...
 * Admin-only. Lists registered users from Firebase Auth (paginated).
 */
app.get("/api/admin/users", async (req, res) => {
  try {
    const auth = await requireAdmin(req);
    if ("status" in auth) {
      return res.status(auth.status).json({ error: auth.error });
    }
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
    const result = await getAuth().listUsers(200, pageToken);

    // Load each user's token usage totals (usageTotals/{uid}) into a map to
    // join by uid. Kept separate (up/input vs down/output) because they cost
    // differently. Falls back to 0s if a user has no usage yet.
    const usageMap = new Map<string, { promptTokens: number; completionTokens: number; totalTokens: number }>();
    try {
      const totalsSnap = await getFirestore().collection("usageTotals").get();
      totalsSnap.forEach((d) => {
        const data = d.data();
        usageMap.set(d.id, {
          promptTokens: Number(data.promptTokens || 0),
          completionTokens: Number(data.completionTokens || 0),
          totalTokens: Number(data.totalTokens || 0),
        });
      });
    } catch {
      // Leave map empty; users will show 0 usage.
    }

    // Facilitator role markers, joined by uid (facilitators/{uid} docs).
    const facilitators = new Set<string>();
    try {
      const facSnap = await getFirestore().collection("facilitators").get();
      facSnap.forEach((d) => facilitators.add(d.id));
    } catch {
      // Leave empty; users will show as non-facilitators.
    }

    const users = result.users.map((u) => {
      const t = usageMap.get(u.uid) || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      return {
        uid: u.uid,
        email: u.email || "",
        displayName: u.displayName || u.email || "",
        photoURL: u.photoURL || "",
        disabled: !!u.disabled,
        facilitator: facilitators.has(u.uid),
        createdAt: u.metadata?.creationTime || null,
        lastSignIn: u.metadata?.lastSignInTime || null,
        tokens: t,
      };
    });
    res.json({ users, nextPageToken: result.pageToken || null });
  } catch (err: any) {
    console.error("[/api/admin/users] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to list users" });
  }
});

/**
 * POST /api/admin/users/:uid/status   { disabled: boolean }
 * Admin-only. Blocks (disabled: true) or unblocks (disabled: false) an account.
 * An admin cannot block their own account.
 */
app.post("/api/admin/users/:uid/status", async (req, res) => {
  try {
    const auth = await requireAdmin(req);
    if ("status" in auth) {
      return res.status(auth.status).json({ error: auth.error });
    }
    const { uid } = req.params;
    if (uid === auth.uid) {
      return res.status(400).json({ error: "You cannot block your own account" });
    }
    const disabled = Boolean(req.body?.disabled);
    await getAuth().updateUser(uid, { disabled });
    res.json({ uid, disabled });
  } catch (err: any) {
    if (err?.code === "auth/user-not-found") {
      return res.status(404).json({ error: "User not found" });
    }
    console.error("[/api/admin/users/:uid/status] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to update user" });
  }
});

/**
 * POST /api/admin/roles   { uid, role: "facilitator", grant: boolean }
 * Admin-only. Grants or revokes the facilitator role (facilitators/{uid}).
 */
app.post("/api/admin/roles", async (req, res) => {
  try {
    const auth = await requireAdmin(req);
    if ("status" in auth) {
      return res.status(auth.status).json({ error: auth.error });
    }
    const { uid, role, grant } = req.body || {};
    if (role !== "facilitator") {
      return res.status(400).json({ error: "Unsupported role" });
    }
    if (typeof uid !== "string" || !uid) {
      return res.status(400).json({ error: "Missing uid" });
    }
    const ref = getFirestore().doc(`facilitators/${uid}`);
    if (grant) {
      await ref.set({ grantedBy: auth.uid, grantedAt: Date.now() });
    } else {
      await ref.delete();
    }
    res.json({ uid, role, grant: !!grant });
  } catch (err: any) {
    console.error("[/api/admin/roles] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to update role" });
  }
});

/**
 * POST /api/workshop/join   { code }
 * Redeems a workshop seat code for a guest. Codes are durable credentials:
 * the FIRST redemption creates a dedicated guest auth user and binds it to
 * the code; every later redemption returns a fresh custom token for the
 * SAME uid, so guests keep their identity (profile, boards) on any device.
 * Uses the Admin SDK (custom token minting) — this endpoint exists only in
 * the Cloud Function; the local dev server proxies to it.
 */
app.post("/api/workshop/join", async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) {
      return res.status(400).json({ error: "Invalid code format" });
    }

    // Codes live at the top-level codes/{code} collection: a direct doc get
    // (no query — collection-group queries would need an index).
    const db = getFirestore();
    const codeRef = db.doc(`codes/${code}`);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
      return res.status(404).json({ error: "Unknown code — check with your facilitator" });
    }
    const codeData = codeSnap.data() as {
      code: string;
      teamId?: string;
      workshopId?: string;
      uid?: string;
      claimed?: boolean;
      claimedAt?: number;
    };
    const teamId = codeData.teamId;
    if (!teamId) {
      return res.status(500).json({ error: "Corrupt code record" });
    }
    const teamSnap = await db.doc(`teams/${teamId}`).get();
    if (!teamSnap.exists) {
      return res.status(404).json({ error: "This team no longer exists" });
    }
    const team = teamSnap.data() as { boardId?: string; name?: string; workshopName?: string; maxMembers?: number };

    // Enforce team capacity: count already-claimed codes for this team.
    // Single-field query (teamId) + client-side filter on claimed — avoids a
    // composite index; teams have at most 5 codes, so this is trivially cheap.
    const teamCodesSnap = await db.collection("codes").where("teamId", "==", teamId).get();
    const claimedCount = teamCodesSnap.docs.filter((d) => d.data()?.claimed).length;
    let guestUid = codeData.uid;

    if (!guestUid) {
      if (claimedCount >= (team.maxMembers ?? 5)) {
        return res.status(409).json({ error: "This team is full (5/5)" });
      }
      guestUid = `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        await getAuth().createUser({ uid: guestUid });
      } catch (e: any) {
        // uid collision is practically impossible; treat other errors as fatal
        if (e?.code !== "auth/uid-already-exists") throw e;
      }
      await codeRef.set(
        { uid: guestUid, claimed: true, claimedAt: Date.now() },
        { merge: true }
      );
      await db.doc(`users/${guestUid}`).set({
        guest: true,
        displayName: "",
        email: "",
        teamId,
        workshopId: codeData.workshopId || "",
        code,
        createdAt: Date.now(),
        lastActive: Date.now(),
      });
    }

    const token = await getAuth().createCustomToken(guestUid);
    res.json({
      token,
      isNew: !codeData.uid,
      teamId,
      workshopId: codeData.workshopId || "",
      teamName: team.name || "",
      workshopName: team.workshopName || "",
      boardId: team.boardId || "",
    });
  } catch (err: any) {
    console.error("[/api/workshop/join] Error:", err.message);
    res.status(500).json({ error: err.message || "Failed to join workshop" });
  }
});

export const api = onRequest({ maxInstances: 5, timeoutSeconds: 120, memory: "512MiB" }, app);

// Re-export the async Stitch Cloud Task worker so Firebase deploys it.
export { processStitchJob } from "./stitchJobs.js";