# DEVLOG — Session Journal

Durable record of what each working session changed and what is in flight, so a **new session
can pick up cold in one read** (`AGENTS.md` first for durable knowledge, then this file for
current state).

> This file is about **state**, not knowledge. Conventions, architecture, and gotchas belong in
> `AGENTS.md`; "what were we doing / what's half-done / what's next" belongs here.

## How to use

- **Newest entries at the top** (directly below this guide).
- Append one entry per finished unit of work (feature, fix, deploy, investigation with a durable
  outcome) — not per chat message.
- Keep entries short. Use the template:

```markdown
## YYYY-MM-DD — short title

- **Done:** one to three lines, outcome-focused. Files/filesystems touched if non-obvious.
- **In flight:** partial work, uncommitted state, things deliberately left half-done (or "—").
- **Next steps:** what the next session should pick up first (or "—").
```

- Prune as you go: collapse entries older than ~a month to one line each — unless they describe
  work still in flight.
- If an entry reveals a durable convention or gotcha, promote it into `AGENTS.md` (per its
  maintenance rule) and keep only the state here.

---

## 2026-02-08 — Checklist box: a shared team to-do list on the board

- **Done:** New **Checklist** collaboration box (✅ `checklist`, palette "Collaboration", `roles:
  ["everyone"]`, `hasAI: false`) — a **shared team to-do list**: anyone on the board adds, assigns,
  renames, reorders, ticks off and deletes tasks, and everyone sees the same list live through the
  normal board save (last-write-wins, like a Note). Rows record `createdBy`/`createdAt` and, on a
  tick, `doneBy`/`doneAt` (shown as `✓ alice`); the panel header shows progress (`2 of 5 done` +
  bar). Tasks can be **pasted in bulk** (a multi-line paste appends every line, keeping Markdown
  `- [x]` state and stripping bullets/numbering), assigned via a picker built from the board's
  people (owner + collaborators + present users), reordered with ▲▼, exported with 📋 Copy
  (Markdown checklist) and pruned with 🧹 Clear done. All rules are pure functions in the new
  **`client/src/lib/checklist.ts`** (`appendChecklistItems`, `parseChecklistLines`,
  `toggleChecklistItem`, `setChecklistItemText`/`Assignee`, `moveChecklistItem`,
  `removeChecklistItem`, `clearDoneChecklistItems`, `checklistStats`, `checklistToMarkdown`,
  `normalizeChecklist`; caps 200 tasks × 500 chars so the board doc stays under Firestore's 1MB
  limit); rendering + store wiring is the new **`components/ChecklistPanel.tsx`** (owns its own
  store subscriptions — BoxNode must not subscribe to presence) over exactly ONE new store action
  `setChecklistItems` (which skips the write when a mutation changed nothing). `ChecklistItem`
  fields are **all always defined** (Firestore rejects nested `undefined`), the array is created
  empty-but-defined, and `normalizeChecklist` repairs anything loaded from an older board.
  Registered in `Canvas.tsx` (nodeTypes + minimap), gated as a utility box in `BoxNode.tsx`
  (no Run/⚙/handles) with a `runBox` early-return, and **excluded from `AGENT_CREATABLE_TYPES`**
  (locked by a new unit test, like the SDLC stages).
- **Also fixed (found by a numeric layout probe, not by guessing):** collaboration boxes rendered
  the generic output block and its **"No output yet. Click Run to generate."** placeholder under
  their own body — the timer has been showing that since it was built. Both blocks are now gated on
  `!isUtility`, so a collab box has exactly one child (its own panel) and no outer scroll.
- **Tests:** **269 client tests** (37 new in `lib/checklist.test.ts`: paste parsing incl. bullets/
  numbering/hyphenated text, caps, attribution on toggle, reorder edges, stats, Markdown export,
  `normalizeChecklist` repair/idempotence) + **105/105** in `client/e2e.mjs` — 13 new "TC" checks
  (palette → panel → typed tasks → multi-line paste with done state → attribution → progress line →
  assignment → ▼ reorder → clear done → ✕ delete → the no-Run/no-handles contract → every field
  defined) and 9 new "T15" checks driving **two real signed-in users on one real Firestore board**:
  B adds the box and a task, A sees it, **A ticks it and B sees it ticked WITH A's attribution**,
  B assigns a task to A (picker lists both members), A's pasted list reaches B, and the list
  **survives a reload** with state, assignee and attribution intact (no Firestore `undefined`).
  `npx tsc --noEmit` clean, `npm run build` clean.
