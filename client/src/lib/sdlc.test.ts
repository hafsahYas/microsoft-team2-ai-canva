import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import type { BoxData, SdlcVersion } from "../types.js";
import {
  SDLC_STAGES,
  SDLC_TYPES,
  appendEvent,
  appendVersion,
  blockingFindings,
  buildAuditExport,
  buildStagePrompt,
  crossCheckSpecDecisions,
  describeGate,
  downstreamIds,
  forcedGateReason,
  gateState,
  isApprovedAtLatest,
  isSdlcBox,
  latestVersion,
  parseDecisions,
  parseDeviation,
  parseFindings,
  parseOpenItems,
  truncateArtifact,
  upstreamBlockReason,
  upstreamStageContent,
  MAX_SDLC_ARTIFACT_CHARS,
} from "./sdlc.js";

/** Minimal boxData for an SDLC stage box. */
function data(patch: Partial<BoxData> = {}): BoxData {
  return {
    content: "",
    prompt: "",
    systemPrompt: "",
    output: "",
    status: "idle",
    sdlcVersions: [],
    sdlcHistory: [],
    sdlcFindings: [],
    sdlcOpenItems: [],
    sdlcGaps: [],
    sdlcDeviation: false,
    sdlcGateRequired: true,
    skills: "",
    ...patch,
  } as BoxData;
}

function version(n: number, content = `artifact v${n}`): SdlcVersion {
  return { version: n, content, createdAt: 1700000000000 + n, createdBy: "Ada", source: "generated", note: "" };
}

/** Builds a node for a box type with a title. */
function node(id: string, type: string, title = id): Node {
  return { id, type, position: { x: 0, y: 0 }, data: { boxType: type, title } };
}

function edge(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target };
}

