# Deployment

You can run AI Canva two ways:

1. **Local development** — Vite + the local Express server (see the [README](../README.md)).
2. **Production on Firebase** — build the client, deploy static hosting, and run the API as a
   Cloud Function.

This guide covers the Firebase deployment path, plus notes for self-hosting the server yourself.

> **Quick path:** run `bash scripts/deploy.sh` (or `npm run deploy`) for a one-command deploy that
> builds the client, clean-builds the Functions, syncs `OLLAMA_API_KEY` into `functions/.env`,
> and deploys Hosting + Functions + rules. An AI agent can follow the same steps via the
> **`ai-canva-deploy`** skill (`.dsh/skills/ai-canva-deploy/SKILL.md`). The rest of this page
> documents what the script does manually.

---

## Prerequisites

- A [Firebase](https://console.firebase.google.com) project.
- The [Firebase CLI](https://firebase.google.com/docs/cli) installed and logged in:
  ```bash
  npm install -g firebase-tools
  firebase login
  ```
- Real API keys (Ollama, and optionally fal.ai + Google Stitch).

## 2. Enable Firebase services

1. **Authentication** — Console → Authentication → Sign-in method → **Google** → Enable.
2. **Firestore** — Console → Firestore Database → Create database (start in production mode).
3. **Storage** — Console → Storage → Get started.
4. **Hosting** — no console step needed; enabled by the deploy config.

## 3. Point the app at your Firebase project

The client config lives in `client/src/lib/firebase.ts`. Replace the hardcoded `firebaseConfig`
with your own project's web app config:

```
Console → Project Settings → Your apps → Web app → SDK setup and configuration
```

Copy the `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId`
into `firebaseConfig`.

> **For open hosting:** prefer reading these from environment variables (`VITE_FIREBASE_*`) at
> build time rather than hardcoding them. See [OSS_READINESS.md](OSS_READINESS.md).

## 4. Publish security rules

Deploy the rules that ship in the repo:

```bash
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
```

> **Important:** `firestore.rules` currently contains a **permissive placeholder** (any signed-in
> user can read/update any board). Before deploying to the public, replace it with the
> ownership/collaborator rules in [OSS_READINESS.md](OSS_READINESS.md).

## 5. Configure the Cloud Function environment

Create `functions/.env` from `functions/.env.example` and set your real keys:

```bash
cp functions/.env.example functions/.env
# OLLAMA_API_KEY=your-ollama-api-key
# OLLAMA_MODEL=deepseek-v4.1-flash
# FAL_KEY=...
# STITCH_API_KEY=...
```

> `functions/.env` is git-ignored. Never commit real keys.

## 6. Set the deploy target project

The repo ships a `.firebaserc` with `carbondocs` as the default project. Set it to your project:

```bash
firebase use <your-project-id>
```

## 7. Build and deploy

```bash
# Build the client (produces client/dist)
cd client && npm run build && cd ..

# Deploy hosting + functions + rules
firebase deploy
```

This deploys:
- **Hosting** — the built client at your Firebase Hosting URL. `firebase.json` rewrites `/api/**`
  to the `api` Cloud Function and all other routes to `index.html` (SPA).
- **Functions** — the `api` Cloud Function (`onRequest`), configured for `maxInstances: 5`,
  `timeoutSeconds: 120`, `memory: 512MiB`.

After deploy, open your Hosting URL. Sign in with Google to get cloud save and collaboration.

---

## Self-hosting the server instead

If you'd rather not use Firebase Functions, you can run the Express server directly:

```bash
cd server
npm run build && npm start
```

Set `PORT` in `server/.env` if needed. In this mode the client still needs Firebase for auth and
persistence, and the Vite proxy (dev only) must point `/api` at your server — in production you'd
configure your reverse proxy / CDN to forward `/api` to the server.

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| `OLLAMA_API_KEY is not configured` / request fails | The key is missing from `functions/.env` or `server/.env`. |
| Boards don't sync | Auth is enabled + rules permit access; the user is signed in. |
| `404` on `/api/*` in prod | Cloud Function named `api` exists and hosting rewrites are in `firebase.json`. |
| Deploy fails on rules | Replace the placeholder rules with the strict ones from OSS_READINESS. |
