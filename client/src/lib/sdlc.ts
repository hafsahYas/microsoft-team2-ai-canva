import type { Edge, Node } from "@xyflow/react";
import type {
  ArtifactVersion,
  BoxData,
  BoxType,
  NamedInput,
  SdlcEvent,
  SdlcFinding,
  SdlcStage,
} from "../types.js";
import { fillPromptTemplate } from "./prompts.js";

/**
 * Pure helpers for the SDLC pipeline boxes (the store runs them —
 * `runSdlcStage` in client/src/store/boardStore.ts — and `SdlcGatePanel.tsx`
 * renders them).
 *
 * The pipeline is the product here: six stages, one artifact each, an approval
 * gate per stage, append-only history, and hard rules that cannot be configured
 * away. Everything in this file is deterministic so it can be unit-tested
 * without a board, a store, or a model.
 */

/** The stages in order, with their box types and hard-gate flags. */
export const SDLC_STAGES: readonly {
  type: BoxType;
  stage: SdlcStage;
  index: number;
  label: string;
  /** True for the stages that can never be configured to auto-advance. */
  hardGate: boolean;
}[] = [
  { type: "sdlc-intent", stage: "intent", index: 1, label: "1 · Intent", hardGate: true },
  { type: "sdlc-spec", stage: "spec", index: 2, label: "2 · Spec", hardGate: false },
  { type: "sdlc-plan", stage: "plan", index: 3, label: "3 · Plan", hardGate: false },
  { type: "sdlc-implement", stage: "implementation", index: 4, label: "4 · Implementation", hardGate: false },
  { type: "sdlc-review", stage: "review", index: 5, label: "5 · Review", hardGate: false },
  { type: "sdlc-merge", stage: "merge", index: 6, label: "6 · Merge", hardGate: true },
];

export const SDLC_TYPES: readonly BoxType[] = SDLC_STAGES.map((s) => s.type);

/** Artifact file names for the per-box download (the blueprint's own names). */
export const SDLC_ARTIFACT_FILENAMES: Record<string, string> = {
  "sdlc-intent": "intent.md",
  "sdlc-spec": "spec.md",
  "sdlc-plan": "plan.md",
  "sdlc-implement": "implementation.md",
  "sdlc-review": "review.md",
  "sdlc-merge": "merge.md",
};

/**
 * Model output is capped before it is stored: every version keeps its full text
 * forever (immutability is a hard requirement), so one runaway artifact must not
 * blow up the board document's Firestore size.
 */
export const MAX_SDLC_ARTIFACT_CHARS = 60_000;

/** Maximum parsed items kept from a model artifact (findings/decisions/items). */
const MAX_PARSED_ITEMS = 50;
const MAX_OPEN_ITEMS = 20;

export function isSdlcBox(type: unknown): boolean {
  return typeof type === "string" && SDLC_TYPES.includes(type as BoxType);
}

export function sdlcStageOf(type: unknown): SdlcStage | null {
  const found = SDLC_STAGES.find((s) => s.type === type);
  return found ? found.stage : null;
}

export function sdlcStageMeta(type: unknown) {
  return SDLC_STAGES.find((s) => s.type === type) || null;
}

/** Truncates a model artifact, leaving a visible marker when it was capped. */
export function truncateArtifact(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_SDLC_ARTIFACT_CHARS) return { content, truncated: false };
  return {
    content: content.slice(0, MAX_SDLC_ARTIFACT_CHARS) + "\n\n…[truncated at 60000 chars]",
    truncated: true,
  };
}

// === Prompt building ===

/**
 * Fills a stage prompt with its upstream inputs, then appends the two blocks the
 * blueprint requires: the org skills/rule sets attached to this box, and the
 * note from the last "request changes" gate decision.
 */
