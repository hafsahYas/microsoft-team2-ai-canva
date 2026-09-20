import { describe, expect, it } from "vitest";
import type { BoxData } from "../types.js";
import { hasDownloadableOutcome, outcomeFilename, outcomeMime, outcomeText, slugifyFilename } from "./download.js";

function data(patch: Partial<BoxData> = {}): BoxData {
  return { content: "", prompt: "", systemPrompt: "", output: "", status: "idle", ...patch } as BoxData;
}

describe("slugifyFilename", () => {
  it("lowercases, strips punctuation and collapses dashes", () => {
    expect(slugifyFilename("My  Research Box!")).toBe("my-research-box");
    expect(slugifyFilename("Béta / Gamma")).toBe("beta-gamma");
    expect(slugifyFilename("---Trim---")).toBe("trim");
  });

  it("caps the length and never returns an empty name", () => {
    const long = "a".repeat(200);
    expect(slugifyFilename(long).length).toBeLessThanOrEqual(60);
    expect(slugifyFilename("!!!")).toBe("box");
    expect(slugifyFilename("")).toBe("box");
  });
});

describe("outcomeFilename", () => {
  it("uses the blueprint's artifact names for the SDLC stages", () => {
    expect(outcomeFilename("sdlc-intent", "1 · Intent Box")).toBe("intent.md");
    expect(outcomeFilename("sdlc-spec", "2 · Spec Box")).toBe("spec.md");
    expect(outcomeFilename("sdlc-plan", "3 · Plan Box")).toBe("plan.md");
    expect(outcomeFilename("sdlc-implement", "4 · Implementation Box")).toBe("implementation.md");
    expect(outcomeFilename("sdlc-review", "5 · Review Box")).toBe("review.md");
    expect(outcomeFilename("sdlc-merge", "6 · Merge Box")).toBe("merge.md");
  });

  it("uses the box type for the other text boxes and the label for custom ones", () => {
    expect(outcomeFilename("research", "Research Box")).toBe("research.md");
    expect(outcomeFilename("summarize", "Summarize Box")).toBe("summary.md");
    expect(outcomeFilename("prd", "PRD Box")).toBe("prd.md");
    expect(outcomeFilename("devplan", "Dev Plan Box")).toBe("dev-plan.md");
    expect(outcomeFilename("agent", "Agent Box")).toBe("agent-answer.md");
    expect(outcomeFilename("slides", "Slides Box")).toBe("slides.md");
    expect(outcomeFilename("custom", "Security Review Lite")).toBe("security-review-lite.md");
    expect(outcomeFilename("codeedit", "Code Edit Box")).toBe("code-changes.patch");
  });
});

describe("hasDownloadableOutcome", () => {
  it("covers the text-output family and the SDLC stages only", () => {
    for (const type of [
      "research", "summarize", "prd", "devplan", "agent", "slides", "custom", "codemap", "codeedit",
      "sdlc-intent", "sdlc-spec", "sdlc-plan", "sdlc-implement", "sdlc-review", "sdlc-merge",
    ]) {
      expect(hasDownloadableOutcome(type)).toBe(true);
    }
    for (const type of ["idea", "image", "documents", "cartoon", "code", "ui", "stitch", "note", "label", "timer", "checklist", "chatbot"]) {
      expect(hasDownloadableOutcome(type)).toBe(false);
    }
  });
});

describe("outcomeText", () => {
  it("returns the generated output for text boxes, newline terminated", () => {
    expect(outcomeText("research", data({ output: "# Findings" }))).toBe("# Findings\n");
  });

  it("returns nothing when the box has not run yet", () => {
    expect(outcomeText("research", data())).toBe("");
    expect(outcomeText("research", data({ output: "   " }))).toBe("");
  });

  it("returns the latest artifact for an SDLC stage (output mirrors it)", () => {
    expect(outcomeText("sdlc-intent", data({ output: "# Intent v2" }))).toBe("# Intent v2\n");
  });

  it("renders a slide deck as Markdown", () => {
    const deck = outcomeText(
      "slides",
      data({
        output: "raw json",
        slides: [
          { title: "Problem", bullets: ["A", "B"] },
          { title: "Solution", bullets: ["C"], notes: "say this" },
        ],
      })
    );
    expect(deck).toContain("## 1. Problem");
    expect(deck).toContain("- A");
    expect(deck).toContain("## 2. Solution");
    expect(deck).toContain("> say this");
  });

  it("falls back to the raw output when there are no parsed slides", () => {
    expect(outcomeText("slides", data({ output: "no slides parsed" }))).toBe("no slides parsed\n");
  });

  it("downloads a Code Edit box's change set as a git patch", () => {
    const patch = outcomeText("codeedit", data({
      changeSet: [
        { path: "src/a.ts", operation: "update", content: "new\n", original: "old\n", added: 1, removed: 1, reason: "why" },
      ],
    }) as BoxData);
    expect(patch).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(patch).toContain("-old");
    expect(patch).toContain("+new");
    // Nothing proposed yet → nothing to download.
    expect(outcomeText("codeedit", data())).toBe("");
    expect(outcomeMime("codeedit")).toContain("x-patch");
    expect(outcomeMime("research")).toContain("markdown");
  });
});
