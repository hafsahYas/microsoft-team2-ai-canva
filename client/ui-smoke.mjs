/**
 * Live UI smoke test for the SDLC pipeline group, the Code Map worker, the
 * Code Edit worker, AI change requests in the Code box, here.now box deploys and
 * the per-box outcome downloads.
 * Drives the REAL dev app (localhost:5173) with /api/generate mocked at the
 * page level so the artifacts are deterministic.
 *
 * Run: node ui-smoke.mjs
 */
import { chromium } from "playwright-core";

const APP = "http://localhost:5173";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 160)));

await page.goto(APP, { waitUntil: "load" });
await page.waitForTimeout(2000);

// ---- seed a fake user (dev-only hooks) ----
await page.evaluate(() => {
  window.__dsh.useAuthStore.setState({
    user: { uid: "smoke-uid", email: "smoke@test.local", displayName: "Smoke Tester", photoURL: "" },
    loading: false,
  });
});
await page.waitForTimeout(1500);

// ---- mock /api/generate + /api/repo-digest with deterministic artifacts ----
// (A function because the reload check below wipes injected mocks.)
const installMocks = () => page.evaluate(() => {
  const original = window.fetch;
  window.__smoke = { prompts: [], calls: 0 };
  window.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : url.url;
    if (u.includes("/api/repo-digest")) {
      const config = window.__smokeRepo || { mode: "ok" };
      if (config.mode === "fail") {
        return new Response(JSON.stringify({ error: "Repository or branch not found. If it is private, set GITHUB_TOKEN on the server." }), {
          status: 502, headers: { "Content-Type": "application/json" },
        });
      }
      const body = JSON.parse(opts?.body || "{}");
      window.__smoke.repoRequests = window.__smoke.repoRequests || [];
      window.__smoke.repoRequests.push(body.repoUrl || "");
      return new Response(JSON.stringify({
        ok: true,
        repo: config.repo || "alexbonti/ai-canva",
        branch: config.branch || "main",
        digest: "Repository: " + (config.repo || "alexbonti/ai-canva") + "@" + (config.branch || "main") + "\n\n## File tree\n\nsrc/\n  index.ts\n\n## File contents\n\n### src/index.ts (0.1 KB)\n\n```ts\nexport const start = () => {};\n```",
        files: 3,
        treeEntries: 120,
        chars: 4200,
        truncated: true,
        notes: ["Ignored 9 generated/binary/lock file(s).", "Clipped 1 large file(s) to the first 20 KB: boardStore.ts."],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/api/generate")) {
      const body = JSON.parse(opts?.body || "{}");
      const prompt = body.userPrompt || "";
      window.__smoke.prompts.push(prompt);
      window.__smoke.calls++;
      let content = "# Artifact\nnot a known stage";
      // Most specific prompts first — the review prompt also contains the words
      // "implementation artifact".
      if (prompt.includes("Review the implementation artifact")) {
        content = "# Review\n\n## Summary\nOne blocker.\n\n## Findings\n| severity | description | location |\n|---|---|---|\n| blocking | No rate limit on the SSO callback | api/auth.ts:42 |\n| nit | Typo in a comment | api/auth.ts:80 |\n\n## Test evidence assessment\nTests were NOT RUN — evidence is expected behaviour only.\n\n## Residual risk\nProvider outage.\n\n```json\n[{\"severity\":\"blocking\",\"description\":\"No rate limit on the SSO callback\",\"location\":\"api/auth.ts:42\"},{\"severity\":\"nit\",\"description\":\"Typo in a comment\",\"location\":\"api/auth.ts:80\"}]\n```\n";
      } else if (prompt.includes("Prepare the merge record")) {
        content = "# Merge record: Add SSO\n\n## Pre-merge checklist\n- Intent approved\n- Spec decisions resolved\n\n## Change summary\nSSO for the admin console.\n\n## Commit message\nfeat(auth): add SAML SSO to the admin console\n\n## PR title and body\nSSO.\n\n## Manual follow-ups after merge\nWatch the provider error rate.\n";
      } else if (prompt.includes("implementation plan")) {
        content = "# Plan: Add SSO\n\n## Files to change\n- `api/auth.ts` — add SAML flow\n\n## Implementation order\n1. Add the SAML client\n\n## Tests\n- \"Session length cap\" → proves Decision 1\n\n## Risks\nWide blast radius on the auth middleware.\n\n## Rollback\nFeature flag.\n";
      } else if (prompt.includes("implementation artifact")) {
        content = "# Implementation: Add SSO\n\n## Diff\n```diff\n+ const session = await saml.exchange(assertion);\n```\nApplied to `api/auth.ts`.\n\n## Tests\n- \"Session length cap\" → NOT RUN (no repo access)\n\n## Plan deviations\nStep 1 also needed a new dependency (@node-saml/passport-saml).\n\n## Follow-ups\nTrack the dep.\n";
      } else if (prompt.includes("spec document")) {
        content = "# Spec: Add SSO\n\n## Scope\nAdmin console sign-in.\n\n## Decisions\n### Decision 1 — Session length\nCap sessions at 8 hours.\n\n### Decision 2 — Audit log retention\nKeep audit logs for 400 days.\n\n## Skill constraints applied\n- No PII in logs: constrained the audit record fields.\n\n## Interfaces and data model\nSAML assertion → session.\n\n## Non-functional requirements\np95 login < 2s.\n\n## Acceptance criteria\nStaff can sign in.\n\n## Unresolved\n⚠ Rollout order for the three regions is unknown\n";
      } else if (prompt.includes("code map")) {
        content = "# Code Map: alexbonti/ai-canva\n\n## What this codebase is\nA whiteboard that turns a repo into an orientation brief.\n\n## Tech stack\nReact + Vite + Firebase (from client/package.json).\n\n## Structure\n- `client/ — the React app`\n- `server/ — the local API`\n\n## Entry points\n- client/src/main.tsx\n- server/src/index.ts\n\n## Where to start reading\n1. client/src/types.ts\n";
      } else if (prompt.includes("intent document")) {
        content = "# Add SSO to the admin console\n\n## Problem statement\n\"Add SSO.\"\n\n## Proposed outcome\nStaff log in with the company IdP.\n\n## Affected users / systems\nAdmin console, identity provider.\n\n## Constraints\nMust ship this quarter.\n\n## Open questions\n- Which identity provider is authoritative?\n- What happens to existing sessions on rollout?\n";
      }
      return new Response(
        JSON.stringify({ content, model: "smoke-model", usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return original(url, opts);
  };
  // Keep a way to restore.
  window.__restoreFetch = () => { window.fetch = original; };
});
await installMocks();

// ---- palette: SDLC section with the six stages in order ----
const sidebarText = await page.evaluate(() => document.querySelector(".absolute.right-0")?.innerText || document.body.innerText);
check("P1 palette shows an SDLC section", /\bSDLC\b/.test(sidebarText));
const paletteOrder = await page.evaluate(() => {
  const label = (b) => (b.querySelector("span:last-child")?.textContent || "").trim();
  const rows = [...document.querySelectorAll("button.palette-row")].map(label);
  return rows.filter((r) => /^\d+ · /.test(r));
});
check(
  "P2 palette lists the six stages in order",
  JSON.stringify(paletteOrder) === JSON.stringify(["1 · Intent", "2 · Spec", "3 · Plan", "4 · Implementation", "5 · Review", "6 · Merge"]),
  paletteOrder.join(" | ")
);
check("P3 View profile offers SDLC", await page.evaluate(() => [...document.querySelectorAll("select option")].some((o) => o.value === "sdlc")));

// ---- build the pipeline through the real store actions ----
const ids = await page.evaluate(async () => {
  const s = () => window.__dsh.useBoardStore.getState();
  const idea = s().addBox("idea", { x: 40, y: 40 });
  s().updateBoxData(idea, { content: "Add SSO to the admin console." });
  const intent = s().addBox("sdlc-intent", { x: 380, y: 40 });
  const spec = s().addBox("sdlc-spec", { x: 720, y: 40 });
  const plan = s().addBox("sdlc-plan", { x: 1060, y: 40 });
  const impl = s().addBox("sdlc-implement", { x: 1400, y: 40 });
  const review = s().addBox("sdlc-review", { x: 1400, y: 540 });
  const merge = s().addBox("sdlc-merge", { x: 1060, y: 540 });
  s().connectBoxes(idea, intent);
  s().connectBoxes(intent, spec);
  s().connectBoxes(spec, plan);
  s().connectBoxes(plan, impl);
  s().connectBoxes(impl, review);
  s().connectBoxes(review, merge);
  return { idea, intent, spec, plan, impl, review, merge };
});
check("P4 pipeline wired (6 stages + idea seed)", Object.keys(ids).length === 7);

const stage = (id) => page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return {
    status: d.status,
    error: d.error || "",
    gate: d.sdlcGate || "",
    versions: (d.sdlcVersions || []).map((v) => v.version),
    output: (d.output || "").slice(0, 60),
    openItems: d.sdlcOpenItems || [],
    gaps: d.sdlcGaps || [],
    deviation: !!d.sdlcDeviation,
    findings: (d.sdlcFindings || []).map((f) => `${f.severity}:${f.dismissed}`),
    history: (d.sdlcHistory || []).map((e) => e.action),
    approvedBy: d.sdlcApprovedBy || "",
    approvedVersion: d.sdlcApprovedVersion ?? null,
    gateRequired: d.sdlcGateRequired,
  };
}, id);

// ---- gate blocks the next stage before any model call ----
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ids.spec);
let specState = await stage(ids.spec);
check("G1 spec refuses to run before intent is approved", specState.status === "error" && /(not approved|produced no artifact)/i.test(specState.error), specState.error.slice(0, 70));
check("G2 no model call was made for the blocked stage", (await page.evaluate(() => window.__smoke.calls)) === 0);

// ---- run + approve intent ----
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ids.intent);
let intentState = await stage(ids.intent);
check("G3 intent generated v1 and is pending", intentState.status === "done" && intentState.versions.join() === "1" && intentState.gate === "pending");
check("G4 artifact mirrors the latest version (downstream {{inputs}} keeps working)", intentState.output.startsWith("# Add SSO"));

await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().approveArtifact(boxId), ids.intent);
intentState = await stage(ids.intent);
check("G5 approve records gate, version and approver", intentState.gate === "approved" && intentState.approvedVersion === 1 && intentState.approvedBy === "Smoke Tester");
check("G6 approval is in the audit trail", intentState.history.some((a) => /approved intent v1/.test(a)), intentState.history.join(" | "));

// ---- spec: unresolved item keeps it gated ----
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ids.spec);
specState = await stage(ids.spec);
check("S1 spec ran after the intent approval", specState.status === "done" && specState.output.startsWith("# Spec"), specState.error);
check("S2 app detected the unresolved item itself", specState.openItems.length === 1 && /Rollout order/.test(specState.openItems[0]), JSON.stringify(specState.openItems));
check("S3 unresolved item forces the gate even with auto-advance turned off", await page.evaluate(async (boxId) => {
  const s = () => window.__dsh.useBoardStore.getState();
  const accepted = s().setSdlcGateRequired(boxId, false);
  const gateOff = s().boxData[boxId].sdlcGateRequired === false;
  return accepted === false && gateOff === false;
}, ids.spec));