- **In flight:** —.
- **Next steps:** — (possible follow-ups, none needed now: let a Checklist feed an AI box as a
  `{{inputs}}` source, or per-person "my tasks" filtering in the footer).

---

## 2026-02-08 — Deploy: Code Map worker + `/api/repo-digest` live on carbondocs

- **Done:** `bash scripts/deploy.sh` to `carbondocs` from commit `2da51db` — Hosting released (new
  entry `assets/index-MPiINrYV.js`, same hash as the local build) **and Cloud Functions updated**
  (`api` + `processStitchJob`), which this feature needed: `/api/repo-digest` does not exist in
  production without them. Verified live: `/api/health` → `githubToken: "optional"`;
  `POST /api/repo-digest` against a real public repo returned 200 in 1.8s (10 files of 163, 73k
  chars, capped, with the clip/ignore notes); a non-GitHub URL was rejected with the 400 guard
  message (the endpoint is not a request proxy); `/api/generate` still answers; and the served
  bundle contains the box (`codemap`, `Code Map`, `repo-digest`, `code-map.md`, `Digest notes`).
  **No `GITHUB_TOKEN` was set** (decided: public repos are enough for now) — private repositories
  and the higher rate limit need it added to `functions/.env` and a re-deploy.
- **In flight:** —.
- **Next steps:** — (optional: add `GITHUB_TOKEN` to `functions/.env` + `server/.env` for private
  repos).

---

## 2026-02-08 — Deploy: box deploys (here.now) live on carbondocs

- **Done:** `bash scripts/deploy.sh` to `carbondocs` from commit `dbe3474` — Hosting released (new
  entry `assets/index-DG1Ejgbo.js`) **and Cloud Functions updated** (`api` + `processStitchJob`),
  which this needed: `/api/herenow-deploy` did not exist in production before. This deploy also
  shipped the parallel session's Checklist box, since both features are in that commit.
- **Verified live:** `/api/health` → `herenowKey: "anonymous"`; the served bundle contains the
  deploy UI (`herenow-deploy`, `🚀 Deploy` ×2, `Live site`, `Show claim link`); and a **real publish
  through the production Cloud Function** succeeded — a one-file Site went live at
  https://astral-tassel-fc35.here.now/ (HTTP 200, content served), which also proves the function's egress reaches both
  here.now and the storage upload host. `GITHUB_TOKEN`/`HERENOW_API_KEY` remain unset (public repos +
  anonymous 24h Sites).
- **In flight:** —.
- **Next steps:** — (optional: add `HERENOW_API_KEY` for permanent Sites).

## 2026-02-08 — here.now deploy: boxes that contain code can publish to a live URL

- **Done (collision-free half):** new **`POST /api/herenow-deploy`** in both backends, backed by a
  new duplicated module `server/src/herenow.ts` + `functions/src/herenow.ts`: here.now's three-step
  publish flow (**create → upload to presigned targets → finalize** — a Site is not live until
  finalize succeeds) run server-side, so the API key never reaches the browser. Validation before
  any request: site-relative paths only, **`.herenow/` paths refused** (they are here.now
  configuration manifests — a generated box must never ship server-side config), traversal/absolute
  paths refused, caps of 400 files / 8 MB per file / 25 MB total, and finalize `warnings` passed
  through instead of swallowed. Updates take `slug` + `claimToken` (anonymous Sites are updatable
  only with it) and `baseVersionId`, which turns an update into an optimistic concurrency check:
  a Site someone else changed is **refused with a message naming the live version**, never silently
  replaced. New pure client module `client/src/lib/deploy.ts` (+ 10 tests) decides what each box
  publishes: Code/UI → `index.html` (the same CDN-wrapped page the box previews) + `App.jsx`,
  Stitch → its HTML as-is, Code Edit → the changed files at their repository paths + `CHANGES.md`.
  Added `publishSite()` to `lib/api.ts`, `herenowKey` to `/api/health`, `HERENOW_API_KEY` to both
  `.env.example`s, and the endpoint to `docs/API.md`. The here.now skill was installed globally
  (`npx skills add heredotnow/skill`, → `~/.agents/skills/here-now`, which DSH reads).