export function buildStagePrompt(
  opts: { prompt: string; skills?: string; feedback?: string },
  namedInputs: NamedInput[]
): string {
  let filled = fillPromptTemplate(opts.prompt, namedInputs);

  const skills = (opts.skills || "").trim();
  if (skills) {
    filled +=
      "\n\n## Org skills / rule sets\n" +
      "These are mandatory for this stage. Apply every one of them, and state where each " +
      "constrained a decision. Do not invent rules that are not listed here.\n\n" +
      skills;
  }

  const feedback = (opts.feedback || "").trim();
  if (feedback) {
    filled +=
      "\n\n## Requested changes from the previous review\n" +
      "A human rejected the previous version of this artifact with the note below. " +
      "Address it explicitly; keep everything that was not challenged.\n\n" +
      feedback;
  }

  return filled;
}

// === Append-only history ===

/**
 * Appends a version. The previous array is never mutated, the new version number
 * is `max + 1`, and every field is always defined (Firestore rejects `undefined`
 * inside a nested object).
 */
export function appendVersion(
  versions: ArtifactVersion[] | undefined,
  entry: { content: string; createdBy: string; source: "generated" | "edited"; note?: string; at?: number }
): ArtifactVersion[] {
  const existing = versions || [];
  const nextNumber = existing.reduce((max, v) => Math.max(max, v.version || 0), 0) + 1;
  return [
    ...existing,
    {
      version: nextNumber,
      content: entry.content,
      createdAt: entry.at ?? Date.now(),
      createdBy: entry.createdBy || "Someone",
      source: entry.source,
      note: entry.note || "",
    },
  ];
}

/** Appends one audit event (same immutability and always-defined rules). */
export function appendEvent(
  history: SdlcEvent[] | undefined,
  entry: { actor: string; action: string; note?: string; at?: number }
): SdlcEvent[] {
  return [
    ...(history || []),
    {
      at: entry.at ?? Date.now(),
      actor: entry.actor || "Someone",
      action: entry.action,
      note: entry.note || "",
    },
  ];
}

export function latestVersion(versions: ArtifactVersion[] | undefined): ArtifactVersion | null {
  if (!versions || versions.length === 0) return null;
  return versions.reduce((a, b) => (b.version > a.version ? b : a));
}

/** True when this box's latest artifact version is the one that was approved. */
export function isApprovedAtLatest(data: BoxData): boolean {
  const latest = latestVersion(data.sdlcVersions);
  if (!latest) return false;
  return data.sdlcGate === "approved" && data.sdlcApprovedVersion === latest.version;
}

// === Artifact parsing (the app-side cross-checks) ===

/** Extracts the contents of the last fenced code block of a given language. */
function lastFencedBlock(content: string, lang?: string): string | null {
  const re = lang
    ? new RegExp("```" + lang + "\\s*([\\s\\S]*?)```", "gi")
    : new RegExp("```[a-zA-Z]*\\s*([\\s\\S]*?)```", "g");
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = re.exec(content)) !== null) last = match[1];
  return last;
}

/** Returns the body of a `## Heading` section ("" when the heading is absent). */
function sectionBody(content: string, headingPattern: RegExp): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => headingPattern.test(l.trim()));
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

const UNRESOLVED_HEADING = /^#{1,6}\s*(unresolved|open questions?|remaining questions?|flags?)\b/i;
const DEVIATION_HEADING = /^#{1,6}\s*(plan deviations?|deviations?|⚠ ?deviations?)\b/i;
const DECISIONS_HEADING = /^#{1,6}\s*decisions?\b/i;

/**
 * Unresolved items in a spec artifact: `⚠` lines anywhere, plus the bullets of
 * an unresolved/open-questions section. Non-empty means Stage 2 is a hard gate —
 * the app enforces this, it does not rely on the model to self-check.
 */