check("S4 hard gates refuse auto-advance too", await page.evaluate(async (boxId) => {
  const s = () => window.__dsh.useBoardStore.getState();
  return s().setSdlcGateRequired(boxId, false) === false; // merge
}, ids.merge));

// ---- spec approval → plan, with the app-side test cross-check ----
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().approveArtifact(boxId), ids.spec);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ids.plan);
const planState = await stage(ids.plan);
check("S5 plan ran after the spec approval", planState.status === "done" && planState.output.startsWith("# Plan"), planState.error);
check("S6 app cross-checked spec decisions against the plan's tests", planState.gaps.length === 1 && /Audit log retention/.test(planState.gaps[0]), JSON.stringify(planState.gaps));
check("S7 the missing-test gap is recorded in the trail", planState.history.some((a) => /no named test/.test(a)), planState.history.join(" | "));

// ---- edit the plan artifact → new version, downstream invalidation, gap re-derived ----
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().editArtifact(boxId, "# Plan: Add SSO\n\n## Tests\n- \"Session length cap\" → Decision 1\n- \"Audit log retention\" → Decision 2\n", "edited at the gate"), ids.plan);
const editedPlan = await stage(ids.plan);
check("S8 editing appends a new version (never overwrites)", editedPlan.versions.join() === "1,2" && editedPlan.gate === "pending");
check("S9 editing cleared the cross-check once the test was named", editedPlan.gaps.length === 0);
check("S10 edit is attributed in the trail", editedPlan.history.some((a) => /edited plan v2/.test(a)));

// ---- approve plan → implementation (deviation detected) ----
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().approveArtifact(boxId), ids.plan);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ids.impl);
const implState = await stage(ids.impl);
check("I1 implementation ran", implState.status === "done" && implState.output.startsWith("# Implementation"), implState.error);
check("I2 app detected the reported plan deviation", implState.deviation === true);

// ---- regenerate the APPROVED intent: downstream approvals go stale ----
await page.evaluate(async (boxId) => { const s = () => window.__dsh.useBoardStore.getState(); await s().runBox(boxId); }, ids.intent);
const intentAfter = await stage(ids.intent);
const specAfter = await stage(ids.spec);
const planAfter = await stage(ids.plan);
check("R1 regenerating intent appends v2 and returns the gate to pending", intentAfter.versions.join() === "1,2" && intentAfter.gate === "pending");
check("R2 downstream approvals are marked stale", specAfter.gate === "stale" && planAfter.gate === "stale", `spec=${specAfter.gate} plan=${planAfter.gate}`);
check("R3 staleness is explained in the trail", specAfter.history.some((a) => /marked stale/.test(a)), specAfter.history.slice(-2).join(" | "));
check("R4 a stale upstream blocks the stage below it", await page.evaluate(async (boxIds) => {
  const s = () => window.__dsh.useBoardStore.getState();
  await s().runBox(boxIds.impl);
  return s().boxData[boxIds.impl].status === "error" && /not approved/i.test(s().boxData[boxIds.impl].error || "");
}, ids));

