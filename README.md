# AI Canva

> Build AI pipelines visually. Place boxes on a canvas, connect them, and run AI prompts that flow content from box to box.

A collaborative, AI-powered whiteboard where you compose visual pipelines of AI "boxes". Drop an **Idea** box, connect it to a **Research** box, run an AI model, then chain the output into a **PRD**, **Slides**, **Code**, **UI Design**, or **Stitch UI** box. Watch your ideas flow from research to a working prototype — without leaving the canvas.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 📚 Documentation

| Guide | What it covers |
|-------|----------------|
| [Project Overview](docs/OVERVIEW.md) | What AI Canva is, how it works, and what you can learn from it |
| [Onboarding & Environment Setup](docs/ONBOARDING.md) | Get from a clean machine to a running app, step by step |
| [Architecture](docs/ARCHITECTURE.md) | Deep dive into the client, backend, and Firebase layers |
| [Box Types](docs/BOX_TYPES.md) | Every box and how to add a new one |
| [API](docs/API.md) | The backend endpoints and environment variables |
| [Deployment](docs/DEPLOYMENT.md) | Ship it to Firebase Hosting + Functions |
| [Testing](docs/TESTING.md) | Running and writing Vitest unit tests for server + client |
| [Open-Source Readiness](docs/OSS_READINESS.md) | Pre-launch security and project checks |

### 📘 Course guides

Course materials for using AI Canva as a teaching/learning project. A complete set of briefs and how-to guides that build on the same codebase:

| Guide | What it covers |
|-------|----------------|
| [Intro Message for Students](docs/course/00_intro_message.md) | Kick-off message to post to your class |
| [What is AI Canva?](docs/course/01_what_is_ai_canva.md) | Beginner's intro: the big idea, box types, how it works, architecture |
| [Student Brief — One Box per Student](docs/course/02_student_brief_one_box.md) | Individual assignment: each student designs & builds one box |
| [Group Brief — Cybersecurity & Compliance](docs/course/03_cyber_group_brief.md) | Group project: turn AI Canva into a security/compliance support tool |
| [Group Brief — UX for Telstra Health](docs/course/04_ux_health_group_brief.md) | Group project: turn AI Canva into a UX design support tool for healthcare |
| [How to Build a Box](docs/course/05_how_to_build_a_box.md) | Step-by-step: add a new box + branching/code-management rules for beginners |
| [Group Brief — Telstra Innovation Lab](docs/course/06_telstra_innovation_brief.md) | Group project: turn AI Canva into an innovation accelerator (market research, rapid prototyping) |
| [Group Brief — NBN Collaboration](docs/course/07_nbn_collab_brief.md) | Group project: help non-technical roles (UX/BA/product/content) collaborate faster |

> Each guide also ships as a print-friendly **HTML handout** (`docs/course/*.html`) — open in any
> browser and use *Print → Save as PDF* for a clean handout.

> **Teaching with this project?** Point students at the [What is AI Canva?](docs/course/01_what_is_ai_canva.md)
> guide first, then the [How to Build a Box](docs/course/05_how_to_build_a_box.md) walkthrough and the
> relevant project brief (individual or group).

---

## ✨ Features

- **Visual pipelines** — drag boxes onto a canvas and connect them; content flows box to box.
- **26 box types** — Idea, Image, Documents, the six gated **SDLC stages** (Intent, Spec, Plan,
  Implementation, Review, Merge), Research, Summarize, PRD, Dev Plan, **Code Map**, **Code Edit**,
  Cartoon Profile, Slides, Code, UI Design, Stitch UI, plus Notes / Labels / Timers / the shared
  team **Checklist** and your own custom boxes.
- **Gated SDLC pipeline** — walk one change request through intent → spec → plan → implementation →
  review → merge, approving (or sending back, rejecting, editing) each artifact at its gate. Every
  version is append-only, an unapproved stage blocks the next one, and the whole chain exports as
  one audit document.
- **Download any box's outcome** — `💾 Save` writes a box's real output to a Markdown file
  (`intent.md`, `spec.md`, `research.md`, …), ready to paste into a repo or a PR.
- **Read any GitHub repo** — the **Code Map** worker fetches a repository (public ones need no setup)
  and writes an orientation brief: what the code does, how it is structured, the main flows, the
  risks, and where to start reading.
- **Modify an existing repo** — the **Code Edit** worker reads the files a change touches, proposes the
  edit as a reviewable diff, and hands you a `git apply`-able `.patch`. Nothing is pushed anywhere.
