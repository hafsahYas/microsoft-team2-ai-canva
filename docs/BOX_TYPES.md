# Box types reference

This document describes every box type. Metadata lives in `client/src/types.ts`
(`BOX_TYPES`), rendering in `client/src/components/BoxNode.tsx`, and the "run" behavior in
`client/src/store/boardStore.ts` (`runBox`).

Boxes fall into five categories:

- **Input boxes** (`category: "input"`) — no AI. They seed data into a pipeline.
- **SDLC boxes** (`category: "sdlc"`) — the six gated stages of the SDLC pipeline
  (intent → spec → plan → implementation → review → merge). AI, plus an approval gate and an
  append-only artifact history. See "SDLC pipeline boxes" below.
- **Worker boxes** (`category: "worker"`) — run an AI step (Ollama, fal.ai, or Google Stitch).
- **Companion boxes** (`category: "companion"`) — persistent AI characters you converse with.
- **Collaboration boxes** (`category: "collab"`) — standalone team tools and annotations with no AI,
  no Run button, no settings panel, and no connection handles.

> A sixth `custom` category holds the user's own saved box templates (see "Custom boxes").

---

## Input boxes

### 💡 Idea — `idea`

Free-text input. No AI. The seed of most pipelines. Its content becomes the output sent to
downstream boxes.

- **Inputs:** none (no target handle).
- **Outputs:** its text content.
- **Settings:** none (input box).

### 🖼️ Image — `image`

Upload an image. It's auto-resized to ≤1024px, compressed to JPEG, and uploaded to Firebase
Storage (if a board is loaded) so it syncs to collaborators. Downstream boxes receive a fetchable
URL.

- **Inputs:** none (no target handle).
- **Outputs:** an image URL (used as `imageData` input by Cartoon boxes).
- **Settings:** none (input box).

### 📎 Documents — `documents`