// ---- review: findings parsed, blocking blocks the merge ----
await page.evaluate(async (boxIds) => { const s = () => window.__dsh.useBoardStore.getState(); await s().approveArtifact(boxIds.intent); await s().runBox(boxIds.spec); await s().approveArtifact(boxIds.spec); await s().runBox(boxIds.plan); await s().approveArtifact(boxIds.plan); await s().runBox(boxIds.impl); await s().approveArtifact(boxIds.impl); await s().runBox(boxIds.review); }, ids);
const reviewState = await stage(ids.review);
check("V1 review ran and findings were parsed by the app", reviewState.findings.length === 2 && reviewState.findings.includes("blocking:false"), JSON.stringify(reviewState.findings));

await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().approveArtifact(boxId), ids.review);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ids.merge);
let mergeState = await stage(ids.merge);
check("V2 merge is blocked while a blocking finding is open", mergeState.status === "error" && /blocking finding/i.test(mergeState.error), mergeState.error.slice(0, 80));

// ---- UI: the gate panel renders and reacts ----
await page.waitForTimeout(600);
const panelText = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".box-node")];
  const review = nodes.find((n) => n.innerText.includes("5 · Review"));
  return review ? review.innerText : "";
});
check("V3 gate panel renders the state, the parsed finding and its severity", /Approved/.test(panelText) && /No rate limit/.test(panelText) && /blocking/i.test(panelText) && /1 blocking/.test(panelText), panelText.slice(0, 160).replace(/\n/g, " / "));
check("V4 the panel offers Approve / Request changes / Reject / Edit", ["Approve", "Request changes", "Reject", "Edit"].every((t) => panelText.includes(t)));

// dismiss the blocking finding through the UI (real click)
const dismissed = await page.evaluate(async () => {
  const nodes = [...document.querySelectorAll(".box-node")];
  const review = nodes.find((n) => n.innerText.includes("5 · Review"));
  const btn = [...review.querySelectorAll("button")].find((b) => b.textContent.trim() === "Dismiss");
  if (!btn) return false;
  btn.click();
  await new Promise((r) => setTimeout(r, 300));
  const d = window.__dsh.useBoardStore.getState();
  const boxId = Object.keys(d.boxData).find((k) => (d.boxData[k].sdlcFindings || []).length > 0);
  return (d.boxData[boxId].sdlcFindings || []).some((f) => f.severity === "blocking" && f.dismissed);
});
check("V5 dismissing a blocking finding through the UI unlocks the merge", dismissed);

// ---- downloads ----
const downloadDir = "/tmp/sdlc-downloads";
await page.evaluate(() => window.__dsh.useBoardStore.getState().approveArtifact(
  Object.keys(window.__dsh.useBoardStore.getState().boxData).find((k) => window.__dsh.useBoardStore.getState().boxData[k].sdlcFindings?.length > 0)
));
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ids.merge);
mergeState = await stage(ids.merge);
check("D1 merge runs once the blocker is dismissed and review is approved", mergeState.status === "done" && mergeState.output.startsWith("# Merge record"), mergeState.error);

const [saveDl] = await Promise.all([
  page.waitForEvent("download"),
  page.evaluate(async () => {
    const nodes = [...document.querySelectorAll(".box-node")];
    const intent = nodes.find((n) => n.innerText.includes("1 · Intent"));
    const btn = [...intent.querySelectorAll("button")].find((b) => b.textContent.trim() === "💾 Save");
    if (!btn) throw new Error("no Save button on the intent box");
    btn.click();
  }),
]);
check("D2 💾 Save downloads the box's outcome as intent.md", saveDl.suggestedFilename() === "intent.md", saveDl.suggestedFilename());
const saved = await saveDl.path();
const savedText = saved ? await (await import("node:fs/promises")).readFile(saved, "utf8") : "";
check("D3 the saved file is the artifact itself", savedText.includes("# Add SSO to the admin console"), savedText.slice(0, 40));

const [auditDl] = await Promise.all([
  page.waitForEvent("download"),
  page.evaluate(async () => {
    const nodes = [...document.querySelectorAll(".box-node")];
    const review = nodes.find((n) => n.innerText.includes("5 · Review"));
    const btn = [...review.querySelectorAll("button")].find((b) => b.textContent.trim().includes("Audit"));
    if (!btn) throw new Error("no Audit button");
    btn.click();
  }),
]);
const auditText = await (await import("node:fs/promises")).readFile(await auditDl.path(), "utf8");
check("D4 🗂 Audit downloads the whole chain", auditDl.suggestedFilename().startsWith("sdlc-audit-"), auditDl.suggestedFilename());
check("D5 audit doc has every stage, an approval, the findings and a JSON appendix",
  /## 1 · Intent/.test(auditText) && /## 6 · Merge/.test(auditText) && /Approved by Smoke Tester/.test(auditText) && /No rate limit/.test(auditText) && /## Machine-readable record/.test(auditText),
  auditText.length + " chars");

// ---- persistence: reload keeps versions and gates ----
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__dsh.useAuthStore.setState({
  user: { uid: "smoke-uid", email: "smoke@test.local", displayName: "Smoke Tester", photoURL: "" }, loading: false,
}));
await page.waitForTimeout(1200);
await installMocks();
const afterReload = await page.evaluate(() => {
  const d = window.__dsh.useBoardStore.getState().boxData;
  const intent = Object.values(d).find((b) => (b.sdlcVersions || []).length > 1 && b.sdlcHistory);
  return {
    boxes: Object.values(d).filter((b) => (b.sdlcVersions || []).length > 0).length,
    intents: intent ? intent.sdlcVersions.length : 0,
    merged: Object.values(d).some((b) => (b.output || "").startsWith("# Merge record")),
    approvedStages: Object.values(d).filter((b) => b.sdlcGate === "approved").length,
  };
});
check("P5 versions and gates survive a reload", afterReload.boxes === 6 && afterReload.intents === 2 && afterReload.merged && afterReload.approvedStages >= 1, JSON.stringify(afterReload));

// ---- View filter ----
const filtered = await page.evaluate(async () => {
  const sel = document.querySelector("select");
  sel.value = "sdlc";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const label = (b) => (b.querySelector("span:last-child")?.textContent || "").trim();
  const rows = [...document.querySelectorAll("button.palette-row")].map(label);
  return { rows, stored: localStorage.getItem("ai-canva:sidebar-role") };
});
check("F1 SDLC view profile filters the palette to the stages (+ shared scaffolding)",
  filtered.rows.filter((r) => /^\d+ · /.test(r)).length === 6 && !filtered.rows.some((r) => /Cartoon|Stitch UI/.test(r)),
  filtered.rows.join(" | ").slice(0, 120));