describe("stage metadata", () => {
  it("lists the six stages in order with the two hard gates", () => {
    expect(SDLC_STAGES.map((s) => s.stage)).toEqual([
      "intent", "spec", "plan", "implementation", "review", "merge",
    ]);
    expect(SDLC_STAGES.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(SDLC_STAGES.filter((s) => s.hardGate).map((s) => s.stage)).toEqual(["intent", "merge"]);
    expect(SDLC_TYPES).toHaveLength(6);
  });

  it("recognises SDLC box types only", () => {
    expect(isSdlcBox("sdlc-intent")).toBe(true);
    expect(isSdlcBox("research")).toBe(false);
    expect(isSdlcBox(undefined)).toBe(false);
  });
});

describe("truncateArtifact", () => {
  it("leaves short artifacts untouched", () => {
    expect(truncateArtifact("hello")).toEqual({ content: "hello", truncated: false });
  });

  it("caps long artifacts with a visible marker", () => {
    const long = "x".repeat(MAX_SDLC_ARTIFACT_CHARS + 100);
    const result = truncateArtifact(long);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("[truncated at 60000 chars]");
    expect(result.content.length).toBeLessThan(long.length);
  });
});

describe("buildStagePrompt", () => {
  const namedInputs = [{ name: "Raw request", output: "Add SSO to the admin console" }];

  it("fills inputs and omits the optional blocks when empty", () => {
    const prompt = buildStagePrompt({ prompt: "Intent from:\n{{inputs}}" }, namedInputs);
    expect(prompt).toContain("Add SSO to the admin console");
    expect(prompt).not.toContain("Org skills");
    expect(prompt).not.toContain("Requested changes");
  });

  it("appends skills and change-request feedback when present", () => {
    const prompt = buildStagePrompt(
      { prompt: "Spec from:\n{{inputs}}", skills: "No PII in logs.", feedback: "Name the limit explicitly." },
      namedInputs
    );
    expect(prompt).toContain("## Org skills / rule sets");
    expect(prompt).toContain("No PII in logs.");
    expect(prompt).toContain("## Requested changes from the previous review");
    expect(prompt).toContain("Name the limit explicitly.");
  });
});

describe("appendVersion / appendEvent", () => {
  it("numbers versions monotonically and never mutates the previous array", () => {
    const v1 = appendVersion(undefined, { content: "a", createdBy: "Ada", source: "generated", at: 1 });
    const v2 = appendVersion(v1, { content: "b", createdBy: "Bo", source: "edited", at: 2 });
    expect(v1).toHaveLength(1);
    expect(v2.map((v) => v.version)).toEqual([1, 2]);
    expect(v1[0].content).toBe("a");
    expect(v2[1]).toMatchObject({ source: "edited", note: "", createdBy: "Bo" });
  });

  it("defaults every field so Firestore never sees undefined", () => {
    const added = appendVersion(
      [{ version: 7, content: "x", createdAt: 0, createdBy: "", source: "generated", note: "" }],
      { content: "y", createdBy: "", source: "generated" }
    );
    const newVersion = added[added.length - 1];
    expect(newVersion.version).toBe(8);
    expect(Object.values(newVersion).every((value) => value !== undefined)).toBe(true);
    const [e] = appendEvent(undefined, { actor: "Ada", action: "approved spec v2" });
    expect(e.note).toBe("");
    expect(Object.values(e).every((value) => value !== undefined)).toBe(true);
  });

  it("picks the highest version as latest regardless of array order", () => {
    expect(latestVersion([version(3), version(1), version(7)])?.version).toBe(7);
    expect(latestVersion([])).toBeNull();
  });

  it("only counts an approval that matches the latest version", () => {
    const approved = data({ sdlcVersions: [version(1)], sdlcGate: "approved", sdlcApprovedVersion: 1 });
    expect(isApprovedAtLatest(approved)).toBe(true);
    expect(isApprovedAtLatest({ ...approved, sdlcVersions: [version(1), version(2)] })).toBe(false);
    expect(isApprovedAtLatest({ ...approved, sdlcGate: "stale" })).toBe(false);
    expect(isApprovedAtLatest(data())).toBe(false);
  });
});

describe("parseOpenItems", () => {
  it("collects bullets under an unresolved heading and ⚠ lines elsewhere", () => {
    const spec = [
      "## Decisions",
      "### Decision 1 — Session length",
      "Cap sessions at 8 hours.",
      "## Unresolved",
      "⚠ Which identity provider is authoritative?",
      "- Rollout order for the three regions is unknown",
    ].join("\n");
    expect(parseOpenItems(spec)).toEqual([
      "Which identity provider is authoritative?",
      "Rollout order for the three regions is unknown",
    ]);
  });

  it("ignores a section that says none and de-duplicates", () => {
    expect(parseOpenItems("## Unresolved\nNone\n")).toEqual([]);
    expect(parseOpenItems("⚠ Same question?\n⚠ same question?")).toEqual(["Same question?"]);
    expect(parseOpenItems("")).toEqual([]);
  });
});

describe("parseDeviation", () => {
  it("detects a real deviation section", () => {
    const artifact = "## Diff\n```diff\n+ x\n```\n## Plan deviations\nStep 3 is impossible without a schema migration.";
    expect(parseDeviation(artifact)).toBe(true);
  });

  it("treats an empty or 'none' section as no deviation", () => {
    expect(parseDeviation("## Plan deviations\n")).toBe(false);
    expect(parseDeviation("## Plan deviations\nNone")).toBe(false);
    expect(parseDeviation("## Diff\nnothing else")).toBe(false);
  });
});

describe("parseDecisions / crossCheckSpecDecisions", () => {
  const spec = [
    "## Decisions",
    "### Decision 1 — Session length",
    "Cap sessions at 8 hours.",
    "### Decision 2 — Audit log retention",
    "Keep audit logs for 400 days.",
  ].join("\n");

  it("reads the Decision headings", () => {
    const decisions = parseDecisions(spec);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toContain("Session length");
  });

  it("reports decisions with no named test in the plan", () => {
    const plan = "## Tests\n- \"Session length cap\" → proves Decision 1";
    const { decisions, missing } = crossCheckSpecDecisions(spec, plan);
    expect(decisions).toHaveLength(2);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("Audit log retention");
  });

  it("accepts a plan that names every decision and stays quiet without a spec", () => {
    const plan = "## Tests\n- \"Session length cap\" → Decision 1\n- \"Audit log retention\" → Decision 2";
    expect(crossCheckSpecDecisions(spec, plan).missing).toEqual([]);
    expect(crossCheckSpecDecisions("", plan)).toEqual({ decisions: [], missing: [] });
  });
});

describe("parseFindings", () => {
  it("prefers the last json fenced block", () => {
    const artifact = [
      "## Findings",
      "| severity | description | location |",
      "|---|---|---|",
      "| nit | table row that should lose | a.ts:1 |",
      "",
      "```json",
      '[{"severity":"blocking","description":"No auth check","location":"api.ts:42"}]',
      "```",
    ].join("\n");
    const findings = parseFindings(artifact);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "f1",
      severity: "blocking",
      description: "No auth check",
      location: "api.ts:42",
      dismissed: false,
      dismissedBy: "",
    });
  });

  it("falls back to the Markdown findings table", () => {
    const artifact = [
      "## Findings",
      "| severity | description | location |",
      "|---|---|---|",
      "| blocking | Missing rate limit | api.ts:10 |",
      "| nit | Typo in comment | ui.tsx:3 |",
    ].join("\n");
    expect(parseFindings(artifact).map((f) => f.severity)).toEqual(["blocking", "nit"]);
  });

  it("maps common severity variants and drops unusable rows", () => {
    const artifact = '```json\n[{"severity":"critical","description":"a"},{"severity":"medium","description":"b"},{"severity":"low","description":"c"},{"severity":"whatever","description":"d"},{"severity":"blocking"}]\n```';
    expect(parseFindings(artifact).map((f) => f.severity)).toEqual(["blocking", "important", "nit"]);
  });

  it("returns nothing for junk or missing content", () => {
    expect(parseFindings("## Findings\nno table here")).toEqual([]);
    expect(parseFindings("```json\n{not json\n```")).toEqual([]);
    expect(parseFindings("```json\n[]\n```")).toEqual([]);
    expect(parseFindings("")).toEqual([]);
  });

  it("caps the number of findings and never leaves undefined fields", () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ severity: "nit", description: `f${i}`, location: "x:1" }));
    const findings = parseFindings("```json\n" + JSON.stringify(rows) + "\n```");
    expect(findings).toHaveLength(50);
    for (const f of findings) {
      expect(Object.values(f).every((value) => value !== undefined)).toBe(true);
    }
  });
});

