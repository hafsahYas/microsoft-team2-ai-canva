# Backend API

The API surface is identical between the **local Express server** (`server/`) and the
**Firebase Cloud Function** (`functions/`). The client talks to it through the `/api` prefix
(proxied by Vite during development, or rewritten to the Cloud Function in production).

> **Security note:** These endpoints are **not authenticated** today. Anyone who can reach the
> server/function can trigger paid AI generations. Rate-limit or protect them before exposing a
> public deployment (see [OSS_READINESS.md](OSS_READINESS.md)).

## Endpoints

### `GET /api/health`

Lightweight health check. Returns which API keys are configured.

**Response**

```json
{
  "status": "ok",
  "ollamaKey": "configured" | "missing",
  "falKey": "configured" | "missing",
  "stitchKey": "configured" | "missing"
}
```

### `POST /api/generate`

Generate text via the **Ollama** backend. Used by all text-based AI boxes (Research, Summarize,
PRD, Dev Plan, Slides, Code, UI Design).

**Request body**

```json
{
  "systemPrompt": "string (optional, defaults to 'You are a helpful assistant.')",
  "userPrompt": "string (required)"
}
```

**Response** — `200`

```json
{
  "content": "string",
  "model": "deepseek-v4.1-flash",
  "usage": { "promptTokens": 120, "completionTokens": 450, "totalTokens": 570 }
}
```

`usage` reports the model's **token usage** for this call (`promptTokens` = input, `completionTokens`
= output) from Ollama's `prompt_eval_count` / `eval_count`. The client displays this per box and
persists it to Firestore (see "Token usage" below).

**Errors**

| Status | When |
|--------|------|
| `400` | `userPrompt` missing or not a string |
| `500` | Ollama call failed (e.g. missing `OLLAMA_API_KEY`) |

The model defaults to `deepseek-v4.1-flash` and can be overridden with `OLLAMA_MODEL`. Requests go to
`{OLLAMA_HOST}/api/chat` (default `https://ollama.com` for Ollama Cloud) authenticated with
`OLLAMA_API_KEY`.

### Token usage persistence

Token usage is recorded **client-side** (the client already knows the authenticated user), in two
places in Firestore:

- `tokenUsage/{autoId}` — one doc per call with `userId`, `boardId`, `boxId`, `boxType`, `model`,
  `promptTokens`, `completionTokens`, `totalTokens`, `createdAt`. Detailed history / aggregation.
- `usageTotals/{uid}` — per-user **rolling totals** (`promptTokens`, `completionTokens`,
  `totalTokens`, `updatedAt`) updated atomically via Firestore `increment`, so concurrent calls
  don't lose updates. The header's ⚡ count reads this.

Rules: a user can create/read their own `tokenUsage` docs and read/write their own `usageTotals`
doc. The admin function reads aggregate totals via the Admin SDK (bypasses rules).

### `POST /api/generate-image`

Generates a cartoon profile image with fal.ai. Used by the **Cartoon Profile** box.

- With `imageUrl` → image-to-image via `fal-ai/qwen-image-edit`.
- Without `imageUrl` → text-to-image via `fal-ai/flux/schnell`.

**Request body**

```json
{
  "prompt": "string (optional; defaults to 'Cartoon style profile picture')",
  "imageUrl": "string (optional; a public URL or base64 data URL)"
}
```

**Response** — `200`

```json
{ "imageUrl": "string" }
```

**Errors**

| `400` | Neither `prompt` nor `imageUrl` provided |
| `500` | fal.ai call failed (e.g. missing `FAL_KEY`) |

### `POST /api/stitch-generate`

Starts an asynchronous Google Stitch UI-generation job. Used by the **Stitch UI** box.