check("F2 the profile persists", filtered.stored === "sdlc");

// ---------- Code Map worker: reads a repository, writes an orientation brief ----------

check("C1 palette offers the Code Map worker", await page.evaluate(() =>
  [...document.querySelectorAll("button.palette-row")].some((b) => (b.querySelector("span:last-child")?.textContent || "").trim() === "Code Map")));

const cmId = await page.evaluate(() => {
  const s = () => window.__dsh.useBoardStore.getState();
  return s().addBox("codemap", { x: 80, y: 620 });
});
await page.waitForTimeout(400);

const cmBoxText = await page.evaluate((boxId) => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Map"));
  return node ? node.innerText : "";
}, cmId);
const cmPlaceholder = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Map"));
  return node?.querySelector("input[type=text]")?.getAttribute("placeholder") || "";
});
check("C2 the box renders a repository field with guidance", /REPOSITORY/i.test(cmBoxText) && /github\.com\/owner\/repo/i.test(cmPlaceholder), cmPlaceholder);

// A repository URL typed into the field is remembered on the box.
await page.evaluate((boxId) => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Map"));
  const input = node.querySelector("input[type=text]");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "https://github.com/alexbonti/ai-canva/tree/main");
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, cmId);
await page.waitForTimeout(400);
check("C3 typing a repo URL is stored on the box", await page.evaluate((boxId) =>
  window.__dsh.useBoardStore.getState().boxData[boxId].repoUrl === "https://github.com/alexbonti/ai-canva/tree/main", cmId));

// No repository and nothing connected → a clear error, not a silent empty run.
const emptyId = await page.evaluate(() => window.__dsh.useBoardStore.getState().addBox("codemap", { x: 80, y: 1080 }));
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), emptyId);
check("C4 an input-less Code Map run asks for a repository instead of faking a brief", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return d.status === "error" && /GitHub repository/i.test(d.error || "");
}, emptyId));

// Real run (mocked endpoints): digest → prompt → artifact + provenance on the box.
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), cmId);
await page.waitForTimeout(900);
const cmState = await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return { status: d.status, error: d.error || "", output: d.output || "", meta: d.repoMeta || null };
}, cmId);
check("C5 the Code Map run produces a brief", cmState.status === "done" && cmState.output.startsWith("# Code Map"), cmState.error || cmState.output.slice(0, 60));
check("C6 the box records what it actually read (repo, branch, files, cap)", cmState.meta
  && cmState.meta.repo === "alexbonti/ai-canva" && cmState.meta.branch === "main" && cmState.meta.files === 3
  && cmState.meta.treeEntries === 120 && cmState.meta.truncated === true && cmState.meta.notes.length === 2,
  JSON.stringify(cmState.meta && { repo: cmState.meta.repo, files: cmState.meta.files, truncated: cmState.meta.truncated }));

check("C7 the branch in the field reaches the backend request", await page.evaluate(() =>
  (window.__smoke.repoRequests || []).some((u) => /(#|\/tree\/)main/.test(u))),
  await page.evaluate(() => JSON.stringify(window.__smoke.repoRequests || [])));

const cmPrompts = await page.evaluate(() => window.__smoke.prompts);
const digestPrompt = cmPrompts.find((p) => p.includes("code map"));
check("C8 the digest and its provenance are handed to the model", !!digestPrompt
  && digestPrompt.includes("Repository: alexbonti/ai-canva@main")
  && digestPrompt.includes("export const start = () => {}")
  && digestPrompt.includes("capped, so it is NOT the whole repository")
  && digestPrompt.includes("Ignored 9 generated/binary/lock file(s)."),
  digestPrompt ? digestPrompt.length + " chars" : "no prompt captured");

const cmNodeText = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Map") && n.innerText.includes("alexbonti"));
  return node ? node.innerText : "";
});
check("C9 the box shows the read summary and the repository notes", /alexbonti\/ai-canva@main/.test(cmNodeText)
  && /3 files of 120/.test(cmNodeText) && /capped/.test(cmNodeText) && /Repository notes \(2\)/.test(cmNodeText),
  cmNodeText.slice(0, 120).replace(/\n/g, " / "));

// Download the brief.
const [cmDl] = await Promise.all([
  page.waitForEvent("download"),
  page.evaluate(() => {
    const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Map") && n.innerText.includes("alexbonti"));
    const btn = [...node.querySelectorAll("button")].find((b) => b.textContent.trim() === "💾 Save");
    if (!btn) throw new Error("no Save button on the Code Map box");
    btn.click();
  }),
]);
check("C10 💾 Save downloads the brief as code-map.md", cmDl.suggestedFilename() === "code-map.md", cmDl.suggestedFilename());

// Failing repository fetch WITH connected code: still briefs, but says so honestly.
await page.evaluate(() => { window.__smokeRepo = { mode: "fail" }; });
const failId = await page.evaluate(async () => {
  const s = () => window.__dsh.useBoardStore.getState();
  const code = s().addBox("idea", { x: 480, y: 1080 });
  s().updateBoxData(code, { content: "export function main() { return 42; }" });
  const box = s().addBox("codemap", { x: 80, y: 1340 });
  s().updateBoxData(box, { repoUrl: "owner/private-repo" });
  s().connectBoxes(code, box);
  return box;
});
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), failId);
await page.waitForTimeout(900);
const failState = await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return { status: d.status, error: d.error || "", meta: d.repoMeta || null };
}, failId);
check("C11 a failed fetch falls back to connected code and records why", failState.status === "done" && /GITHUB_TOKEN/.test(failState.meta?.error || ""), JSON.stringify({ status: failState.status, error: failState.meta?.error }));

const fallbackPrompt = (await page.evaluate(() => window.__smoke.prompts)).filter((p) => p.includes("## Repository not read")).pop();
check("C12 the fallback brief is told the repository was NOT read", !!fallbackPrompt
  && fallbackPrompt.includes("Repository or branch not found")
  && fallbackPrompt.includes("export function main()"),
  fallbackPrompt ? `${fallbackPrompt.length} chars` : "no fallback prompt captured");

// A repo link pasted in a CONNECTED box is picked up when the field is empty.
await page.evaluate(() => { window.__smokeRepo = { mode: "ok" }; window.__smoke.repoRequests = []; });
const linkedId = await page.evaluate(async () => {
  const s = () => window.__dsh.useBoardStore.getState();
  const note = s().addBox("idea", { x: 480, y: 1340 });
  s().updateBoxData(note, { content: "Map https://github.com/alexbonti/ai-canva for me" });
  const box = s().addBox("codemap", { x: 80, y: 1600 });
  s().connectBoxes(note, box);
  return box;
});
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), linkedId);
await page.waitForTimeout(900);
check("C13 a repo link in a connected box is used when the field is empty", await page.evaluate((boxId) => {
  const s = () => window.__dsh.useBoardStore.getState();
  const d = s().boxData[boxId];
  return d.status === "done" && (d.repoMeta?.repo || "") === "alexbonti/ai-canva";
}, linkedId));