describe("gateState / forcedGateReason", () => {
  it("keeps Intent and Merge locked as hard gates", () => {
    for (const type of ["sdlc-intent", "sdlc-merge"]) {
      const state = gateState(type, data({ sdlcGateRequired: false }));
      expect(state.locked).toBe(true);
      expect(state.required).toBe(true);
      expect(state.reason).toMatch(/hard gate/);
    }
  });

  it("locks Spec while questions are unresolved, even with auto-advance off", () => {
    const state = gateState("sdlc-spec", data({ sdlcGateRequired: false, sdlcOpenItems: ["Which IdP?"] }));
    expect(state.locked).toBe(true);
    expect(state.reason).toContain("open question");
    expect(gateState("sdlc-spec", data({ sdlcGateRequired: false })).locked).toBe(false);
  });

  it("locks Plan on missing tests, Implementation on deviation, Review on blocking findings", () => {
    expect(gateState("sdlc-plan", data({ sdlcGaps: ["Decision 2"] })).locked).toBe(true);
    expect(gateState("sdlc-implement", data({ sdlcDeviation: true })).locked).toBe(true);
    const review = data({
      sdlcFindings: [
        { id: "f1", severity: "blocking", description: "a", location: "", dismissed: false, dismissedBy: "" },
        { id: "f2", severity: "nit", description: "b", location: "", dismissed: false, dismissedBy: "" },
      ],
    });
    expect(gateState("sdlc-review", review).locked).toBe(true);
    // Dismissing the blocking finding unlocks it.
    review.sdlcFindings![0].dismissed = true;
    expect(gateState("sdlc-review", review).locked).toBe(false);
    expect(blockingFindings(review)).toEqual([]);
  });

  it("lets a non-hard stage auto-advance when nothing forces the gate", () => {
    expect(gateState("sdlc-spec", data({ sdlcGateRequired: false }))).toMatchObject({ required: false, locked: false });
    expect(gateState("sdlc-plan", data()).required).toBe(true);
    expect(forcedGateReason("research", data())).toBeNull();
  });
});

describe("describeGate", () => {
  it("describes every state including no artifact", () => {
    expect(describeGate(data())).toBe("No artifact yet");
    const approved = data({ sdlcVersions: [version(2)], sdlcGate: "approved", sdlcApprovedBy: "Ada" });
    expect(describeGate(approved)).toBe("Approved by Ada (v2)");
    expect(describeGate(data({ sdlcVersions: [version(1)], sdlcGate: "changes_requested" }))).toContain("Changes requested");
    expect(describeGate(data({ sdlcVersions: [version(1)], sdlcGate: "rejected" }))).toContain("Rejected");
    expect(describeGate(data({ sdlcVersions: [version(1)], sdlcGate: "stale" }))).toContain("Stale");
    expect(describeGate(data({ sdlcVersions: [version(1)] }))).toContain("Awaiting approval");
  });
});