Stitch generation is slow (40s+), which previously exceeded the ~60s timeout Firebase Hosting
applies when rewriting `/api/**` to the Cloud Function. To avoid that, this endpoint does **not**
block on generation — it creates a job, kicks off the work asynchronously, and returns a `jobId`
immediately. The client polls [`GET /api/stitch-status/:jobId`](#get-apistitch-statusjobid).

**Request body**

```json
{ "prompt": "string (required)" }
```

**Response** — `200`

```json
{
  "jobId": "string",
  "status": "queued"
}
```

**Errors**

| `400` | `prompt` missing or not a string |
| `500` | Failed to start the job (e.g. missing `STITCH_API_KEY`) |

### `GET /api/stitch-status/:jobId`

Returns the state of an asynchronous Stitch job. The client polls this until status is `"done"` or
`"error"`.

**Response** — `200`

```json
{
  "status": "queued" | "running" | "done" | "error",
  "html": "string | null",
  "imageUrl": "string | null",
  "error": "string | null"
}
```

On the local server the job store is an in-memory map (dev-only). In production it is backed by
Firestore (`stitchJobs/{jobId}`) and the generation runs on a Cloud Task worker
(`processStitchJob`).

**Errors**

| `404` | Unknown `jobId` |
| `500` | Failed to read the job |

### `POST /api/repo-digest` — `{ repoUrl, paths? }`

Read-only GitHub access for the **Code Map** box: fetches a repository's file tree and the files
that explain it best, and returns a token-budgeted digest that the box feeds to the model.

**Request**

```json
{ "repoUrl": "https://github.com/owner/repo", "paths": ["src/app.ts"] }
```

`paths` is optional and switches the endpoint into **whole-file mode**, used by the Code Edit box:
exactly those paths are read, in full, instead of the ranked digest selection. Unsafe paths
(traversal, absolute, `node_modules`/`.git`/build output) are refused, requested paths that are not
in the tree come back in `missing`, and a file read beyond the per-file cap is returned with
`clipped: true` so the caller knows a rewrite would lose the rest of it (the box refuses to edit
those). Caps: 12 requested paths, 60k characters per file, 150k per response.

Accepted forms: a GitHub URL (with optional `/tree/<branch>`, `#branch`, `.git` or a trailing
slash), the `git@github.com:owner/repo.git` clone form, or the short `owner/repo`,
`owner/repo#branch`, `owner/repo@branch`. **Only github.com is accepted** — the endpoint cannot be
pointed at another host, so it is not a request proxy.

**Response** — `200`

```json
{
  "ok": true,
  "repo": "owner/repo",
  "branch": "main",
  "digest": "Repository: owner/repo@main\n\n## File tree\n…\n\n## File contents\n…",
  "files": 10,
  "treeEntries": 158,
  "chars": 71471,
  "truncated": true,
  "notes": ["Ignored 9 generated/binary/lock file(s)…", "Clipped 4 large file(s)…"],
  "contents": [{ "path": "src/app.ts", "content": "…", "clipped": false }],
  "missing": ["src/gone.ts"]
}
```

`contents` is the same set of files in structured form (the Code Edit box uses it); `missing` lists
requested paths that could not be read.

How the digest is built (see `server/src/repo.ts`, duplicated as `functions/src/repo.ts`):

- **One** API call for the tree (`/git/trees/<branch>?recursive=1`), plus one for the default
  branch when none was given; file contents come from `raw.githubusercontent.com`, which does not
  count against the API rate limit.
- Files are ranked: README and dependency manifests, then entry points, then central modules
  (`types`/`store`/`api`/`config`…), with per-directory and per-category caps — a monorepo's config
  cluster can't crowd out the code that explains the system.
- Directories that never belong in an orientation brief are dropped (`node_modules`, `dist`,
  `build`, `target`, `vendor`, `__pycache__`, …), as are binaries, lockfiles, source maps and
  minified files.
- Caps: 24 files, 20 KB per file (larger files are **clipped**, not skipped), 60k characters of
  file contents, 400 tree entries. Files over 400 KB are assumed generated and never downloaded.
  Every cap that bites is reported in `notes`, and the box tells the model the digest is partial so
  the brief can't claim completeness.

Text generation needs no key, so a **public repository works with no configuration**.

**Errors**

| `400` | `repoUrl` is missing or is not a GitHub repository reference |
| `502` | GitHub refused the request (not found, private without a token, rate limited, …) — the message says what to do |
| `500` | Unexpected failure while reading the repository |

### `POST /api/herenow-deploy` — `{ files, slug?, claimToken?, baseVersionId?, displayName?, displayDescription? }`

Publishes a box's code to a live **here.now** Site (the 🚀 Deploy button on the Code, UI Design,
Stitch UI and Code Edit boxes). here.now is a static host, so this is a real deployment: the box's
code becomes a URL at `https://{slug}.here.now/`.