// ---------- Code Edit worker: read a repo, propose a reviewable change set ----------

// A small repository fixture the Code Edit mocks serve. The digest text is built
// from it exactly like the real endpoint builds one, so tree parsing is exercised.
await page.evaluate(() => {
  window.__ce = { triageCalls: 0, editCalls: 0, systemPrompts: [] };
  window.__ceFixture = {
    tree: ["README.md", "src/app.ts", "src/tests/app.test.ts", "server/src/api.ts"],
    contents: {
      "src/app.ts": "export function main() {\n  return 1;\n}\n",
      "src/tests/app.test.ts": "import { main } from \"../app\";\n\ntest(\"main\", () => {\n  expect(main()).toBe(1);\n});\n",
      "server/src/api.ts": "export const api = () => 1;\n",
      "README.md": "# demo\n",
    },
  };
  window.__ceReply = { mode: "ok" };
});

const installCodeEditMocks = () => page.evaluate(() => {
  const fixture = window.__ceFixture;
  const original = window.fetch;
  const digestText = (paths) => {
    const treeLines = ["README.md", "src/", "  app.ts", "  tests/", "    app.test.ts", "server/", "  src/", "    api.ts"];
    return (
      "Repository: alexbonti/ai-canva@main\n\n## File tree\n\n" + treeLines.join("\n") +
      "\n\n## File contents\n\n" +
      paths.map((p) => `### ${p} (0.1 KB)\n\n\`\`\`ts\n${fixture.contents[p] || ""}\`\`\`\n`).join("\n")
    );
  };
  window.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : url.url;
    if (u.includes("/api/repo-digest")) {
      const body = JSON.parse(opts?.body || "{}");
      const asked = Array.isArray(body.paths) ? body.paths : [];
      const missing = asked.filter((p) => !fixture.tree.includes(p));
      const paths = asked.length > 0
        ? asked.filter((p) => fixture.tree.includes(p))
        : ["src/app.ts", "README.md"];
      return new Response(JSON.stringify({
        ok: true, repo: "alexbonti/ai-canva", branch: "main", digest: digestText(paths),
        files: paths.length, treeEntries: fixture.tree.length, chars: 400,
        truncated: false, notes: missing.length ? [`Requested path(s) not found in the tree: ${missing.join(", ")}.`] : [],
        contents: paths.map((p) => ({ path: p, content: fixture.contents[p], clipped: false })),
        missing,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/api/generate")) {
      const body = JSON.parse(opts?.body || "{}");
      const system = body.systemPrompt || "";
      const prompt = body.userPrompt || "";
      window.__ce.systemPrompts.push(system);
      window.__ce.userPrompts = window.__ce.userPrompts || [];
      window.__ce.userPrompts.push(prompt);
      if (system.includes("You plan code changes")) {
        window.__ce.triageCalls++;
        return new Response(JSON.stringify({
          content: '```json\n{"files":["src/app.ts"],"plan":"change main()"}\n```',
          model: "mock", usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      window.__ce.editCalls++;
      if (window.__ceReply.mode === "garbage") {
        return new Response(JSON.stringify({
          content: "I changed src/app.ts to return 42.", model: "mock",
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        content: "```json\n" + JSON.stringify({
          summary: "return 42 from main()",
          changes: [{
            path: "src/app.ts",
            operation: "update",
            content: "export function main() {\n  return 42;\n}\n",
            reason: "the request asked for 42",
          }],
          notes: ["not compiled or tested"],
        }) + "\n```",
        model: "mock", usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return original(url, opts);
  };
});

check("CE1 palette offers the Code Edit worker", await page.evaluate(() =>
  [...document.querySelectorAll("button.palette-row")].some((b) => (b.querySelector("span:last-child")?.textContent || "").trim() === "Code Edit")));

const ceId = await page.evaluate(() => {
  const s = () => window.__dsh.useBoardStore.getState();
  return s().addBox("codeedit", { x: 80, y: 1900 });
});
await page.waitForTimeout(400);

const ceText = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Edit"));
  return node ? node.innerText : "";
});
const cePlaceholders = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Edit"));
  return [...node.querySelectorAll("input, textarea")].map((el) => el.getAttribute("placeholder") || "");
});
check("CE2 the box renders the repository, file-targeting and change-request fields",
  /REPOSITORY/i.test(ceText) && /Files to change/i.test(ceText)
  && cePlaceholders.some((ph) => /github\.com\/owner\/repo/.test(ph))
  && cePlaceholders.some((ph) => /one repository path per line/.test(ph))
  && cePlaceholders.some((ph) => /What should change/.test(ph)),
  cePlaceholders.join(" | ").slice(0, 120));

// A run without a repository must say so rather than inventing an edit.
const ceNoRepo = await page.evaluate(() => window.__dsh.useBoardStore.getState().addBox("codeedit", { x: 620, y: 1900 }));
await page.evaluate((boxId) => {
  const s = () => window.__dsh.useBoardStore.getState();
  s().updateBoxData(boxId, { content: "change something" });
}, ceNoRepo);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ceNoRepo);
check("CE3 a Code Edit run without a repository is refused with guidance", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return d.status === "error" && /GitHub repository/i.test(d.error || "");
}, ceNoRepo));

// The real flow: pinned file → whole-file read → change set → diff + patch.
await installCodeEditMocks();
await page.evaluate((boxId) => {
  const s = () => window.__dsh.useBoardStore.getState();
  s().updateBoxData(boxId, {
    repoUrl: "https://github.com/alexbonti/ai-canva",
    filesToEdit: "src/app.ts\nsrc/nope.ts",
    content: "make main() return 42",
  });
}, ceId);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ceId);
await page.waitForTimeout(900);

const ceState = await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return { status: d.status, error: d.error || "", changeSet: d.changeSet || [], meta: d.editMeta || null, output: d.output || "" };
}, ceId);
check("CE4 the run produces a change set with real line counts",
  ceState.status === "done" && ceState.changeSet.length === 1
  && ceState.changeSet[0].path === "src/app.ts" && ceState.changeSet[0].added === 1 && ceState.changeSet[0].removed === 1,
  JSON.stringify(ceState.changeSet.map((c) => `${c.path} ${c.operation} +${c.added} −${c.removed}`)) || ceState.error);
check("CE5 the pinned list drove the read (and the unreadable path is reported)",
  ceState.meta?.source === "pinned" && ceState.meta.read.join() === "src/app.ts" && ceState.meta.missing.join().includes("src/nope.ts"),
  JSON.stringify({ source: ceState.meta?.source, read: ceState.meta?.read, missing: ceState.meta?.missing }));
check("CE6 the prompt carried the file's CURRENT content and the no-claims rule",
  await page.evaluate(() => {
    const prompts = window.__ce.userPrompts || [];
    const p = prompts.filter((x) => x.includes("#### src/app.ts")).pop() || "";
    return p.includes("#### src/app.ts") && p.includes("return 1;")
      && p.includes("compiled or tested") && p.includes("make main() return 42");
  }),
  await page.evaluate(() => (window.__ce.userPrompts || []).map((p) => p.length).join(",")));
check("CE7 the stored output is a diff document (what the Review stage consumes)",
  ceState.output.startsWith("# Change set") && ceState.output.includes("```diff") && ceState.output.includes("+  return 42;"));

const ceNodeText = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")]
    .find((n) => /code edit/i.test(n.innerText) && /change set/i.test(n.innerText));
  return node ? node.innerText : "";
});
check("CE8 the box shows the change set, the operation, the diff and the apply hint",
  /src\/app\.ts/.test(ceNodeText) && /update/i.test(ceNodeText) && /\+1/.test(ceNodeText)
  && /return 42/.test(ceNodeText) && /git apply code-changes\.patch/.test(ceNodeText),
  ceNodeText.slice(0, 130).replace(/\n/g, " / "));