export function parseOpenItems(specContent: string): string[] {
  if (!specContent) return [];
  const items: string[] = [];
  let inSection = false;

  for (const raw of specContent.split("\n")) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      // Only an unresolved-ish section contributes its bullets; explicit ⚠
      // lines count anywhere in the artifact.
      inSection = UNRESOLVED_HEADING.test(line);
      continue;
    }
    if (!line) continue;
    if (/^(none|n\/a|nothing)\b/i.test(line)) continue;

    const warned = line.match(/^(?:[-*+]|\d+\.)?\s*⚠️?\s*(.+)$/);
    if (warned) {
      items.push(warned[1].trim());
      continue;
    }
    if (!inSection) continue;

    const bullet = line.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
    if (bullet) items.push(bullet[1].replace(/^⚠️?\s*/, "").trim());
  }

  return dedupe(items.filter(Boolean)).slice(0, MAX_OPEN_ITEMS);
}

/**
 * True when the implementation artifact reports a deviation from the approved
 * plan (a non-empty deviations section) — the blueprint's "pause and surface the
 * discrepancy rather than silently deviating".
 */
export function parseDeviation(implementationContent: string): boolean {
  if (!implementationContent) return false;
  const body = sectionBody(implementationContent, DEVIATION_HEADING);
  if (!body) return false;
  const meaningful = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(none|n\/a|no deviations?\.?|nothing)\b/i.test(l));
  return meaningful.length > 0;
}

/** The spec's resolved decisions (`### Decision N — title`), used by the cross-check. */
export function parseDecisions(specContent: string): string[] {
  if (!specContent) return [];
  const decisions: string[] = [];

  for (const raw of specContent.split("\n")) {
    // `Decision\b` keeps the plural `## Decisions` heading from counting as one.
    const m = raw.trim().match(/^#{2,6}\s*Decision\b\s*(\d+)?\s*[—:–-]?\s*(.*)$/i);
    if (m) {
      const label = (m[2] || "").trim();
      decisions.push(label ? `Decision ${m[1] || ""} ${label}`.replace(/\s+/g, " ").trim() : `Decision ${m[1] || ""}`.trim());
    }
  }

  if (decisions.length === 0) {
    const body = sectionBody(specContent, DECISIONS_HEADING);
    for (const raw of body.split("\n")) {
      const bullet = raw.trim().match(/^(?:[-*+]|\d+\.)\s+(.*)$/);
      if (bullet && bullet[1].trim()) decisions.push(bullet[1].trim());
    }
  }

  return dedupe(decisions).slice(0, MAX_PARSED_ITEMS);
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * App-side cross-check: every `Decision N` resolved in the spec must have a
 * named test in the plan. The blueprint asks for exactly this because the model
 * cannot be trusted to remember to check itself.
 */
export function crossCheckSpecDecisions(
  specContent: string,
  planContent: string
): { decisions: string[]; missing: string[] } {
  const decisions = parseDecisions(specContent);
  if (decisions.length === 0 || !planContent) return { decisions, missing: [] };

  const plan = normalizeForMatch(planContent);
  const missing = decisions.filter((d) => {
    const number = d.match(/Decision\s*(\d+)/i);
    if (number && new RegExp("decision\\s*" + number[1] + "\\b").test(plan)) return false;
    const label = normalizeForMatch(d.replace(/Decision\s*\d*/i, ""));
    // Require a reasonably long label match so generic words don't count.
    if (label.length >= 12 && plan.includes(label)) return false;
    if (label.length >= 12) {
      const words = label.split(" ").filter((w) => w.length > 3);
      const hits = words.filter((w) => plan.includes(w)).length;
      if (words.length > 0 && hits === words.length) return false;
    }
    return true;
  });

  return { decisions, missing };
}

const SEVERITIES: SdlcFinding["severity"][] = ["blocking", "important", "nit"];

function severityOf(raw: unknown): SdlcFinding["severity"] | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (SEVERITIES.includes(s as SdlcFinding["severity"])) return s as SdlcFinding["severity"];
  // Common variants a model may emit.
  if (s === "block" || s === "blocker" || s === "critical" || s === "high") return "blocking";
  if (s === "major" || s === "medium" || s === "warning") return "important";
  if (s === "minor" || s === "low" || s === "trivial" || s === "style") return "nit";
  return null;
}

function makeFinding(raw: { severity: unknown; description: unknown; location: unknown }, i: number): SdlcFinding | null {
  const severity = severityOf(raw.severity);
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!severity || !description) return null;
  return {
    id: `f${i + 1}`,
    severity,
    description,
    location: typeof raw.location === "string" ? raw.location.trim() : "",
    dismissed: false,
    dismissedBy: "",
  };
}