- **AI-powered** — Ollama (LLM) for text, fal.ai for image generation, Google Stitch for production-quality UI screens.
- **Real-time collaboration** — share boards by email, live cursors with names/colors, and live multi-user editing via Firestore.
- **Cloud persistence** — boards auto-save to Firestore (with localStorage as an offline cache). Sign in with Google to use the app; your boards are stored per user.
- **Editable prompt templates** — reference connected inputs by name (`{{Box Name}}`, `{{input_1}}`, `{{inputs}}`) right in the settings panel.
- **Live code previews** — Code and UI boxes render generated React components in an iframe with copy/save.
- **Deploy straight from a box** — any Code, UI Design, Stitch UI or Code Edit box publishes to a live
  URL with 🚀 Deploy (here.now): the prototype plus its source, updatable in place, with the expiry
  and claim link surfaced for anonymous sites.
- **Ask the AI for changes** — once a Code or UI box has produced code, type a change request and press
  ✏️ Apply change: you get the updated component, a diff of exactly what moved, and a version history
  with one-click revert.

## 📦 Box Types

| Box | Icon | Type | Description |
|-----|------|------|-------------|
| **Idea** | 💡 | Input | Free-text input. No AI — just write your idea. The seed of most pipelines. |
| **Image** | 🖼️ | Input | Upload an image (auto-resized to ≤1024px). Becomes input for downstream boxes. |
| **Documents** | 📎 | Input | Upload PDFs/Word/text files — extracted text becomes input for downstream boxes. |
| **Intent** | 🎯 | SDLC 1 | Turns a raw change request into an intent doc, keeping every open question visible. Always gated. |
| **Spec** | 📐 | SDLC 2 | Resolves each open question with an explicit rule, applying your org skills. Unresolved items keep it gated. |
| **Plan** | 🧭 | SDLC 3 | Files, order of work, and a named test for every spec decision (the app flags any decision with no test). |
| **Implementation** | 🛠️ | SDLC 4 | The diff plus per-test evidence; a plan deviation is surfaced, not silently absorbed. |
| **Review** | 🔎 | SDLC 5 | Findings tagged blocking / important / nit. Blocking findings block the merge until dismissed. |
| **Merge** | 🚀 | SDLC 6 | The merge record (checklist, commit message, PR body). Approving it is the recorded ship decision. |
| **Research** | 🔍 | Worker | Runs an AI prompt over connected inputs and returns research findings. |
| **Summarize** | 📋 | Worker | Combines multiple upstream inputs into a concise AI summary. |
| **PRD** | 📄 | Worker | Generates a Product Requirements Document (features, user stories, specs) — ideal input for the Code box. |
| **Dev Plan** | 🗺️ | Worker | Transforms a PRD into a short, practical development plan (components, state, functions, build order). |
| **Code Map** | 🔭 | Worker | Reads a GitHub repository and writes an orientation brief — structure, entry points, main flows, risks, and where to start reading. |
| **Code Edit** | ✍️ | Worker | Applies a change request to an existing repo: reads the files it needs, proposes the edit as a reviewable diff, and gives you a `.patch` to apply. |
| **Cartoon Profile** | 🎨 | Worker | Generates a cartoon avatar via fal.ai — image-to-image from an Image box, or text-to-image from an Idea box. |
| **Slides** | 📊 | Worker | Generates a visual pitch deck with prev/next navigation. |
| **Code** | 💻 | Worker | Generates a React prototype with a live preview, copy, and download. |
| **UI Design** | ✨ | Worker | Generates production-quality React UIs with Tailwind CSS + Google Fonts. |
| **Stitch UI** | 🧵 | Worker | Generates UI screens using Google Stitch; returns polished HTML directly. |
| **Note / Label / Timer** | 🗒️ | Collab | Standalone annotation tools — no AI, no Run button, no connections. |
| **Checklist** | ✅ | Collab | A shared team to-do list: anyone adds, assigns, reorders and ticks off tasks; everyone sees the same list live. |
| **Chatbot** | 🧍 | Companion | A stick-figure companion that lives on the board and chats with the team. |
| **Custom** | ✨ | Custom | Your own saved AI box templates, created in the sidebar. |

> The six **SDLC** boxes are also selectable as a View profile in the sidebar, next to Designer /
> Developer / Product. The gated pipeline is described in `docs/BOX_TYPES.md`.

---

## 🚀 Quick Start (local development)

### 1. Clone and install

```bash
git clone <your-repo-url> ai-canva
cd ai-canva
npm install                 # root tooling (concurrently)
npm run install:all         # installs server/ + client/ deps
```

### 2. Configure API keys

```bash
cp server/.env.example server/.env
# Edit server/.env and fill in real keys:
#   OLLAMA_API_KEY=your-ollama-api-key              # https://ollama.com/settings/keys
#   FAL_KEY=your-fal-key-here                      # https://fal.ai/dashboard/keys
#   STITCH_API_KEY=your-stitch-key-here            # https://stitch.withgoogle.com
```