- **Done (box UI, added once the other session's files settled):** `BoxData.deploy` (`DeployInfo`,
  every field always defined) + the **`deployBox`** store action + **`components/DeployPanel.tsx`**
  (the 🌐 Live site strip: live link, anonymous expiry, 🔑 claim-link toggle with its once-only
  warning, here.now warnings, and errors that keep the previous live site visible rather than hiding
  it) + a **🚀 Deploy** footer button on Code, UI Design, Stitch UI and Code Edit boxes. Redeploys
  update the same Site by sending `slug` + `baseVersionId` + the stored claim token; a refused update
  is surfaced verbatim with the live Site untouched.
- **In flight:** —.
- **Verified:** 60 server tests (16 new: validation, error mapping, the stubbed create/upload/
  finalize flow, stale-base conflict, step-labelled failures) and 10 new client tests (plus 9 new
  deploy checks in `client/ui-smoke.mjs`, now **84/84**); `tsc` clean in client, server and
  functions. **Real deploy from the app:** a live-model Code box built a 115-line prototype, the real
  🚀 Deploy button published it → `https://radiant-lodge-g7cj.here.now/` (200, the prototype HTML and
  its `App.jsx` both served). **Real deploys through the endpoint:** published a two-file Site
  (`index.html` + `NOTES.md`) → `https://cobalt-castle-y2d3.here.now/` (200, content served);
  updated it with the claim token + `baseVersionId` → new version, live content changed (the first
  fetch looked stale — CDN caching, a cache-busted fetch confirmed the update); sent a **stale**
  `baseVersionId` → `400` with "This site has changed since it was deployed (live version …)" and
  the live Site untouched; `NOTES.md` is served through here.now's auto-viewer (HTML wrapper, as
  documented) and an unknown path 404s.
- **Next steps:** when the Checklist work is committed, add the Deploy button/panel (build the file
  set with `deployFilesFor`, call `publishSite`, store the slug/versionId/claim token on the box) and
  document the feature in `AGENTS.md`/`README.md`/`docs/BOX_TYPES.md` — those three are also in the
  other session's modified set, hence untouched here.

## 2026-02-08 — Deploy: Code box change requests live on carbondocs

- **Done:** `bash scripts/deploy.sh` to `carbondocs` from commit `15f308f` — **Hosting only**
  (new entry `assets/index-DF6pHO8-.js`, same hash as the local build); `functions/api` +
  `processStitchJob` were correctly **skipped** ("No changes detected") because this feature is
  pure client-side. Verified live: `/` 200, `/api/generate` still answering, and the served bundle
  contains the change flow (`Request a change`, `Apply change`, the safeguard prompt
  `Apply ONLY that change`, and the append-only revert note `reverted to v`).
- **In flight:** —.
- **Next steps:** —.

## 2026-02-08 — AI change requests in the Code / UI boxes (with diff + revert)