/**
 * Parses the review artifact's findings: the LAST fenced json block wins
 * (the review prompt puts it at the very end), falling back to the `## Findings`
 * Markdown table so a model that skips the JSON block still yields findings.
 * Returns [] when nothing structured can be found — the UI then says so instead
 * of implying a clean review.
 */
export function parseFindings(reviewContent: string): SdlcFinding[] {
  if (!reviewContent) return [];

  const json = lastFencedBlock(reviewContent, "json");
  if (json) {
    try {
      const parsed = JSON.parse(json.trim());
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { findings?: unknown }).findings)
          ? (parsed as { findings: unknown[] }).findings
          : [];
      const findings = rows
        .map((row, i) => (row && typeof row === "object" ? makeFinding(row as never, i) : null))
        .filter((f): f is SdlcFinding => f !== null)
        .slice(0, MAX_PARSED_ITEMS);
      if (findings.length > 0) return findings;
    } catch {
      // fall through to the table parser
    }
  }

  const body = sectionBody(reviewContent, /^#{1,6}\s*findings?\b/i);
  const findings: SdlcFinding[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // ["", severity, description, location, ""]
    const severity = severityOf(cells[1]);
    if (!severity) continue;
    const description = cells[2] || "";
    if (!description || /^-+$/.test(description)) continue;
    findings.push({
      id: `f${findings.length + 1}`,
      severity,
      description,
      location: cells[3] || "",
      dismissed: false,
      dismissedBy: "",
    });
    if (findings.length >= MAX_PARSED_ITEMS) break;
  }
  return findings;
}

/** Findings that still block the pipeline (blocking and not dismissed). */
export function blockingFindings(data: BoxData): SdlcFinding[] {
  return (data.sdlcFindings || []).filter((f) => f.severity === "blocking" && !f.dismissed);
}

// === Gate evaluation ===

/**
 * A condition that forces this stage to stay gated no matter what the box's
 * `sdlcGateRequired` toggle says. Hard gates (Intent, Merge) always return a
 * reason; the others return one only while their condition holds.
 */
export function forcedGateReason(type: BoxType | string, data: BoxData): string | null {
  const meta = sdlcStageMeta(type);
  if (!meta) return null;
  if (meta.hardGate) {
    return meta.stage === "intent"
      ? "Stage 1 (Intent) is always a hard gate."
      : "Stage 6 (Merge) is always a hard gate.";
  }
  switch (meta.stage) {
    case "spec":
      return (data.sdlcOpenItems || []).length > 0
        ? `${(data.sdlcOpenItems || []).length} open question(s) are still unresolved.`
        : null;
    case "plan":
      return (data.sdlcGaps || []).length > 0
        ? `${(data.sdlcGaps || []).length} spec decision(s) have no named test in the plan.`
        : null;
    case "implementation":
      return data.sdlcDeviation ? "The implementation artifact reports a deviation from the plan." : null;
    case "review":
      return blockingFindings(data).length > 0
        ? `${blockingFindings(data).length} blocking finding(s) are not dismissed yet.`
        : null;
    default:
      return null;
  }
}

/**
 * The stage's effective gate: whether the next stage must wait for an approval,
 * and whether the "auto-advance" toggle may be turned off at all.
 */