describe("upstreamBlockReason", () => {
  const nodes = [
    node("i", "sdlc-intent", "1 · Intent"),
    node("s", "sdlc-spec", "2 · Spec"),
    node("p", "sdlc-plan", "3 · Plan"),
    node("rv", "sdlc-review", "5 · Review"),
    node("m", "sdlc-merge", "6 · Merge"),
    node("idea", "idea", "Raw request"),
  ];
  const edges = [edge("idea", "i"), edge("i", "s"), edge("s", "p"), edge("rv", "m")];

  it("blocks downstream until the upstream stage is approved at its latest version", () => {
    const boxData: Record<string, BoxData> = {
      i: data({ sdlcVersions: [version(1)], sdlcGate: "pending" }),
      s: data({ sdlcVersions: [version(1)] }),
    };
    const reason = upstreamBlockReason(nodes, edges, boxData, "s");
    expect(reason).toContain("1 · Intent");
    expect(reason).toContain("not approved");

    boxData.i = data({ sdlcVersions: [version(1)], sdlcGate: "approved", sdlcApprovedVersion: 1 });
    expect(upstreamBlockReason(nodes, edges, boxData, "s")).toBeNull();

    // A regeneration (new version) invalidates the old approval.
    boxData.i = data({
      sdlcVersions: [version(1), version(2)],
      sdlcGate: "approved",
      sdlcApprovedVersion: 1,
    });
    expect(upstreamBlockReason(nodes, edges, boxData, "s")).toContain("1 · Intent");
  });

  it("reports an upstream with no artifact yet", () => {
    const reason = upstreamBlockReason(nodes, edges, { i: data(), s: data() }, "s");
    expect(reason).toContain("has produced no artifact yet");
  });

  it("never blocks on a non-SDLC upstream box", () => {
    const boxData: Record<string, BoxData> = { idea: data({ content: "raw" }), i: data() };
    expect(upstreamBlockReason(nodes, edges, boxData, "i")).toBeNull();
  });

  it("does not block on an upstream stage that is set to auto-advance", () => {
    // Intent and Merge are hard gates, so auto-advance can only ever apply to a
    // middle stage — use Spec → Plan here.
    const boxData: Record<string, BoxData> = {
      s: data({ sdlcVersions: [version(1)], sdlcGate: "pending", sdlcGateRequired: false }),
      p: data(),
    };
    expect(upstreamBlockReason(nodes, edges, boxData, "p")).toBeNull();
    // …but a mid-stage keeps blocking while its own condition forces the gate.
    boxData.s = data({ sdlcVersions: [version(1)], sdlcOpenItems: ["Which IdP?"], sdlcGateRequired: false });
    expect(upstreamBlockReason(nodes, edges, boxData, "p")).toContain("not approved");
  });

  it("blocks Merge while an upstream Review has undismissed blocking findings", () => {
    const boxData: Record<string, BoxData> = {
      rv: data({
        sdlcVersions: [version(1)],
        sdlcGate: "approved",
        sdlcApprovedVersion: 1,
        sdlcGateRequired: false,
        sdlcFindings: [
          { id: "f1", severity: "blocking", description: "No auth check", location: "a.ts:1", dismissed: false, dismissedBy: "" },
        ],
      }),
      m: data(),
    };
    const reason = upstreamBlockReason(nodes, edges, boxData, "m");
    expect(reason).toContain("blocking finding");
    boxData.rv.sdlcFindings![0].dismissed = true;
    expect(upstreamBlockReason(nodes, edges, boxData, "m")).toBeNull();
  });

  it("ignores non-SDLC boxes entirely", () => {
    expect(upstreamBlockReason(nodes, edges, { idea: data() }, "idea")).toBeNull();
  });
});

describe("downstreamIds", () => {
  it("walks SDLC edges transitively, is cycle safe and skips non-SDLC boxes", () => {
    const nodes = [
      node("i", "sdlc-intent"),
      node("s", "sdlc-spec"),
      node("p", "sdlc-plan"),
      node("note", "note"),
      node("x", "research"),
    ];
    const edges = [edge("i", "s"), edge("s", "p"), edge("p", "i"), edge("s", "note"), edge("i", "x")];
    expect(downstreamIds(nodes, edges, "i").sort()).toEqual(["p", "s"]);
    expect(downstreamIds(nodes, edges, "p")).toEqual(["i", "s"]);
    expect(downstreamIds(nodes, edges, "note")).toEqual([]);
  });
});