const [ceDl] = await Promise.all([
  page.waitForEvent("download"),
  page.evaluate(() => {
    const node = [...document.querySelectorAll(".box-node")]
      .find((n) => /code edit/i.test(n.innerText) && /change set/i.test(n.innerText));
    if (!node) throw new Error("Code Edit box with a change set not found");
    const btn = [...node.querySelectorAll("button")].find((b) => b.textContent.trim() === "💾 Save");
    if (!btn) throw new Error("no Save button on the Code Edit box");
    btn.click();
  }),
]);
const cePatch = await (await import("node:fs/promises")).readFile(await ceDl.path(), "utf8");
check("CE9 💾 Save downloads a git patch matching the displayed change",
  ceDl.suggestedFilename() === "code-changes.patch"
  && cePatch.includes("diff --git a/src/app.ts b/src/app.ts")
  && cePatch.includes("-  return 1;") && cePatch.includes("+  return 42;"),
  ceDl.suggestedFilename());

// Hand-editing a file recomputes the diff (the patch can never drift from it).
await page.evaluate((boxId) => {
  window.__dsh.useBoardStore.getState().setChangeSetFile(boxId, "src/app.ts", "export function main() {\n  return 7;\n  // hand-edited\n}\n");
}, ceId);
await page.waitForTimeout(500);
check("CE10 editing a file by hand recomputes the counts and the patch", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  const c = d.changeSet[0];
  return c.added === 2 && c.removed === 1 && d.output.includes("+  // hand-edited");
}, ceId));

// A file list from an upstream SDLC Plan needs no triage call at all.
const ceFromPlan = await page.evaluate(() => {
  const s = () => window.__dsh.useBoardStore.getState();
  // A real SDLC Plan stage: its approved artifact names the files to change.
  const plan = s().addBox("sdlc-plan", { x: 620, y: 2300 });
  const artifact = "# Plan\n\n## Files to change\n- `src/app.ts` — change main\n\n## Tests\n- \"main returns 42\" → Decision 1";
  s().updateBoxData(plan, {
    output: artifact,
    status: "done",
    sdlcVersions: [{ version: 1, content: artifact, createdAt: 1, createdBy: "Tester", source: "generated", note: "" }],
    sdlcGate: "approved",
    sdlcApprovedVersion: 1,
  });
  const box = s().addBox("codeedit", { x: 80, y: 2300 });
  s().updateBoxData(box, {
    repoUrl: "https://github.com/alexbonti/ai-canva",
    prompt: "Apply the change request below to the repository files provided.\n\nChange request:\n{{inputs}}",
    content: "make main() return 42",
  });
  s().connectBoxes(plan, box);
  return box;
});
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ceFromPlan);
await page.waitForTimeout(900);
check("CE11 an upstream SDLC Plan's file list drives the read (no triage call)", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return d.editMeta?.source === "plan" && d.editMeta.read.join() === "src/app.ts";
}, ceFromPlan),
  await page.evaluate((boxId) => JSON.stringify({
    source: window.__dsh.useBoardStore.getState().boxData[boxId].editMeta?.source,
    error: window.__dsh.useBoardStore.getState().boxData[boxId].error,
  }), ceFromPlan));

// No pinned files and no plan → one triage call picks the targets.
const ceTriage = await page.evaluate(() => {
  const s = () => window.__dsh.useBoardStore.getState();
  const box = s().addBox("codeedit", { x: 620, y: 2600 });
  s().updateBoxData(box, {
    repoUrl: "https://github.com/alexbonti/ai-canva",
    prompt: "Apply the change request below to the repository files provided.\n\nChange request:\n{{inputs}}",
    content: "make main() return 42",
  });
  return box;
});
const triageBefore = await page.evaluate(() => window.__ce.triageCalls);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ceTriage);
await page.waitForTimeout(900);
check("CE12 without pins or a plan, one triage call chooses the files", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return d.editMeta?.source === "triage" && d.changeSet?.length === 1;
}, ceTriage) && (await page.evaluate(() => window.__ce.triageCalls)) === triageBefore + 1,
  `triage calls ${triageBefore} → ${await page.evaluate(() => window.__ce.triageCalls)}`);

// A reply that is not the JSON change set is reported, never guessed at.
await page.evaluate(() => { window.__ceReply.mode = "garbage"; });
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), ceTriage);
await page.waitForTimeout(900);
check("CE13 a non-JSON reply is surfaced as an error instead of a guessed edit", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  // The error is explicit, and the previous change set is kept but labelled as
  // stale in the panel (never presented as the current proposal).
  return d.status === "error" && /JSON change set/.test(d.error || "")
    && /previous successful run/i.test([...document.querySelectorAll(".box-node")].map((n) => n.innerText).join("\n"));
}, ceTriage));

// ---------- Code box: AI change requests (diff + version history) ----------