Upload one or more documents (click or drag & drop; PDF, DOCX, TXT, MD, CSV, JSON). Text is
extracted **in the browser** — plain-text formats are read directly, PDFs via pdf.js and Word
files via mammoth (both loaded on demand, so they don't slow down the app until needed). The
combined, filename-labeled text becomes the box's output, so any connected AI box can use it via
`{{inputs}}`, `{{Box Name}}`, or `{{input_N}}` — e.g. connect Documents → Summarize to condense a
report, or Documents → PRD to turn a spec into a product doc.

- **Inputs:** none (no target handle).
- **Outputs:** every document's extracted text, each labeled `=== filename ===`. Extraction is
  capped at 100k chars per file and 400k chars per box (oversized files are marked *truncated*)
  so boards stay within Firestore's 1MB document limit.
- **Persistence:** the extracted text lives in the board itself (syncs to collaborators and
  survives reloads). The original file is also uploaded to Firebase Storage when signed in
  ("Open original ↗" link); when signed out, only the text is kept.
- **Settings:** none (input box).

---

## Worker boxes

### 🤖 Agent — `agent`

Give the agent a **task** (typed in its box) and click Run: it autonomously completes the task
by using the board as its workspace. Each turn the model returns one structured action —
`add_box` (create a new AI box with a task-specific prompt), `connect` (wire two boxes),
`run_box` (run a box through the normal pipeline and read its output back), or `finish`
(write the final Markdown answer into the box). The step-by-step transcript is shown live in
the box (and synced to collaborators); the boxes it creates are ordinary boxes you can inspect,
rerun, and take over. Runs entirely client-side on top of the regular boxes/`runBox` machinery
— no backend endpoints were added.

- **AI:** Ollama, multiple controller turns (default system prompt = the JSON action protocol).
- **Budget:** 12 controller turns (`MAX_AGENT_TURNS` in `client/src/lib/agent.ts`); the final
  turn forces a wrap-up. Unparseable replies are coached and retried (2×), then the raw reply is
  kept as the answer so the run never hangs. ⏹ Stop halts the loop between turns.
- **Can create:** `idea`, `research`, `summarize`, `prd`, `devplan`, `slides`, `code`, `ui` —
  never upload boxes (Image/Documents), `cartoon`/`stitch` (image/async paths), other agents,
  or itself.
- **Inputs:** connected boxes flow into the agent's context (like `{{inputs}}`); its `content`
  field is the task.
- **Output:** the final Markdown answer (also usable by downstream boxes).
- **Settings:** "Extra guidance for the agent" (the prompt field) + the protocol system prompt
  (advanced). The step transcript persists in `boxData.agentSteps`.
- **Code:** parsing/inventory/layout in `client/src/lib/agent.ts` (unit-tested); the loop in
  `boardStore.ts` (`runAgentLoop`); UI in `BoxNode.tsx` (the `isAgent` branch).
- **Caveat:** the controller is only as good as the model behind `/api/generate` — strict-JSON
  adherence varies by local model, which is why the loop is defensive (retry → coach → salvage).

### 🔍 Research — `research`

Runs an AI prompt over connected inputs and returns structured research findings.

- **AI:** Ollama (text).
- **Inputs:** any connected box; defaults to `{{input_1}}`.
- **Output:** Markdown text.

### 📋 Summarize — `summarize`

Combines multiple upstream inputs into a concise AI summary.

- **AI:** Ollama (text).
- **Inputs:** multiple; defaults to `{{inputs}}`.
- **Output:** Markdown text.

### 📄 PRD — `prd`

Generates a Product Requirements Document — product overview, problem statement, target users,
core features with priorities, user stories, UI/UX guidelines, technical requirements, and
success metrics. Ideal input for the Code box.

- **AI:** Ollama (text).
- **Inputs:** typically Research; defaults to `{{inputs}}`.
- **Output:** Markdown document.

### Deploying a box

Any box that contains code can be published to a live URL — **Code**, **UI Design**, **Stitch UI**
and **Code Edit**. Press **🚀 Deploy** in the box (or the button in the 🌐 Live site strip) and the
backend publishes it to **here.now**:

- what gets published: Code/UI → a self-contained `index.html` (the same CDN-wrapped page the box
  previews) **plus `App.jsx`** with the source; Stitch UI → its HTML as-is; Code Edit → the changed
  files at their repository paths **plus `CHANGES.md`** with the diff;
- the first deploy **creates** the Site and later ones **update the same one**, sending its live
  version back — so a Site that changed elsewhere (the here.now editor, another agent) is refused
  with a message naming that version instead of being silently replaced;
- the box records the slug, URL, version, file count and byte count, and shows the live link;
- `HERENOW_API_KEY` (see `docs/API.md`) is optional. Without it the Site is **anonymous: it expires
  in 24 hours** and can only be updated with the claim token — which here.now returns **exactly
  once**, so the box keeps it and shows the claim link behind a 🔑 toggle (a modified claim link
  will not work). With a key the Site is permanent and belongs to the account;
- nothing is verified for you: deploying publishes the code, it does not run it.

### ✍️ Code Edit — `codeedit`

Applies a **change request to an existing GitHub repository** and hands back a reviewable change
set plus a `git apply`-able patch. It is the Code box's sibling: same editing surface, but it starts
from real files instead of generating a prototype.

- **Where the repository comes from:** the box's **Repository** field, a GitHub link in its note, a
  customised prompt, or any connected box — same rules as the Code Map worker (public repos, no
  token; `POST /api/repo-digest` does the reading).
- **The change request** is its textarea (or a connected Idea / SDLC Intent / Spec / Plan).
- **Which files get read** (in this order): the box's **Files to change** list (one path per line) →
  the file list in an upstream **SDLC Plan** artifact (`## Files to change`) → otherwise one cheap
  **triage call** that names the paths to read. Only then are those files read **in full**.
- **The contract that makes it trustworthy:** the model returns **whole files** and the **app**
  computes the diff, the line counts and the patch — so what you review is exactly what
  `code-changes.patch` contains. A model reply that is not the JSON change set is reported as an
  error rather than guessed at.
- **Refusals (never silent):** a path that was never read, a path outside the repository, an
  unknown operation, an empty "update", a rewrite of a file whose content was **clipped**, a change
  that would exceed the board document's budget — each is dropped and listed in the panel.
  A run without a repository, or without a change request, is refused with guidance.
- **Output:** the change-set panel (per file: operation, `+added −removed`, reason; a diff view and
  an editor), stored as a Markdown diff document in `output` — which is exactly what the SDLC
  **Review** stage consumes — plus 💾 **Save** → `code-changes.patch`.
- **Nothing is written to the repository.** No token, no branch, no PR: apply the patch in your
  checkout (`git apply code-changes.patch`) or paste a file's contents. Nothing is compiled or
  tested either — CI and the Review stage are where that happens, and the model is required to list
  what it could not verify.
- **Caps:** up to 5 changed files, 24k characters per file, 60k per file read (`clipped` beyond
  that), 150k characters read per run.
- **Code:** `client/src/lib/codeedit.ts` (path safety/targeting, change-set validation, LCS line
  diff, unified patch — unit-tested, including a suite that applies the generated patches with real
  `git apply`), run path `runCodeEdit` in `boardStore.ts`, UI in `components/CodeEditPanel.tsx` +
  `RepoField.tsx`.
- **Deploy:** `deployFilesFor` publishes the changed files (deletions skipped) plus `CHANGES.md`.

### 🗺️ Dev Plan — `devplan`

Transforms a PRD into a short, pragmatic development plan: components to build, state variables,
key functions, and a build order. Best fed by a PRD box, then fed into a Code box.

- **AI:** Ollama (text).
- **Inputs:** typically a PRD; defaults to `{{inputs}}`.
- **Output:** Markdown list.

### 🔭 Code Map — `codemap`

Reads a **GitHub repository** and writes an orientation brief: what the code does, how it is
structured, how the main flows move through the files, what is risky, and where a new engineer
should start reading (the sections are `What this codebase is`, `Tech stack`, `Structure`,
`Entry points`, `How the main flows work`, `Key abstractions`, `Tests and how to run things`,
`Risks and hotspots`, `Where to start reading`, `Open questions`).

- **Where the repository comes from:** the box's own **Repository** field (a GitHub URL,
  `owner/repo`, or `owner/repo#branch`), a GitHub link in the box's note, a link in a *customised*
  prompt, or a link in any connected box — so pasting a repo link anywhere sensible works, which is
  also how the **Agent box** can create and run one (`codemap` is in `AGENT_CREATABLE_TYPES`).