describe("upstreamStageContent", () => {
  it("returns the upstream stage's latest artifact for cross-checks", () => {
    const nodes = [node("s", "sdlc-spec"), node("p", "sdlc-plan")];
    const edges = [edge("s", "p")];
    const boxData: Record<string, BoxData> = {
      s: data({ sdlcVersions: [version(1, "### Decision 1 — Keep sessions short")] }),
      p: data(),
    };
    expect(upstreamStageContent(nodes, edges, boxData, "p", "spec")).toContain("Decision 1");
    expect(upstreamStageContent(nodes, edges, boxData, "p", "intent")).toBe("");
  });
});

describe("buildAuditExport", () => {
  const nodes = [
    node("i", "sdlc-intent", "1 · Intent"),
    node("s", "sdlc-spec", "2 · Spec"),
    node("rv", "sdlc-review", "5 · Review"),
    node("m", "sdlc-merge", "6 · Merge"),
  ];
  const edges = [edge("i", "s"), edge("rv", "m")];
  const boxData: Record<string, BoxData> = {
    i: data({
      sdlcVersions: [version(1, "# Add SSO"), version(2, "# Add SSO (revised)")],
      sdlcGate: "approved",
      sdlcApprovedVersion: 2,
      sdlcApprovedBy: "Ada",
      sdlcApprovedAt: 1700000005000,
      sdlcHistory: [{ at: 1700000005000, actor: "Ada", action: "approved intent v2", note: "looks right" }],
    }),
    s: data({
      sdlcVersions: [version(1, "## Unresolved\n⚠ Which IdP?")],
      sdlcOpenItems: ["Which IdP?"],
      sdlcFeedback: "Name the session limit.",
      sdlcGaps: ["Decision 2 — Retention"],
    }),
    rv: data({
      sdlcVersions: [version(1, "review text")],
      sdlcFindings: [
        { id: "f1", severity: "blocking", description: "No auth check", location: "api.ts:42", dismissed: true, dismissedBy: "Bo" },
      ],
    }),
    m: data(),
  };

  it("exports the whole connected chain in stage order with versions, approvals and items", () => {
    const doc = buildAuditExport({ nodes, edges, boxData, boardTitle: "SSO board", startId: "s" });
    expect(doc).toContain("# SDLC audit record — SSO board");
    expect(doc.indexOf("## 1 · Intent")).toBeLessThan(doc.indexOf("## 2 · Spec"));
    expect(doc).toContain("Approved by Ada");
    expect(doc).toContain("v1, v2");
    expect(doc).toContain("Name the session limit.");
    expect(doc).toContain("Which IdP?");
    expect(doc).toContain("Decision 2 — Retention");
    expect(doc).toContain("approved intent v2");
    expect(doc).toContain("## Machine-readable record");
    expect(doc).toContain('"approved_version": 2');
    // The unrelated merge/review pair is NOT part of this chain.
    expect(doc).not.toContain("## 6 · Merge");
  });

  it("includes findings and the review stage when the chain reaches them", () => {
    const doc = buildAuditExport({ nodes, edges, boxData, boardTitle: "SSO board", startId: "m" });
    expect(doc).toContain("## 5 · Review");
    expect(doc).toContain("## 6 · Merge");
    expect(doc).toContain("No auth check");
    expect(doc).toContain("| blocking | yes — Bo |");
    expect(doc).toContain("Stages in this record: 2 of 6");
  });

  it("falls back to the intent box title when the board was never named", () => {
    const doc = buildAuditExport({ nodes, edges, boxData, boardTitle: "", startId: "i" });
    expect(doc).toContain("# SDLC audit record — 1 · Intent");
    const untitled = buildAuditExport({ nodes, edges, boxData, boardTitle: "Untitled Board", startId: "i" });
    expect(untitled).toContain("# SDLC audit record — 1 · Intent");
    const named = buildAuditExport({ nodes, edges, boxData, boardTitle: "SSO board", startId: "i" });
    expect(named).toContain("# SDLC audit record — SSO board");
  });
});