// The Code box talks to /api/generate directly; this mock serves a first build
// and then an AI change, so the whole flow is deterministic.
await page.evaluate(() => {
  window.__cc = { calls: 0, prompts: [] };
  window.__ccReply = { mode: "ok" };
  const original = window.fetch;
  window.installCodeChangeMocks = () => {
    window.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : url.url;
      if (!u.includes("/api/generate")) return original(url, opts);
      const body = JSON.parse(opts?.body || "{}");
      const prompt = body.userPrompt || "";
      window.__cc.calls++;
      window.__cc.prompts.push(prompt);
      if (window.__ccReply.mode === "incomplete") {
        return new Response(JSON.stringify({
          content: "function App() { return <div>truncated", model: "mock",
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (window.__ccReply.mode === "same") {
        return new Response(JSON.stringify({
          content: window.__ccFixture.built, model: "mock",
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const isChange = prompt.includes("Apply ONLY that change");
      const content = isChange ? window.__ccFixture.changed : window.__ccFixture.built;
      return new Response(JSON.stringify({
        content, model: "mock", usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  };
  window.__ccFixture = {
    built: "function App() {\n  return (\n    <div>\n      <h1>Hi</h1>\n      <button>Count</button>\n    </div>\n  );\n}\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
    changed: "function App() {\n  return (\n    <div>\n      <h1>Hi</h1>\n      <button>Count</button>\n      <input placeholder=\"search\" />\n    </div>\n  );\n}\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
  };
});
await page.evaluate(() => window.installCodeChangeMocks());

const codeBox = await page.evaluate(() => {
  const s = () => window.__dsh.useBoardStore.getState();
  const box = s().addBox("code", { x: 80, y: 3000 });
  s().updateBoxData(box, { prompt: "Build it:\n{{inputs}}", content: "a page with a heading and a count button" });
  return box;
});
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().runBox(boxId), codeBox);
await page.waitForTimeout(900);

let ccState = await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return { status: d.status, error: d.error || "", code: d.code || "", versions: (d.codeVersions || []).length, current: d.codeVersion };
}, codeBox);
check("CC1 the build is versioned (v1) and the code is complete",
  ccState.status === "done" && ccState.versions === 1 && ccState.current === 1 && ccState.code.includes("<h1>Hi</h1>"),
  JSON.stringify({ status: ccState.status, versions: ccState.versions, error: ccState.error }));

const ccNode = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Box"));
  return node ? node.innerText : "";
});
const ccPlaceholder = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Box"));
  return [...node.querySelectorAll("input")].map((el) => el.getAttribute("placeholder") || "").join(" | ");
});
check("CC2 the box offers a change request field and an Apply change button",
  /Request a change/i.test(ccPlaceholder) && /Apply change/i.test(ccNode) && /1 version/.test(ccNode),
  ccPlaceholder.slice(0, 90));

// Apply an AI change.
await page.evaluate((boxId) => {
  const s = () => window.__dsh.useBoardStore.getState();
  s().updateBoxData(boxId, { changePrompt: "add a search field" });
}, codeBox);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().applyChangeRequest(boxId), codeBox);
await page.waitForTimeout(900);
ccState = await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return {
    status: d.status, error: d.error || "", code: d.code || "",
    versions: (d.codeVersions || []).length, current: d.codeVersion,
    notes: (d.codeVersions || []).map((v) => v.note), cleared: d.changePrompt === "",
  };
}, codeBox);
check("CC3 the AI change updates the code and appends a version",
  ccState.status === "done" && ccState.code.includes("search") && ccState.versions === 2 && ccState.current === 2
  && ccState.notes[1] === "add a search field",
  JSON.stringify({ status: ccState.status, versions: ccState.versions, error: ccState.error }));
check("CC4 the change prompt sent the current code and the request with the keep-everything rules",
  await page.evaluate(() => {
    const p = (window.__cc.prompts || []).filter((x) => x.includes("Apply ONLY that change")).pop() || "";
    return p.includes("<h1>Hi</h1>") && p.includes("add a search field") && p.includes("Return the COMPLETE file");
  }));

const ccAfter = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Box"));
  return node ? node.innerText : "";
});
check("CC5 the box shows the version, the +/- counts and a revert path",
  // The version chip is CSS-uppercased, so match case-insensitively.
  /v2/i.test(ccAfter) && /\+1/.test(ccAfter) && /2 versions/.test(ccAfter)
  && /Diff/.test(ccAfter) && /requested: add a search field/.test(ccAfter),
  ccAfter.slice(0, 150).replace(/\n/g, " / "));

// The history is append-only and a revert is itself a version.
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().revertCodeVersion(boxId, 1), codeBox);
await page.waitForTimeout(500);
ccState = await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return { code: d.code || "", versions: (d.codeVersions || []).length, current: d.codeVersion, notes: (d.codeVersions || []).map((v) => v.note) };
}, codeBox);
check("CC6 reverting restores the old code as a NEW version (history never rewritten)",
  ccState.versions === 3 && ccState.current === 3 && !ccState.code.includes("search")
  && ccState.notes[2] === "reverted to v1",
  JSON.stringify({ versions: ccState.versions, notes: ccState.notes }));

// An incomplete reply must never replace working code.
await page.evaluate(() => { window.__ccReply.mode = "incomplete"; });
await page.evaluate((boxId) => {
  const s = () => window.__dsh.useBoardStore.getState();
  s().updateBoxData(boxId, { changePrompt: "do something odd" });
}, codeBox);
const ccBeforeBad = await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().boxData[boxId].code, codeBox);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().applyChangeRequest(boxId), codeBox);
await page.waitForTimeout(900);
check("CC7 an incomplete change is refused and the working code is kept", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return d.status === "error" && /incomplete/i.test(d.error || "") && (d.codeVersions || []).length === 3;
}, codeBox) && (await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().boxData[boxId].code, codeBox)) === ccBeforeBad);

// A reply that changes nothing is reported instead of pretending.
await page.evaluate(() => { window.__ccReply.mode = "same"; });
await page.evaluate((boxId) => {
  const s = () => window.__dsh.useBoardStore.getState();
  s().updateBoxData(boxId, { changePrompt: "change nothing" });
}, codeBox);
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().applyChangeRequest(boxId), codeBox);
await page.waitForTimeout(900);
check("CC8 an unchanged reply adds no version", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return d.status === "done" && (d.codeVersions || []).length === 3;
}, codeBox));

// A change with no request at all is refused with guidance.
const ccEmpty = await page.evaluate(() => window.__dsh.useBoardStore.getState().addBox("code", { x: 620, y: 3000 }));
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().applyChangeRequest(boxId), ccEmpty);
check("CC9 a change request with no code (or no request) is refused", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return d.status === "error" && /Generate the code first/i.test(d.error || "");
}, ccEmpty));

// ---------- Deploy: a box's code published to a live here.now URL ----------