- **Done:** The Code and UI Design boxes now take **change requests**: a "Request a change…" field +
  ✏️ **Apply change** button (shown once code exists) asks the AI to rewrite the component it already
  produced. The prompt template (`CODE_CHANGE_PROMPT`, deliberately **not** per-box editable — its
  rules are the safeguard) demands the COMPLETE file and forbids reformatting, renaming, or dropping
  anything the request did not mention; the reply must still pass `isCompletePrototype` (App component
  **and** a render call) or the existing code is kept and the run errors, and an identical reply adds
  no version. **Every** build and change now appends to `boxData.codeVersions` (the shared
  `ArtifactVersion`/`appendVersion` record — `SdlcVersion` became a type alias of it), and the new
  `CodeChangePanel` shows `vN · +3 −3 vs vN-1`, a 🔀 diff, and a 🕘 history with 👁 view + ↩ **Revert**
  (a revert is itself a new version, so history stays append-only). Upstream boxes can supply the
  request (wire a Review box's findings or a Code Edit change set into a Code box). Stitch boxes are
  excluded (their code is provider HTML).
- **Tests:** **228 client tests** (12 in `code.test.ts` incl. the completeness check, the change-prompt
  builder and the no-feature-loss rules) + **75/75** in `client/ui-smoke.mjs` (9 new CC checks: build
  versioning, apply-a-change, prompt contents, the +/- display, revert-as-new-version, refused
  incomplete reply, unchanged reply, no-code refusal). **Live:** a real build (5.4s, 112 lines) then a
  real change request ("bigger heading, dark buttons") → **+3 −3**, exactly the three intended lines,
  with count/increment/decrement still present and the component still complete.
- **In flight:** —.
- **Next steps:** —.

## 2026-02-08 — Deploy: Code Edit worker live on carbondocs

- **Done:** `bash scripts/deploy.sh` to `carbondocs` from commit `ab5d417` — Hosting released (new
  entry `assets/index-DXCwmJ8K.js`, same hash as the local build) **and Cloud Functions updated**
  (`api` + `processStitchJob`), which this feature needed: the **whole-file `paths` mode** of
  `/api/repo-digest` is new, so Code Edit's file reads would have failed in production without it.
  Verified live: `POST /api/repo-digest` with `paths` returned one file **in full** (3955 chars,
  `clipped: false`) in 1.8s, reported `nope/missing.ts` in `missing`, and refused `../etc/passwd`
  (not echoed, not fetched); the served bundle contains the worker (`codeedit`, `Code Edit`,
  `code-changes.patch`, `Change set`) and the triage prompt (`You plan code changes`), so both the
  pinned/plan path and the triage path shipped.
- **In flight:** —.
- **Next steps:** — (optional future work: push branch + PR if a write token is ever wanted; or
  wiring Code Edit → Review in an SDLC board, which needs no code changes).

## 2026-02-08 — Code Edit worker (apply a change request to an existing repo)

- **Done:** New **Code Edit** worker (✍️ `codeedit`, Workers section, `roles: ["developer",
  "sdlc"]`) — the Code box's sibling: point it at an existing GitHub repository, describe a change,
  and it reads the files that matter and proposes a **reviewable change set** plus a
  `git apply`-able **`.patch`**. **It never writes to the repository** (no token, no branch, no PR —
  a deliberate scope choice), so there is no new secret and no write surface. Flow: target files
  (its own file list → else the file list in an upstream **SDLC Plan** artifact → else one triage
  call) → read those files **in full** through a new **whole-file mode of `/api/repo-digest`**
  (`paths` request field; `contents`/`missing`/`clipped` in the response) → ask for a change set of
  **whole files** → the APP validates it and computes the diff and the patch. New pure module
  `client/src/lib/codeedit.ts` (path safety, plan/triage parsing, change-set validation, LCS line
  diff, unified patch), UI in `components/CodeEditPanel.tsx` + a new shared `components/RepoField.tsx`
  (also used by Code Map), run path `runCodeEdit` in `boardStore.ts`, `setChangeSetFile` for hand
  edits, `.patch` download, Canvas + minimap + agent whitelist, and the duplicated
  `server/src/repo.ts` → `functions/src/repo.ts` kept in sync. Three real bugs caught by the tests:
  the diff treated a missing final newline as unchanged content (git considers it part of the line,
  so `git apply` rejected the hunks), the no-newline marker was placed after a diff *header* line,
  and the marker was omitted when nothing was removed on the original side.
- **Tests:** **225 client tests** (30 new pure + 3 that apply generated patches with real
  `git apply` in throwaway repos, which is what forced those three fixes) and **43 server tests**
  (whole-file mode, `missing`, `clipped`, path safety). **Live:** the `paths` mode against the real
  repo (2 files in full; missing and unsafe paths reported), and a **real end-to-end run** (live
  GitHub + live model, 27.6s) whose change set (+5 −0 on `client/src/lib/download.ts`) produced a
  patch that **`git apply --check` accepted against a fresh clone**, applied with
  `git diff --numstat` = 5/0 and **zero original lines lost**. `client/ui-smoke.mjs` now passes
  **66/66** (13 new Code Edit checks incl. Plan-driven targeting and the triage path).
- **In flight:** —.
- **Next steps:** —.

## 2026-02-08 — Code Map worker (repo understanding) + `/api/repo-digest`

- **Done:** New **Code Map** worker (🔭 `codemap`, Workers section, `roles: ["developer", "sdlc"]`)
  that reads a **GitHub repository** and writes an orientation brief (what the code is, stack,
  structure, entry points, main flows, key abstractions, tests/costs, risks, where to start
  reading, open questions). New backend endpoint **`POST /api/repo-digest`** in both
  `server/src/app.ts` and `functions/src/index.ts`, backed by a new duplicated module
  `server/src/repo.ts` + `functions/src/repo.ts`: 1 API call for the tree (plus one for the default
  branch), file contents from `raw.githubusercontent.com` (not rate-limited), only **github.com
  owner/repo** accepted (never a request proxy), optional `GITHUB_TOKEN` for private repos +
  5,000 req/hr (documented in `docs/API.md`, added to both `.env.example`s, reported as
  `githubToken` by `/api/health`). Digest builder ranks files (`scorePath`/`selectFiles`: README +
  dependency manifests → entry points → central modules, with per-directory and per-category caps),
  spends the 60k-char budget in **value order**, **clips** big files rather than skipping them,
  never downloads >400 KB files, and reports every dropped/capped file in `notes`. Client side:
  new pure module `client/src/lib/repo.ts` (`parseRepoRef`/`resolveRepoRef`/`buildCodeMapPrompt`)
  + `fetchRepoDigest` in `lib/api.ts`, run path `runCodeMap` in `boardStore.ts`, a Repository field
  + "what was read" summary (repo@branch · files · chars · capped · when · notes) in `BoxNode`,
  `code-map.md` downloads, `codemap` added to the Agent's creatable whitelist, Canvas nodeTypes +
  minimap colour. Three real bugs found and fixed by the tests: the branch was dropped from the
  request URL, the box's **stock prompt** placeholder (`github.com/owner/repo`) was being resolved
  as a repository, and the digest budget was being spent alphabetically instead of by value.
- **Tests:** 35 server tests (18 new in `server/src/repo.test.ts` incl. a stubbed-fetch digest flow,
  + 4 new route/health tests in `app.test.ts`) and 205 client tests (14 new in `repo.test.ts`)
  pass; `tsc --noEmit` + `vite build` clean. **Live:** real endpoint against a real public repo
  (`alexbonti/ai-canva`: 10 files of 158, 71k chars, capped, notes listed) and a **real end-to-end
  box run** (live GitHub + live model, 42s) producing a 21k-char brief that cites real paths
  (`client/src/store/boardStore.ts`, `server/src/app.ts`, `client/src/types.ts`,
  `functions/src/index.ts`). `client/ui-smoke.mjs` (renamed from `sdlc-smoke.mjs`, now covering both
  features) passes **53/53**.
- **In flight:** —.
- **Next steps:** deploy (Functions must ship for `/api/repo-digest` to exist in production; set
  `GITHUB_TOKEN` there if private repositories should be readable); then run the E2E suite in a quiet
  window to confirm the 80/80 baseline still holds.

## 2026-02-08 — Deploy: SDLC pipeline live on carbondocs

- **Done:** `bash scripts/deploy.sh` to `carbondocs` from commit `ef184d2` — Hosting released
  (19 files, new entry `assets/index-Bs1JfCFH.js`), `functions/api` + `processStitchJob` skipped
  (no server/functions changes in this feature: the gates are entirely client-side). Verified live:
  `/` 200, `/api/health` all keys configured, `/api/generate` → `{"content":"Hi","model":"deepseek-v4.1-flash"}`,
  and the served bundle contains the feature (`sdlc-intent`/`sdlc-merge`, the `SDLC` palette
  section + `🔁 SDLC` View profile, `Require approval before the next stage can run`, `intent.md`,
  `sdlc-audit-`, the hard-gate copy) — i.e. the deployed HTML points at the same
  `assets/index-Bs1JfCFH.js` hash as the local build.
- **In flight:** —.
- **Next steps:** —.

## 2026-02-08 — SDLC pipeline group + per-box outcome downloads

- **Done:** Added the **SDLC** palette group (`BoxCategory: "sdlc"`, section "SDLC" between Inputs
  and Workers) with six gated stage boxes — `sdlc-intent` 🎯, `sdlc-spec` 📐, `sdlc-plan` 🧭,
  `sdlc-implement` 🛠️, `sdlc-review` 🔎, `sdlc-merge` 🚀 (labels "1 · Intent" … "6 · Merge") — plus
  a new **`🔁 SDLC` View profile** (`BoxRole: "sdlc"`; Sidebar's `ROLES` list + the localStorage
  whitelist). Faithful gate mechanics: approve / request changes (feedback is injected into the next
  regeneration) / reject / edit-as-new-version, append-only `sdlcVersions` + `sdlcHistory`, the gate
  checked **before** any model call, app-side cross-checks (spec open items, spec decisions with no
  named test in the plan, implementation deviation, parsed review findings), downstream approvals
  marked `↻ stale` when an upstream stage changes, hard gates on Intent + Merge plus every forced
  condition (the ⚙ toggle is refused, not silently ignored), a Skills field on spec/review, a
  `🗂 Audit` export of the whole chain, and a `💾 Save` button that downloads any text-output box's
  outcome as Markdown (`client/src/lib/download.ts`). New pure modules `client/src/lib/sdlc.ts` +
  `client/src/lib/download.ts` (both unit-tested), UI in `components/SdlcGatePanel.tsx` +
  `BoxNode.tsx`, run path `runSdlcStage` in `boardStore.ts`. Docs updated: `BOX_TYPES.md` (SDLC
  section, download section, category/role lists), `AGENTS.md` (box count 17→23, category/role
  lists, two new convention bullets), `README.md` (box table + feature bullets),
  `LandingRoles.tsx` (4th "For SDLC teams" card).
- **Tests:** 176 client tests pass (48 new: 38 in `sdlc.test.ts`, 10 in `download.test.ts`, plus
  SDLC additions in `serialization.test.ts` and `agent.test.ts`); `tsc --noEmit` and `vite build`
  clean. **Live verification:** the new `client/sdlc-smoke.mjs` (playwright-core against the real
  dev app on 5173, `/api/generate` mocked per stage) passes **40/40** — palette section + SDLC View
  profile, the gate refusing to run before approval with **zero** model calls, approve/edit-as-new-
  version, all four app-side cross-checks, `stale` invalidation of downstream approvals, dismissing
  a blocking finding, `💾 Save` (`intent.md`) and `🗂 Audit` (asserted by reading the downloaded
  files), 6 stages + versions + gates surviving a reload. The existing E2E suite still passes
  **80/80** (no regression). No server/functions changes — the gates are entirely client-side and
  add no new persisted state beyond `boxData`.
- **In flight:** —.
- **Next steps:** — (optional future work: move per-box version history into
  `boards/{id}/sdlc/...` if a heavily regenerated board ever approaches Firestore's 1 MB document
  limit).

## 2026-02-08 — Deploy: new default model live on carbondocs

- **Done:** `bash scripts/deploy.sh` to `carbondocs` (Hosting 200; `/api/health` all keys
  configured; live `/api/generate` verified serving `"model":"deepseek-v4.1-flash"`). Production
  now runs the new default text model; functions `api` + `processStitchJob` updated.
- **In flight:** —
- **Next steps:** —.

## 2026-02-08 — Default text model → deepseek-v4.1-flash

- **Done:** Changed the hardcoded default in BOTH `server/src/ollama.ts` and `functions/src/ollama.ts`
  (`deepseek-v4-flash` → `deepseek-v4.1-flash`), plus doc comments, `server/.env.example`,
  `functions/.env.example`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, and the
  `docs/MODELS.md` map (change log entry added). No `OLLAMA_MODEL` override is set in either env
  file, so both environments use the new default; **production takes effect on next deploy**.
- **In flight:** —
- **Next steps:** —

## 2026-02-08 — docs/MODELS.md: model registry (single source of truth)

- **Done:** Added `docs/MODELS.md` — one page mapping every model to its concern (text =
  Ollama `deepseek-v4-flash` default via `OLLAMA_MODEL`; Stitch = `GEMINI_3_FLASH` via
  `STITCH_MODEL`; fal.ai images = `fal-ai/qwen-image-edit` / `fal-ai/flux/schnell`, hardcoded),
  provider config, how to switch (env override vs duplicated code defaults in BOTH
  `server/src/` + `functions/src/`), runtime observability (`tokenUsage` docs record the model),
  and a change log. Cross-referenced from `docs/API.md` (env section) and `AGENTS.md` (docs
  lists + rule to update it on model changes). Also replaced the stale Anthropic comments in
  `server/.env` with a note — an `ANTHROPIC_API_KEY` existed in `server/.env`/`functions/.env`
  but no Anthropic code exists; **deleted the unused key from both env files**.
- **In flight:** —
- **Next steps:** if models are switched for the booth, append to the MODELS.md change log;
  optionally centralize the hardcoded model IDs into a per-backend `models.ts` module.

## 2026-02-08 — Tablet / iPad (coarse-pointer) support across the canvas

- **Done:** Made the app usable on a large tablet for the booth demo. All touch behavior is
  scoped to `@media (pointer: coarse)` in `client/src/index.css` (desktop unchanged). Page level:
  `index.html` viewport now `viewport-fit=cover, maximum-scale=1, user-scalable=no` + apple/web
  app metas (Add-to-Home-Screen → chrome-less kiosk), `.app-bar` safe-area insets, `100dvh`
  root height, `overscroll-behavior: none`, global `touch-action: manipulation` on buttons,
  `user-select: none` on body for coarse pointers (reading surfaces re-enabled). Touch targets:
  React Flow handles 18px (`!important` over inline), resize handles 20px, controls 34px,
  deletes 30px, footer buttons/slide-nav/timer/palette/header bumps via new marker classes.
  Hover-gated ✕ buttons (Documents file rows, Sidebar custom templates) get `.touch-visible`;
  note/label/chatbot deletes always visible on touch. Box bodies (`box-body nodrag`) scroll with
  a finger instead of dragging the node. Canvas: Area tool now works from touch (native
  touchstart/move/end on `.react-flow__pane`), presence cursors update via `onTouchMove`,
  `zoomOnDoubleClick={false}`. Help card yields the corner to zoom controls on touch.
  Verified: 126 client unit tests + full E2E **80/80** (desktop viewport).
- **In flight:** —
- **Next steps:** real-device pass on an iPad (keyboard-overlap when typing in low boxes,
  CodeMirror on-screen editing feel); optionally hide the minimap on small screens.

## 2026-08-30 — Chatbot companion: a chatting stick figure on the board

- **Done:** Added the 🧍 **Chatbot** (17th box type, new `companion` category + "Companions"
  palette section): a stick-figure AI you can hold a continuous conversation with. Auto-placed at
  the viewport bottom-center on add (`data.autoPlace` → Canvas effect → `placeChatbot`), rendered
  as a custom annotation branch in `BoxNode.tsx` (SVG `StickFigure.tsx`, speech bubble, thinking
  bob). Click opens `ChatbotPanel.tsx` (portaled) — shared transcript with attribution, editable
  name (default "Chat Pal"), 🧠 personality editor (`boxData.personality`), clear-chat, Retry on
  error. Each reply = store `sendChatMessage` → persona + board snapshot (via `buildBoardInventory`,
  chatbots/agents/areas filtered) + last 16 messages → `/api/generate`; no backend changes. New
  `lib/chatbot.ts` (pure; 11 tests; 60-message cap) + tests. `runBox` early-returns for chatbot;
  agent inventory now also hides chatbots. E2E-verified live: board-aware reply ("I see an Idea
  Box… and a Research Box…"), persona + rename round-trips, auto-place, bubble.
- **In flight:** —
- **Next steps:** per-user private companions or "typing" presence are possible follow-ups; the
  reply loop is non-streaming (typing dots only) — a streaming endpoint would improve feel.

## 2026-08-30 — Agent box: a real task-driven agent on the board

- **Done:** Added the 🤖 **Agent** box (16th box type, first in Workers): the user types a task and
  Runs; an LLM controller loop (client-side, reusing `/api/generate`) manipulates the BOARD — each
  turn it returns ONE JSON action (`add_box` / `connect` / `run_box` / `finish`) executed with the
  regular store actions, so agent-created pipelines are ordinary boxes collaborators can take over.
  New `client/src/lib/agent.ts` (pure: action parsing, board inventory, turn prompts, child layout;
  22 unit tests) + `runAgentLoop` in `boardStore.ts` + `isAgent` UI in `BoxNode.tsx` (task textarea,
  live step timeline, final answer, ⏹ Stop) + `connectBoxes`/`stopAgent` store actions. Budget 12
  turns with forced wrap-up, 2× parse-retry with coaching, raw-text salvage; token ledger reused
  with `boxType: "agent"`. Verified end-to-end against the real dev app + Ollama (Playwright smoke:
  agent created/wired/ran boxes and finished with a markdown answer; steps rendered live).
- **In flight:** —
- **Next steps:** optionally let the agent `delete_box`/restyle boxes, or persist per-run cost
  summaries; E2E could add an agent-flow test with a mocked `/api/generate` for determinism.

## 2026-08-30 — Documents box (📎 upload files as AI inputs)

- **Done:** New `documents` input box — multi-file upload (click or drag & drop) whose extracted
  text becomes downstream prompt input. `lib/documents.ts` (unit-tested, 16 tests) holds the
  logic: txt/md/csv/json read directly, PDF via lazy `pdfjs-dist`, DOCX via lazy `mammoth`
  (both stay out of the main bundle); text capped 100k/file, 400k/box. Raw files upload
  best-effort to Storage (`storage.rules` gained a `documents/` path — **rules not deployed
  yet**). `runBox` gathering now uses `buildDocumentsOutput()` for document sources. E2E "TD"
  tests added (upload .txt + a hand-written minimal PDF through the real UI, assert the labeled
  text reaches a connected box's prompt via a fetch intercept).
- **In flight:** —
- **Gotchas hit (durable, see AGENTS.md E2E section):** (1) the firebase-tools access token
  expires ~hourly — a 401 on the facilitator PATCH surfaces as the "TF facilitator button"
  FAIL; refresh by running any `firebase` CLI command before the suite. (2) Running the E2E
  while another session edits `client/src` breaks it via HMR/full reloads (scattered flaky
  failures each run) — run it in a quiet window; my first "crash" theory (Vite re-optimizing
  pdfjs-dist) was wrong, it was the concurrent Agent-box session. (3) `npm install <pkg>`
  pruned `playwright-core` (never in package.json) — now a devDependency. Final state on the
  combined tree (Documents + Agent boxes): **build ✓, unit 128 ✓, E2E 80/80 ✓**.
- **Next steps:** consider a per-document preview/expand in the box UI.
- **Shipped:** committed as `81b0752` (Documents + Agent boxes together) and deployed via
  `scripts/deploy.sh` — hosting + storage rules (documents path live) + firestore rules
  released; functions unchanged (both features are client-only). Verified live:
  `https://carbondocs.web.app` 200, `/api/health` all keys configured, `/api/generate`
  returns real output, and the deployed bundle contains the Documents box code.

## 2026-08-30 — DEVLOG created

- **Done:** Added this session journal (`docs/DEVLOG.md`) and pointer sections in `AGENTS.md`
  (bootstrap note, docs layout table, docs list, maintenance checklist), so future sessions read
  current state here instead of re-exploring the codebase.
- **In flight:** —
- **Next steps:** —