**Request**

```json
{
  "files": [{ "path": "index.html", "content": "<!DOCTYPE html>…" }],
  "displayName": "Counter Box",
  "displayDescription": "Published from AI Canva (Code box)"
}
```

Send `slug` to update an existing Site. For an anonymous Site the update must also carry the
`claimToken` from the original deploy, and `baseVersionId` (the `versionId` returned then) is
strongly recommended: it makes the update an optimistic concurrency check, so a Site that changed
since — someone edited it in the here.now dashboard, another agent redeployed — is **refused with a
clear message instead of being silently replaced**.

**Response** — `200`

```json
{
  "ok": true,
  "slug": "cobalt-castle-y2d3",
  "siteUrl": "https://cobalt-castle-y2d3.here.now/",
  "versionId": "01M2DCFKWYPT7V63FJPK6Y1D5Y",
  "unchanged": false,
  "anonymous": true,
  "expiresAt": "2026-09-14T12:39:41.214Z",
  "claimToken": "y_Wu0ZyWf-pdH0sP",
  "claimUrl": "https://here.now/c/y_Wu0ZyWf-pdH0sP",
  "warnings": [],
  "fileCount": 2,
  "bytes": 3518
}
```

How it works (see `server/src/herenow.ts`, duplicated as `functions/src/herenow.ts`): here.now's
publish flow is **create → upload → finalize**, and a Site is not live until finalize succeeds. The
endpoint does all three server-side — the API key never reaches the browser — and it validates
everything first:

- files must be site-relative; **`.herenow/` paths are refused** (those are here.now configuration
  manifests, so a generated box can never ship server-side config), as are traversal and absolute
  paths;