- **How it reads the repo:** the browser never talks to GitHub. `POST /api/repo-digest` (see
  `docs/API.md`) fetches the tree and the files that matter most and returns a digest; the box shows
  what was read (repo@branch · files of tree · chars · capped · when) and the digest's notes.
  **Public repositories need no setup**; `GITHUB_TOKEN` on the server adds private repos and a much
  higher rate limit.
- **Inputs:** optional. A connected **Documents box** or pasted code is mapped too — and if the
  repository could not be read, the model is told so explicitly and must not pretend otherwise
  (the brief then says the repo itself was not read).
- **Output:** the Markdown brief (downloadable as `code-map.md` via 💾 Save). The record of what was
  read is stored on the box (`repoMeta`: repo, branch, file/tree counts, characters, truncated,
  fetched time, error, notes) and syncs to collaborators.
- **Limits (all reported, never silent):** 24 files, 20 KB per file (bigger files are clipped, not
  skipped), 60k characters of file contents, 400 tree entries; generated output, dependencies,
  binaries and lockfiles are excluded.
- **Code:** `server/src/repo.ts` (+ its duplicate `functions/src/repo.ts`) for the fetch, ranking and
  digest; `client/src/lib/repo.ts` for URL parsing/resolution and prompt assembly (both unit-tested);
  the run path is `runCodeMap` in `boardStore.ts`.

### 🎨 Cartoon Profile — `cartoon`

Generates a cartoon avatar via fal.ai.

- **AI:** fal.ai (image).
- **Inputs:**
  - An **Image** box connected → image-to-image (`fal-ai/qwen-image-edit`).
  - Otherwise, an **Idea** box → text-to-image fallback (`fal-ai/flux/schnell`).
- **Output:** a generated image URL (`outputImage`).
- **Settings:** a "Prompt Template (text-to-image fallback)" — only used when no image is
  connected. No system prompt.

### 📊 Slides — `slides`

Generates a visual pitch deck. Ollama returns a JSON array; the app parses it into navigable
slides with prev/next and speaker notes.

- **AI:** Ollama (text).
- **Inputs:** `{{inputs}}`.
- **Output:** slides parsed from a JSON array of
  `{ title, bullets: string[], notes? }`.
- **Settings:** the prompt defines the slide structure; the model must output only a valid JSON
  array.

### 💻 Code — `code`

Generates a working React prototype. Output is validated to contain a `ReactDOM.createRoot(...)`
render call, wrapped in a self-contained HTML page, and previewed in a sandboxed iframe with
Code/Preview tabs, Copy, and Save (download).