export function gateState(
  type: BoxType | string,
  data: BoxData
): { required: boolean; locked: boolean; reason: string } {
  const forced = forcedGateReason(type, data);
  const required = forced !== null ? true : data.sdlcGateRequired !== false;
  return { required, locked: forced !== null, reason: forced || "" };
}

/** Human-readable label for a gate state, used by the panel and the export. */
export function describeGate(data: BoxData): string {
  const versions = data.sdlcVersions || [];
  const latest = latestVersion(versions);
  if (!latest && data.sdlcGate !== "rejected") return "No artifact yet";
  const v = latest ? `v${latest.version}` : "—";
  switch (data.sdlcGate) {
    case "approved":
      return `Approved by ${data.sdlcApprovedBy || "someone"} (${v})`;
    case "changes_requested":
      return `Changes requested (${v})`;
    case "rejected":
      return `Rejected (${v})`;
    case "stale":
      return `Stale — an upstream stage changed (${v})`;
    default:
      return `Awaiting approval (${v})`;
  }
}

// === Board graph queries (SDLC boxes only) ===

/** Box ids reachable from `startId` by following outgoing edges (cycles safe). */
export function downstreamIds(nodes: Node[], edges: Edge[], startId: string): string[] {
  const isSdlcNode = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return !!n && isSdlcBox(n.data?.boxType || n.type);
  };
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges.filter((e) => e.source === current)) {
      if (!isSdlcNode(edge.target) || seen.has(edge.target)) continue;
      seen.add(edge.target);
      queue.push(edge.target);
    }
  }
  seen.delete(startId);
  return [...seen];
}

/** Direct upstream SDLC boxes of a box, with their titles and box types. */
function upstreamSdlcBoxes(
  nodes: Node[],
  edges: Edge[],
  boxData: Record<string, BoxData>,
  id: string
): { id: string; title: string; type: BoxType; data: BoxData }[] {
  const out: { id: string; title: string; type: BoxType; data: BoxData }[] = [];
  for (const edge of edges.filter((e) => e.target === id)) {
    const node = nodes.find((n) => n.id === edge.source);
    const data = boxData[edge.source];
    if (!node || !data) continue;
    const type = (node.data?.boxType || node.type) as BoxType;
    if (!isSdlcBox(type)) continue;
    out.push({ id: edge.source, title: (node.data?.title as string) || "Unnamed", type, data });
  }
  return out;
}

/**
 * Why this stage may not run right now (null = it may).
 *
 * Only SDLC boxes gate each other: an Idea/Documents/Research box upstream never
 * blocks anything. A stage whose upstream is configured to auto-advance (no gate
 * required) does not block either — that is the whole meaning of the toggle. The
 * Merge stage additionally refuses while any upstream Review box has an
 * undismissed blocking finding, whatever the configuration says.
 */
export function upstreamBlockReason(
  nodes: Node[],
  edges: Edge[],
  boxData: Record<string, BoxData>,
  id: string
): string | null {
  const node = nodes.find((n) => n.id === id);
  const type = node?.data?.boxType || node?.type;
  if (!isSdlcBox(type)) return null;
  const meta = sdlcStageMeta(type);
  const upstream = upstreamSdlcBoxes(nodes, edges, boxData, id);

  for (const up of upstream) {
    // A stage configured to auto-advance does not gate anything below it — that
    // is exactly what the toggle means.
    if (!gateState(up.type, up.data).required) continue;
    if (isApprovedAtLatest(up.data)) continue;
    const detail = latestVersion(up.data.sdlcVersions)
      ? `is not approved (${describeGate(up.data).toLowerCase()})`
      : "has produced no artifact yet";
    return `🔒 ${up.title} ${detail} — approve it before running this stage.`;
  }

  if (meta?.stage === "merge") {
    for (const up of upstream) {
      const blocking = blockingFindings(up.data);
      if (blocking.length > 0) {
        return `🔒 ${up.title} has ${blocking.length} undismissed blocking finding(s) — dismiss or resolve them before merging.`;
      }
    }
  }

  return null;
}