- caps: 400 files, 8 MB per file, 25 MB total (well inside here.now's own 2,500 files / 10 GB);
- `warnings` from finalize are passed through rather than swallowed.

**Anonymous vs permanent:** without `HERENOW_API_KEY` the Site is anonymous — live immediately,
**expires after 24 hours**, and updatable only with the `claimToken`/`claimUrl`, which here.now
returns **exactly once**. With a key configured the Site is permanent and belongs to the account.

**Errors**

| `400` | Nothing to publish, an unsafe path, a cap exceeded, or here.now refused the deploy (the message says which step: create, upload or finalize) |
| `500` | Unexpected failure |

### `GET /api/admin/stats`

Admin-only. Returns system-wide usage stats (users, boards, storage). Requires the caller to be
an admin (a doc must exist at `admins/{uid}`) and to send a Firebase ID token.

**Auth**

```
Authorization: Bearer <Firebase ID token>
```

**Response** — `200`

```json
{
  "generatedAt": 1234567890,
  "users": { "total": 42, "activeLast5m": 3, "newLast7d": 5 },
  "boards": { "total": 12, "newLast7d": 2 },
  "storage": { "bytes": 123456, "files": 8 },
  "tokens": { "promptTokens": 1000, "completionTokens": 4500, "totalTokens": 5500 }
}
```

**Errors**

| Status | When |
|--------|------|
| `401` | Missing or invalid ID token |
| `403` | Caller is not an admin |
| `500` | Stats computation failed |
| `501` | Local dev server (admin stats are production-only) |

> **Note:** This endpoint is only implemented in the **Cloud Function** (`functions/`), which uses
> the Firebase Admin SDK. The local dev server (`server/`) returns `501` because it has no service
> account. Stats are computed server-side so sensitive aggregates are never exposed to client
> Firestore rules.
>
> **User counts:** `total` and `newLast7d` are counted from **Firebase Auth** (`listUsers`), the
> authoritative source of registered users. `activeLast5m` counts users whose `lastActive`
> heartbeat (written by the client to the `users` collection) is within the last 5 minutes.

### `GET /api/admin/users?pageToken=...`

Admin-only. Lists registered users from Firebase Auth (paginated, up to 200 per page).

**Auth**

```
Authorization: Bearer <Firebase ID token>
```

**Response** — `200`

```json
{
  "users": [
    {
      "uid": "abc123",
      "email": "user@example.com",
      "displayName": "Jane Doe",
      "photoURL": "https://...",
      "disabled": false,
      "createdAt": "2024-01-01T12:00:00.000Z",
      "lastSignIn": "2024-05-01T12:00:00.000Z",
      "tokens": { "promptTokens": 500, "completionTokens": 2000, "totalTokens": 2500 }
    }
  ],
  "nextPageToken": "token-or-null"
}
```

Pass `nextPageToken` in `?pageToken=` to fetch the next page.

`tokens` is each user's **cumulative token usage** — `promptTokens` is tokens **up** (input) and
`completionTokens` is tokens **down** (output), which cost differently. Admins see this per user in
the Admin Board's Users tab.

**Errors:** `401` missing/invalid token, `403` not an admin, `500` failure.

### `POST /api/admin/users/:uid/status`

Admin-only. Blocks (`{ "disabled": true }`) or unblocks (`{ "disabled": false }`) a user's account
via `auth.updateUser`. An admin cannot block their own account.

**Auth:** same `Authorization: Bearer <Firebase ID token>`.

**Request body**

```json
{ "disabled": true }
```

**Response** — `200`

```json
{ "uid": "abc123", "disabled": true }
```

**Errors**

| Status | When |
|--------|------|
| `400` | Trying to block your own account |
| `401` | Missing/invalid token |
| `403` | Not an admin |
| `404` | User not found |
| `500` | Update failed |

---

## Environment variables

| Variable            | Required for      | Description                                    |
| ------------------- | ----------------- | ---------------------------------------------- |
| `OLLAMA_API_KEY`    | Text boxes        | Ollama Cloud API key (https://ollama.com/settings/keys) |
| `OLLAMA_MODEL`      | Optional          | Model name (default `deepseek-v4.1-flash`)      |
| `OLLAMA_HOST`       | Optional          | Ollama host (default `https://ollama.com`)     |
| `FAL_KEY`           | Cartoon box       | fal.ai API key                                 |
| `STITCH_API_KEY`    | Stitch UI box     | Google Stitch API key                          |
| `GITHUB_TOKEN`      | Optional          | Code Map box — see below                       |
| `HERENOW_API_KEY`   | Optional          | Box deploys — anonymous 24h Sites without it    |
| `PORT`              | Optional (server) | Preferred server port (default `3001`)         |

**`HERENOW_API_KEY` is optional.** Without it, `POST /api/herenow-deploy` still works: it creates
an **anonymous** here.now Site, live immediately but expiring after 24 hours and updatable only with
the claim token returned once at deploy time. Adding a here.now API key makes deployed Sites
permanent and owned by the account. `/api/health` reports `herenowKey: "configured" | "anonymous"`.

**`GITHUB_TOKEN` is optional.** The Code Map box reads public repositories with no configuration
(60 requests/hour per IP, and file contents come from `raw.githubusercontent.com`, which is not
rate-limited). Setting a token unlocks **private repositories** and raises the API limit to 5,000
requests/hour; a personal access token with read-only access to the repositories you want to map is
enough (`public_repo`, or `repo` for private ones). It is read server-side only and is never sent to
the client — `/api/health` merely reports `githubToken: "configured" | "optional"`.

Copy the templates from `server/.env.example` / `functions/.env.example` into `.env` and fill in
real values.

> **Which model handles what?** See [docs/MODELS.md](MODELS.md) — the single source of truth for
> the model map (text / UI screens / images), how to switch, and the change log.

## Workshops (facilitator & guests)

### `POST /api/workshop/join` — `{ code }`

Redeems a workshop seat code for a guest — **no login required**. The first redemption creates a
dedicated guest auth user and binds it to the code; every later redemption returns a fresh Firebase
custom token for the SAME uid, so guests keep their identity and boards on any device. Codes are
8 characters (A–Z, 2–9). Capacity (max 5 per team) is enforced server-side.

- **Response:** `{ token, isNew, teamId, workshopId, teamName, workshopName, boardId }`
- **Errors:** `400` invalid code format · `404` unknown code / team gone · `409` team full (5/5)
- **Only in the Cloud Function** — the local dev server proxies this endpoint to the deployed
  function (custom-token minting needs the Admin SDK).

### `POST /api/admin/roles` — `{ uid, role: "facilitator", grant }`

Admin-only (Bearer ID token + `admins/{uid}`). Grants or revokes the facilitator role by
writing/deleting `facilitators/{uid}`. Cloud Function only (501 locally).