await page.evaluate(() => {
  window.__dep = { requests: [], mode: "ok" };
  const original = window.fetch;
  window.installDeployMocks = () => {
    window.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : url.url;
      if (!u.includes("/api/herenow-deploy")) return original(url, opts);
      const body = JSON.parse(opts?.body || "{}");
      window.__dep.requests.push(body);
      if (window.__dep.mode === "conflict") {
        return new Response(JSON.stringify({
          error: "The site update: This site has changed since it was deployed (live version ver_9, changed by editor). Redeploy to replace it, or review the live version first.",
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const n = window.__dep.requests.length;
      return new Response(JSON.stringify({
        ok: true,
        slug: "cobalt-castle-y2d3",
        siteUrl: "https://cobalt-castle-y2d3.here.now/",
        versionId: "ver_" + n,
        unchanged: false,
        anonymous: true,
        expiresAt: "2026-09-14T12:39:41.214Z",
        claimToken: "y_Wu0ZyWf-pdH0sP",
        claimUrl: "https://here.now/c/y_Wu0ZyWf-pdH0sP",
        warnings: [],
        fileCount: (body.files || []).length,
        bytes: 3518,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  };
});
await page.evaluate(() => window.installDeployMocks());

const depBox = await page.evaluate(() => {
  const s = () => window.__dsh.useBoardStore.getState();
  const box = s().addBox("code", { x: 80, y: 3600 });
  const code = "function App() {\n  return <h1>Deployed</h1>;\n}\nReactDOM.createRoot(document.getElementById('root')).render(<App />);";
  s().updateBoxData(box, {
    code, output: code, status: "done",
    codeVersions: [{ version: 1, content: code, createdAt: Date.now(), createdBy: "T", source: "generated", note: "initial build" }],
    codeVersion: 1,
  });
  return box;
});
await page.waitForTimeout(500);

const depNodeText = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.innerText.includes("Code Box"));
  return node ? node.innerText : "";
});
check("DP1 a code box offers a Deploy button and a live-site strip",
  /Deploy/.test(depNodeText) && /LIVE SITE/i.test(depNodeText) && /2 file\(s\) ready to publish/.test(depNodeText),
  depNodeText.slice(0, 140).replace(/\n/g, " / "));

await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().deployBox(boxId), depBox);
await page.waitForTimeout(700);

const depState = await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  return { status: d.status, error: d.error || "", deploy: d.deploy || null };
}, depBox);
check("DP2 deploying publishes the box's code and records the live site",
  depState.status === "done" && depState.deploy?.url === "https://cobalt-castle-y2d3.here.now/"
  && depState.deploy?.slug === "cobalt-castle-y2d3" && depState.deploy?.versionId === "ver_1"
  && depState.deploy?.claimToken === "y_Wu0ZyWf-pdH0sP" && depState.deploy?.anonymous === true,
  JSON.stringify({ url: depState.deploy?.url, slug: depState.deploy?.slug, error: depState.error }));
check("DP3 the payload carried a self-contained page plus the source",
  await page.evaluate(() => {
    const req = window.__dep.requests[0];
    const paths = req.files.map((f) => f.path);
    const html = req.files.find((f) => f.path === "index.html")?.content || "";
    return JSON.stringify(paths) === JSON.stringify(["index.html", "App.jsx"])
      && html.includes("<!DOCTYPE html>") && html.includes("ReactDOM.createRoot")
      && req.displayName === "Code Box";
  }),
  await page.evaluate(() => JSON.stringify(window.__dep.requests[0].files.map((f) => f.path))));

const depLive = await page.evaluate(() => {
  // Match the DEPLOYED box: several boxes are titled "Code Box", so identify it by
  // its live-site link rather than by title.
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.querySelector("a[href*='here.now']"));
  const link = node?.querySelector("a[href*='here.now']");
  return { text: node ? node.innerText : "", href: link?.getAttribute("href") || "" };
});
check("DP4 the box shows the live URL, the 24-hour expiry and the claim link behind a toggle",
  depLive.href === "https://cobalt-castle-y2d3.here.now/"
  && /Anonymous site/.test(depLive.text) && /expires/.test(depLive.text)
  && /Show claim link/.test(depLive.text),
  depLive.text.slice(0, 150).replace(/\n/g, " / "));

check("DP5 the claim link is revealed with its once-only warning",
  await page.evaluate(async () => {
    const node = [...document.querySelectorAll(".box-node")].find((n) => n.querySelector("a[href*='here.now']"));
    const btn = [...node.querySelectorAll("button")].find((b) => b.textContent.includes("Show claim link"));
    btn?.click();
    await new Promise((r) => setTimeout(r, 200));
    const after = node.innerText;
    return after.includes("https://here.now/c/y_Wu0ZyWf-pdH0sP") && /returned once and cannot be recovered/i.test(after);
  }));

// A redeploy must update the SAME site, sending its version back.
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().deployBox(boxId), depBox);
await page.waitForTimeout(700);
check("DP6 redeploying updates the same site with its claim token and live version",
  await page.evaluate(() => {
    const req = window.__dep.requests[1];
    return req.slug === "cobalt-castle-y2d3" && req.claimToken === "y_Wu0ZyWf-pdH0sP" && req.baseVersionId === "ver_1";
  }),
  await page.evaluate(() => JSON.stringify({ slug: window.__dep.requests[1]?.slug, base: window.__dep.requests[1]?.baseVersionId })));

// A refused update must be surfaced, and the previous site kept.
await page.evaluate(() => { window.__dep.mode = "conflict"; });
await page.evaluate((boxId) => window.__dsh.useBoardStore.getState().deployBox(boxId), depBox);
await page.waitForTimeout(700);
check("DP7 a refused update is surfaced and the previous site is kept", await page.evaluate((boxId) => {
  const d = window.__dsh.useBoardStore.getState().boxData[boxId];
  const node = [...document.querySelectorAll(".box-node")].find((n) => n.querySelector("a[href*='here.now']"));
  return d.status === "error" && /changed since it was deployed/.test(d.error || "")
    && d.deploy?.url === "https://cobalt-castle-y2d3.here.now/"
    && /previous site is still live and unchanged/.test(node ? node.innerText : "");
}, depBox));
await page.evaluate(() => { window.__dep.mode = "ok"; });

// Stitch publishes its HTML as-is; Code Edit publishes the changed files + diff.
const stitchDeploy = await page.evaluate(async () => {
  const s = () => window.__dsh.useBoardStore.getState();
  const box = s().addBox("stitch", { x: 620, y: 3600 });
  s().updateBoxData(box, { code: "<html><body><h1>Stitch screen</h1></body></html>", status: "done" });
  window.__dep.requests.length = 0;
  await s().deployBox(box);
  return window.__dep.requests[0];
});
check("DP8 a Stitch box publishes its HTML as index.html only",
  stitchDeploy.files.length === 1 && stitchDeploy.files[0].path === "index.html"
  && stitchDeploy.files[0].content.includes("Stitch screen"),
  JSON.stringify(stitchDeploy.files.map((f) => f.path)));

const editDeploy = await page.evaluate(async () => {
  const s = () => window.__dsh.useBoardStore.getState();
  window.__dep.requests.length = 0;
  await s().deployBox(Object.keys(s().boxData).find((k) => (s().boxData[k].changeSet || []).length > 0));
  return window.__dep.requests[0];
});
check("DP9 a Code Edit box publishes the changed files plus the diff document",
  JSON.stringify(editDeploy.files.map((f) => f.path)) === JSON.stringify(["src/app.ts", "CHANGES.md"])
  && editDeploy.files[1].content.includes("```diff"),
  JSON.stringify(editDeploy.files.map((f) => f.path)));

const realErrors = pageErrors.filter((e) => !/Missing or insufficient permissions/i.test(e));
check("Z1 no unexpected page errors", realErrors.length === 0, realErrors.join(" | ").slice(0, 200));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("failed: " + failed.map((f) => f.name).join(", "));
  process.exit(1);
}