/** The upstream SDLC box whose artifact this stage consumes (for cross-checks). */
export function upstreamStageContent(
  nodes: Node[],
  edges: Edge[],
  boxData: Record<string, BoxData>,
  id: string,
  stage: SdlcStage
): string {
  const wanted = SDLC_STAGES.find((s) => s.stage === stage);
  if (!wanted) return "";
  for (const up of upstreamSdlcBoxes(nodes, edges, boxData, id)) {
    if (up.type === wanted.type) {
      const latest = latestVersion(up.data.sdlcVersions);
      return latest ? latest.content : up.data.content || "";
    }
  }
  return "";
}

// === Audit export ===

function fmtTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/**
 * Exports the connected stage chain (upstream and downstream of `startId`) as a
 * single Markdown document: every artifact, its versions, who approved what and
 * when, the findings, and the audit trail — plus a JSON appendix with the whole
 * record for machine use. This is the traceability deliverable a human can audit
 * a merge with.
 */
export function buildAuditExport(opts: {
  nodes: Node[];
  edges: Edge[];
  boxData: Record<string, BoxData>;
  boardTitle: string;
  startId: string;
}): string {
  const { nodes, edges, boxData, boardTitle, startId } = opts;

  // Collect the SDLC chain containing startId: downstream first, then walk
  // upstream from every collected box (cycles safe).
  const collected = new Set<string>([startId]);
  const expandUpstream = (from: string) => {
    for (const edge of edges.filter((e) => e.target === from)) {
      const node = nodes.find((n) => n.id === edge.source);
      if (!node || !isSdlcBox(node.data?.boxType || node.type)) continue;
      if (collected.has(edge.source)) continue;
      collected.add(edge.source);
      expandUpstream(edge.source);
    }
  };
  for (const id of [startId, ...downstreamIds(nodes, edges, startId)]) {
    collected.add(id);
    expandUpstream(id);
  }
  const chain = [...collected]
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is Node => !!n && isSdlcBox(n.data?.boxType || n.type))
    .sort((a, b) => {
      const ia = sdlcStageMeta(a.data?.boxType || a.type)?.index ?? 99;
      const ib = sdlcStageMeta(b.data?.boxType || b.type)?.index ?? 99;
      return ia - ib;
    });

  const intentBox = chain.find((n) => (n.data?.boxType || n.type) === "sdlc-intent");
  const intentTitle = ((intentBox?.data?.title as string) || "").trim();
  const boardName = (boardTitle || "").trim();
  // The board title names the task — unless the board was never named, in which
  // case the first stage's box title is the only meaningful label there is.
  const unnamedBoard = !boardName || boardName === "Untitled Board";
  const taskTitle = (unnamedBoard ? intentTitle || boardName : boardName) || "SDLC task";

  const lines: string[] = [
    `# SDLC audit record — ${taskTitle}`,
    "",
    `- Exported: ${fmtTime(Date.now())}`,
    `- Stages in this record: ${chain.length} of ${SDLC_STAGES.length}`,
    `- Board: ${boardTitle || "Untitled Board"}`,
    "",
    "Every artifact below is immutable: regeneration appends a version, and nothing is ever",
    "silently overwritten.",
    "",
  ];

  const appendix: Record<string, unknown> = { task: taskTitle, board: boardTitle, stages: [] };

  for (const node of chain) {
    const type = (node.data?.boxType || node.type) as BoxType;
    const meta = sdlcStageMeta(type);
    const data = boxData[node.id];
    if (!meta || !data) continue;
    const versions = data.sdlcVersions || [];
    const latest = latestVersion(versions);
    const gate = gateState(type, data);

    lines.push(
      "---",
      "",
      `## ${meta.label} — ${(node.data?.title as string) || "Untitled"}`,
      "",
      `- Gate state: **${describeGate(data)}**`,
      `- Approval required before the next stage: ${gate.required ? "yes" : "no"}${gate.reason ? ` (locked: ${gate.reason})` : ""}`,
      latest ? `- Latest version: v${latest.version} (${latest.source}, ${latest.createdBy}, ${fmtTime(latest.createdAt)})` : "- Latest version: —",
      versions.length > 0 ? `- Versions: ${versions.map((v) => "v" + v.version).join(", ")}` : "- Versions: —",
      ""
    );

    if (meta.stage === "spec" && (data.sdlcOpenItems || []).length > 0) {
      lines.push(`### Unresolved items (${(data.sdlcOpenItems || []).length})`, "");
      for (const item of data.sdlcOpenItems || []) lines.push(`- ⚠ ${item}`);
      lines.push("");
    }

    if (meta.stage === "plan" && (data.sdlcGaps || []).length > 0) {
      lines.push(`### Spec decisions with no named test (${(data.sdlcGaps || []).length})`, "");
      for (const gap of data.sdlcGaps || []) lines.push(`- ⚠ ${gap}`);
      lines.push("");
    }

    if (meta.stage === "implementation" && data.sdlcDeviation) {
      lines.push("### Deviation from the approved plan", "", "The implementation artifact reports a deviation (see its `## Plan deviations` section).", "");
    }

    if (meta.stage === "review" && (data.sdlcFindings || []).length > 0) {
      lines.push(`### Findings (${(data.sdlcFindings || []).length})`, "", "| severity | dismissed | description | location |", "|---|---|---|---|");
      for (const f of data.sdlcFindings || []) {
        lines.push(`| ${f.severity} | ${f.dismissed ? `yes — ${f.dismissedBy || "someone"}` : "no"} | ${f.description.replace(/\|/g, "\\|")} | ${f.location || "—"} |`);
      }
      lines.push("");
    }

    lines.push("### Artifact", "", latest ? latest.content : "_No artifact yet._", "");

    if (data.sdlcFeedback) {
      lines.push("### Last change request at the gate", "", data.sdlcFeedback, "");
    }

    if (versions.length > 1) {
      lines.push("### Version history", "");
      for (const v of versions) {
        lines.push(`- v${v.version} — ${v.source} by ${v.createdBy} at ${fmtTime(v.createdAt)}${v.note ? ` — _${v.note}_` : ""}`);
      }
      lines.push("");
    }

    if ((data.sdlcHistory || []).length > 0) {
      lines.push("### Audit trail", "");
      for (const e of data.sdlcHistory || []) {
        lines.push(`- ${fmtTime(e.at)} — **${e.actor}** ${e.action}${e.note ? ` — _${e.note}_` : ""}`);
      }
      lines.push("");
    }

    (appendix.stages as unknown[]).push({
      stage: meta.stage,
      box_id: node.id,
      title: node.data?.title || "Untitled",
      gate: data.sdlcGate || "pending",
      gate_required: gate.required,
      approved_by: data.sdlcApprovedBy || null,
      approved_at: data.sdlcApprovedAt || null,
      approved_version: data.sdlcApprovedVersion || null,
      versions: versions.map((v) => ({
        version: v.version,
        source: v.source,
        created_by: v.createdBy,
        created_at: v.createdAt,
        note: v.note,
      })),
      findings: data.sdlcFindings || [],
      open_items: data.sdlcOpenItems || [],
      plan_gaps: data.sdlcGaps || [],
      deviation: data.sdlcDeviation || false,
      history: data.sdlcHistory || [],
    });
  }

  lines.push(
    "---",
    "",
    "## Machine-readable record",
    "",
    "```json",
    JSON.stringify(appendix, null, 2),
    "```",
    ""
  );

  return lines.join("\n");
}

/** Case-insensitive de-dupe that keeps the first occurrence order. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