The server works without Firebase for local experimentation. It only needs the AI keys above
(`OLLAMA_API_KEY` is required for text boxes; `FAL_KEY` for Cartoon boxes; `STITCH_API_KEY` for
Stitch UI boxes). By default it calls **Ollama Cloud** at `https://ollama.com` — set `OLLAMA_MODEL`
in `server/.env` to choose a model (see `server/.env.example`).

### 3. Run

```bash
npm run dev
```

- **Client (Vite):** http://localhost:5173
- **Server (Express):** http://localhost:3001 (or the next available port)

Both processes detect if their default port is in use and switch to the next free one. The client reads the server's actual port from `.server-port` so its `/api` proxy always works.

> **Optional:** To use accounts, cloud save, real-time collaboration, and image uploads, set up Firebase (see [Deployment](docs/DEPLOYMENT.md)) and put your project's config into `client/src/lib/firebase.ts`.

---

## 🎨 Using the app

1. Click **+ Add** in the top bar to open the box panel (or use the collapsed tab on the right).
2. Click a box type to add it. Type your idea in an **Idea** box, or upload an image in an **Image** box.
3. **Connect** boxes: drag from a box's right edge (`●`) to another box's left edge (`●`).
4. Click **▶ Run** on any AI box to generate its output.
5. Click **⚙** to edit a box's prompt template, system prompt, and inputs.
6. **Resize** any box: click it, then drag the corner/edge handles.
7. Click a box's title to **rename** it.

### Prompt template variables

AI boxes use prompt templates that fill in values from connected upstream boxes:

| Variable | Meaning |
|----------|---------|
| `{{Box Name}}` | The output of a connected box, matched by that box's **name** (case-insensitive). |
| `{{input_1}}`, `{{input_2}}` | Positional references to the Nth connected input. |
| `{{input}}` | Alias for the first input. |
| `{{inputs}}` | All connected inputs, concatenated and labeled by box name. |

In the settings panel you can click a connected box's name (or `{{inputs}}`) to insert the variable at the cursor.

### Example pipelines

**Research → summary**

```
Idea Box ──▶ Research Box ──▶ Summarize Box
             Research Box 2 ──┘
```

**Full product flow (recommended for code generation)**

```
Idea Box ──▶ Research Box ──▶ PRD Box ──▶ Dev Plan ──▶ Code Box
```

**Pitch deck**

```
Idea Box ──▶ Research Box ──▶ Slides Box
```

**Cartoon avatar** — connect an **Image** box for image-to-image, or an **Idea** box for text-to-image.

---

## 👥 Collaboration

When signed in with Google, your boards live in Firestore.

- **Boards** — open **📋 Boards** in the header to list, switch, create, or delete boards.
- **Share** — click **👥 Share** to get a share link, or add collaborators by email.
- **Live cursors** — active collaborators appear as colored avatars in the header; their cursors show on the canvas in real time.
- **Open a shared board** — visit `your-app/?board=<boardId>`.
- **Persistence** — boards auto-save to Firestore (debounced ~1s after changes). When not signed in, boards save only to localStorage.

---

## 🗂️ Project structure

```
ai-canva/
├── client/                 # Vite React app
│   └── src/
│       ├── components/      # Canvas, BoxNode, Sidebar, Toolbar, modals, LandingPage
│       ├── store/            # Zustand stores (board + auth)
│       ├── lib/              # API client, prompts, firebase/firestore/storage, code helpers
│       ├── types.ts          # Box types + metadata
│       ├── App.tsx           # Shell / layout
│       └── main.tsx          # Entry point
├── server/                   # Express API (local dev backend)
│   └── src/                  # index.ts, ollama.ts, fal.ts, stitch.ts, findPort.ts
├── functions/                # Firebase Cloud Functions (production backend)
│   └── src/                  # Mirrors the server API
├── firestore.rules           # Firestore security rules
├── storage.rules             # Storage security rules
└── firebase.json             # Firebase hosting/functions/firestore/storage config
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a deep dive, [docs/API.md](docs/API.md) for the backend endpoints, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to deploy to Firebase.

---

## 🔐 Security rules

The repo ships a `firestore.rules` and `storage.rules` intended to keep each user's boards private. **Note:** the current `firestore.rules` contain a permissive placeholder (any signed-in user can read/update any board) — see [docs/OSS_READINESS.md](docs/OSS_READINESS.md) for the recommended fix before deploying publicly.

---

## 🤝 Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? Report it per [SECURITY.md](SECURITY.md).

## 📜 License

Released under the [MIT License](LICENSE).