- **AI:** Ollama (text).
- **Inputs:** `{{inputs}}` (best from PRD / Dev Plan).
- **Output:** `code` (the JSX) + `output` (the raw response).
- **Constraints:** no imports; use the `React.*` API; define an `App` component; keep mock data
  small (3–5 items).
- **Deploy:** the box's **🚀 Deploy** button publishes the prototype to a live URL
  (`https://{slug}.here.now/`) via `POST /api/herenow-deploy`, together with its `App.jsx` source.
  Anonymous Sites expire in 24 hours; the panel shows the live link, the expiry and the claim link
  (returned once), and **Redeploy** updates the same Site. See "Deploying a box" below.
- **Change requests (AI edits):** once there is code, the box shows a **"Request a change…"** field
  and an **✏️ Apply change** button. The AI rewrites the whole component from your request, with the
  prompt rules that stop feature loss ("return the COMPLETE file… no reformatting, no renaming, no
  dropping features"), and the reply must still be a complete mountable component or the existing
  code is kept. Upstream boxes can supply the request too — wire a **Review** box (its findings *are*
  a change request) or a Code Edit box into a Code box and apply their suggestions without retyping
  them.
- **Versions (never rewritten):** every build *and* every applied change appends a version
  (`codeVersions`), so the box shows `v4 · +3 −3 vs v3`, a 🔀 **Diff** of the last change, and a
  🕘 history with **👁 view** and **↩ Revert** per version. A revert is itself a new version, so the
  history stays append-only — a mangled rewrite costs one click, not the box.
- **Honest limit:** nothing is verified for you — the preview renders, it does not test. The diff and
  the version history are the check.

### ✨ UI Design — `ui`

Generates polished, production-quality React UIs using **Tailwind CSS classes** + Google Fonts
(production-quality, Google Stitch style). Previewed in an iframe with Tailwind loaded.

- **AI:** Ollama (text).
- **Inputs:** `{{inputs}}`.
- **Output:** `code` (Tailwind-based JSX) + preview.
- **Settings:** same as Code box; system prompt emphasizes visual polish.
- **Change requests + versions:** identical to the Code box — the same "Request a change…" field,
  ✏️ Apply change, 🔀 diff and 🕘 version history with ↩ Revert (`client/src/components/
  CodeChangePanel.tsx`, shared by both boxes).

### 🧵 Stitch UI — `stitch`

Generates a UI screen using **Google Stitch** and returns polished, production-quality HTML
directly.

- **AI:** Google Stitch.
- **Inputs:** `{{inputs}}`.
- **Output:** `output` + `code` (the raw HTML), previewed directly in the iframe.

---

## Companion boxes

### 🧍 Chatbot — `chatbot`

A AI companion in the form of a **stick figure standing at the bottom** of the board (auto-placed
at the bottom-center of the view when added; draggable like any node). Unlike the Agent box, it
never finishes and never touches boxes — it holds a **continuous conversation**. Click the figure
to open the chat panel (a portal, escaping React Flow's transform).

- **AI:** Ollama per reply — context rebuilt client-side each turn from: the compiled persona, a
  live board snapshot (`buildBoardInventory`, chatbot/agent/area nodes filtered out — it "sees"
  every box), and the last 16 messages of the shared transcript.
- **Shared conversation:** one transcript per companion, visible and joinable by everyone on the
  board (user messages carry display-name attribution). Capped at 60 stored messages / 16 replayed.
- **Personality:** editable any time via the panel's 🧠 editor (`boxData.personality`); empty =
  friendly default. Name is editable too (the node title, default "Chat Pal" — renames also
  update the figure's name chip). Conversation + personality persist in `boxData.chatMessages`
  and sync to collaborators.
- **Panel extras:** clear conversation (🧹), error banner with **Retry** (strips the failed
  trailing exchange and re-sends), cumulative ⚡ token footer.
- **No handles, no Run:** talking is never `runBox` (guarded); sending goes through the store's
  `sendChatMessage` → `/api/generate`. On-canvas speech bubble shows the latest bot line and
  thinking dots while it thinks (idle bob / busy animations in `index.css`).
- **Code:** `client/src/lib/chatbot.ts` (pure, unit-tested), `components/StickFigure.tsx`,
  `components/ChatbotPanel.tsx`, `sendChatMessage`/`clearChat`/`placeChatbot` in `boardStore.ts`.

## Collaboration boxes

Standalone team tools shown in the sidebar's "Collaboration" section. They have **no AI, no Run
button, no ⚙ settings panel, and no connection handles** — they never join a pipeline.
`runBox` early-returns for them as a guard. Their content lives in the regular `boxData` and syncs
to every viewer through the board document snapshot, like all boxes.

### 🗒️ Note — `note`

A post-it style note for team communication. Anyone can write; everyone on the board sees edits
live. Notes render as **annotation paper, not a box card** — no header bar or border chrome, just
a slightly rotated yellow sticky with a hover/selected ✕ delete button.

- **Fields:** `content` (the note text), `authorEmail` / `authorName` (captured once at creation,
  shown under the note).
- **Interaction:** type in the note; edits save through the normal debounced board save.

### 🏷️ Label — `label`

A small colored text pill for annotating areas of the board. Labels render as a **floating chip
with no card frame at all** — the pill *is* the node, with a hover/selected ✕ delete button.

- **Fields:** `content` (label text), `labelColor` (one of `LABEL_COLORS` in `types.ts`).
- **Interaction:** click the pill to edit the text; select the box to reveal five color dots.

### ⏱️ Timer — `timer`

A shared countdown clock. Anyone can start/pause/stop/reset it; every viewer sees the same time.

- **Fields:** `timerDurationMs`, `timerStatus` (`idle` / `running` / `paused` / `stopped`),
  `timerStartedAt` (epoch ms), `timerRemainingMs` (frozen on pause/stop), `timerStartedBy`.
- **Sync design (important):** only state *transitions* write to the store. While running, every
  viewer locally computes `remaining = timerRemainingMs − (now − timerStartedAt)` on a 250ms
  interval — there are **zero Firestore writes per tick**. The pure logic lives in
  `client/src/lib/timer.ts` (`parseDurationInput`, `formatTimer`, `computeRemainingMs`,
  `isTimerFinished`) and is unit-tested in `timer.test.ts`.
- **At zero:** the digits turn red and pulse with a "⏰ Time's up" banner (visual only — no sound).

### ✅ Checklist — `checklist`

A **shared team to-do list**. Anyone on the board can add, assign, rename, reorder, tick off and
delete tasks — everyone sees the same list, live (last-write-wins between simultaneous users,
exactly like a Note). The box uses the standard card (title, delete ✕, resizable) and renders its
own panel body: a progress bar (`3 of 7 done`), an add field, and the task rows.

- **Fields:** `checklistItems` — an array of `ChecklistItem`, each with `id`, `text`, `done`,
  `assignee` (email, `""` = unassigned), `createdBy` / `createdAt` and `doneBy` / `doneAt`.
  Every field of every item is **always defined** (Firestore rejects `undefined` nested inside a
  value) and the array is created empty-but-defined at box creation.
- **Attribution:** the list is edited by the whole team, so each task records who added it and who
  ticked it off (shown as `✓ alice` on a finished row).
- **Adding tasks:** type one and press Enter. Pasting **multiple lines** appends them all at once —
  Markdown task lists (`- [ ]` / `- [x]`, the done state is kept), bullets, numbered lists and bare
  lines are all accepted, and the bullet/number markers are stripped. 📋 Copy exports the list as a
  Markdown checklist; 🧹 Clear done removes only finished tasks.
- **Assignment:** the row's picker lists the people on the board (owner, collaborators and whoever
  is currently present), plus the current user.
- **Budgets:** text is trimmed/single-lined and clamped to 500 chars, and a box holds at most 200
  tasks (`MAX_CHECKLIST_ITEMS`) so one list can never push the board document past Firestore's 1MB
  limit. The store skips the write entirely when a mutation changed nothing.
- **Code:** all rules are pure functions in `client/src/lib/checklist.ts` (`appendChecklistItems`,
  `parseChecklistLines`, `toggleChecklistItem`, `setChecklistItemAssignee`, `moveChecklistItem`,
  `checklistStats`, `checklistToMarkdown`, `normalizeChecklist`, …), unit-tested in
  `checklist.test.ts`. Rendering + store wiring is `components/ChecklistPanel.tsx`, and the store
  exposes one action, `setChecklistItems(id, items)`. `normalizeChecklist` repairs anything loaded
  from an older board document.
- **Not an AI box:** the agent cannot create one (`AGENT_CREATABLE_TYPES` excludes every
  collaboration box), and it produces no output for downstream boxes.

---

## Custom boxes

The `custom` type is not a built-in — it is what **user-created templates** instantiate as.
Users build their own reusable AI boxes ("✨ New Custom Box" in the sidebar): a name, emoji,
color, and the prompt/system-prompt templates (with the same `{{input_1}}` variables as the
built-ins). Definitions are saved to the user's profile (`users/{uid}/boxes/{boxId}` in
Firestore) and appear in the palette on every board.

- **Semantics:** adding one to a board COPIES the template's prompt, system prompt, icon, and
  color onto the box — so deleting a saved template never affects boxes already on boards.
- **Runtime:** a custom box is a normal AI text box (Run → Ollama → markdown output) with a ⚙
  settings panel for tweaking the instance's prompts.
- **Cleanup:** hover a template in the palette and press ✕ to remove it from your profile.

---

## SDLC pipeline boxes

Six boxes that walk **one change request** through a fixed, gated pipeline — the whiteboard version
of the app's SDLC blueprint: `intent → spec → plan → implementation → review → merge`. Each box
produces exactly one artifact, and the box **is** the gate: nothing advances to the next stage
until a human approves the artifact at that stage.

| # | Box | Type | Artifact | Gate |
|---|-----|------|----------|------|
| 1 | 🎯 **Intent** | `sdlc-intent` | `intent.md` — problem, outcome, affected users/systems, constraints, **open questions** | **hard gate, always** |
| 2 | 📐 **Spec** | `sdlc-spec` | `spec.md` — one `### Decision N` per open question, skill constraints applied, unresolved flags | gated; forced while anything is unresolved |
| 3 | 🧭 **Plan** | `sdlc-plan` | `plan.md` — files, implementation order, a named test per spec decision, risks, rollback | gated; forced while a decision has no test |
| 4 | 🛠️ **Implementation** | `sdlc-implement` | the diff + per-test evidence (marked `NOT RUN` when it could not run) | gated; forced when the artifact reports a plan deviation |
| 5 | 🔎 **Review** | `sdlc-review` | findings report + a parsed findings list (`blocking` / `important` / `nit`) | gated; forced while a blocking finding is undismissed |
| 6 | 🚀 **Merge** | `sdlc-merge` | the merge record: pre-merge checklist, commit message, PR body | **hard gate, always** |

- **Chaining:** connect stage N → stage N+1 (an Idea or Documents box upstream of Intent is the
  usual starting point). A stage's own `content` field is extra context and is included in the
  prompt; a connected Documents box is how you attach the full policy/security text.
- **Running a gated stage:** Run is refused **before any model call** while a connected upstream
  stage box is not approved at its latest version — the box shows the reason
  (`🔒 1 · Intent is not approved (awaiting approval (v1)) — approve it before running this stage`).
  Stages whose upstream is set to auto-advance are not blocked, and **non-SDLC boxes never block
  anything**.
- **Gate actions on the box:** ✅ Approve (records who/when/which version) · ✏️ Request changes (the
  note is injected into the next regeneration) · ⛔ Reject · ✏️ Edit (saves a **new version** —
  nothing is ever overwritten). 🕘 History lists every version and the full audit trail, and old
  versions stay viewable.
- **App-side cross-checks (never delegated to the model):** the app counts the spec's unresolved
  items, cross-checks every `### Decision N` against the plan's test list, detects a reported plan
  deviation, and parses the review findings — each one forces the stage to stay gated
  (`lib/sdlc.ts`, all unit-tested). A review artifact with no parseable findings says so instead of
  implying a clean review.
- **Invalidation:** regenerating, editing, rejecting or sending back a stage marks every downstream
  **approved** stage `↻ stale` (its approval referred to an artifact version that no longer holds),
  so approvals can never silently carry over a change nobody reviewed.
- **Hard gates:** Intent and Merge can never be switched to auto-advance, and neither can any stage
  with one of the forced conditions above — the ⚙ checkbox is disabled with the reason, and the
  store refuses the configuration outright instead of allowing it silently.
- **Skills:** the Spec and Review boxes have a "Skills / org rule sets" field in ⚙ settings
  (security, brand, compliance, coding standards). It is appended to the prompt on every run — the
  app's stand-in for the blueprint's skills registry.
- **Audit export:** 🗂 Audit downloads the whole connected chain as one Markdown document —
  artifacts, versions, approvals (who/when), findings and the audit trail, plus a JSON appendix.
- **Download an artifact:** 💾 Save downloads the box's own outcome as Markdown (see below);
  📋 Copy puts the latest artifact on the clipboard.
- **Agent boxes may not create these:** the pipeline is human-gated by design, so `sdlc-*` types are
  deliberately absent from `AGENT_CREATABLE_TYPES` (locked by a unit test).
- **Code:** stage metadata + prompts in `client/src/types.ts`; rules, parsers, gate evaluation,
  invalidation and the audit export in `client/src/lib/sdlc.ts` (unit-tested); the run path
  (`runSdlcStage`) and the gate actions in `client/src/store/boardStore.ts`; UI in
  `client/src/components/SdlcGatePanel.tsx` + `BoxNode.tsx`.

> **Not in scope (the whiteboard cannot merge):** the Implementation box does not apply a diff or
> run the repo's tests, and the Merge box does not merge — it produces the record a human merges.
> Approving the Merge stage is the recorded ship decision.

---

## Downloading a box's outcome

Every text-producing box can hand its **actual outcome** to the clipboard of your file system:

- **Which boxes:** the SDLC stages (`intent.md`, `spec.md`, `plan.md`, `implementation.md`,
  `review.md`, `merge.md`), Research, Summarize (`summary.md`), PRD, Dev Plan (`dev-plan.md`),
  Code Map (`code-map.md`), **Code Edit (`code-changes.patch` — a git patch, not Markdown)**,
  Agent (`agent-answer.md`), Slides (rendered as a Markdown deck) and custom boxes (slugified label).
- **Where:** the `💾 Save` button in the box footer, next to ⚙ — it appears once the box has an
  outcome.
- **What's in the file:** the artifact text and nothing else, so it can be pasted straight into a
  repo or a PR. Versions, approvals and findings live in the 🗂 Audit export instead.
- **Not covered:** Code / UI Design / Stitch keep their own 💾 Save (the runnable prototype as
  HTML), Cartoon keeps its image download, and Idea / Image / Documents / Note / Label / Timer /
  Checklist have no text outcome to download.
- **Code:** `client/src/lib/download.ts` (`outcomeText`, `outcomeFilename`, `slugifyFilename`,
  `downloadText` — the pure parts are unit-tested).

---

## Prompt template variables

All AI boxes support these in their prompt templates (see `lib/prompts.ts`):

| Variable | Meaning |
|----------|---------|
| `{{Box Name}}` | Output of a connected box matched by its name (case-insensitive). |
| `{{input_1}}` … `{{input_N}}` | Nth connected input, positional. |
| `{{input}}` | Alias for the first input. |
| `{{inputs}}` | All connected inputs, labeled and concatenated. |

## Role tags & the palette filter

Every box type carries `roles: BoxRole[]` (`"everyone" | "designer" | "developer" | "product" |
"sdlc"`) used by the View dropdown in `client/src/components/Sidebar.tsx`. This is a
**discovery-only label**, not a permission:

- Boxes tagged `"everyone"` (Idea, Research, Summarize) are shared pipeline scaffolding and appear
  in every role view.
- Selecting the **Designer**, **Developer**, **Product** or **SDLC** profile filters the palette to
  boxes tagged with that role — plus all `"everyone"` boxes.
- The six SDLC stage boxes are tagged `["sdlc"]` only, so the other profiles stay unchanged; the
  SDLC profile is the pipeline plus the shared scaffolding (Idea, Documents, Research, Note, …).
- The selection is persisted per user in `localStorage` (`ai-canva:sidebar-role`) so it acts like a
  lightweight profile. Filtering never hides boxes already on the canvas — it only declutters which
  ones you can add.
- Give a box multiple roles when it spans personas (e.g. `slides: ["product", "designer"]`).

Tagging a box does not affect collaboration, the canvas, or `runBox` — it is purely a UI filter.

## Adding a new box type

1. Add a `BoxType` union member and a `BOX_TYPES` entry in `client/src/types.ts` (including its
   `roles` tags and `category` — see above).
2. Register it in `Canvas.tsx` (`nodeTypes`) and the MiniMap color map.
3. Add a render/output branch in `BoxNode.tsx`.
4. Add run behavior in `boardStore.ts` `runBox()` (or route to an existing branch — a plain text
   box needs no branch at all).
5. Add any new backend endpoint in `server/src/index.ts` **and** `functions/src/index.ts`.
6. Update the box-type tables in the README and this document.
