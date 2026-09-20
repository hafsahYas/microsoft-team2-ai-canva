import { describe, expect, it } from "vitest";
import type { BoxData } from "../types.js";
import { cleanBoxDataForFirestore } from "./serialization.js";

describe("cleanBoxDataForFirestore", () => {
  it("drops undefined values entirely", () => {
    const data: Record<string, BoxData> = {
      box1: {
        content: "hi",
        status: "done",
        error: undefined,
        output: "out",
      } as unknown as BoxData,
    };
    const cleaned = cleanBoxDataForFirestore(data);
    expect("error" in cleaned.box1).toBe(false);
    expect(cleaned.box1.content).toBe("hi");
  });

  it("strips base64 imageData but keeps http(s) image URLs", () => {
    const data: Record<string, BoxData> = {
      a: { imageData: "data:image/png;base64,AAAA", content: "x" } as unknown as BoxData,
      b: { imageData: "https://storage.example/a.png", content: "y" } as unknown as BoxData,
    };
    const cleaned = cleanBoxDataForFirestore(data);
    expect("imageData" in cleaned.a).toBe(false);
    expect(cleaned.b.imageData).toBe("https://storage.example/a.png");
  });

  it("preserves other fields unchanged", () => {
    const data: Record<string, BoxData> = {
      b: { content: "c", output: "o", status: "running", tokens: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } } as unknown as BoxData,
    };
    const cleaned = cleanBoxDataForFirestore(data);
    expect(cleaned.b).toEqual(data.b);
  });

  it("keeps a full SDLC stage record intact with no nested undefined", () => {
    const stage = {
      content: "context",
      prompt: "p",
      systemPrompt: "s",
      output: "# Intent v2",
      status: "done",
      sdlcGate: "approved",
      sdlcGateRequired: true,
      sdlcApprovedVersion: 2,
      sdlcApprovedBy: "Ada",
      sdlcApprovedAt: 1700000005000,
      sdlcFeedback: "",
      skills: "No PII in logs.",
      sdlcVersions: [
        { version: 1, content: "# Intent", createdAt: 1, createdBy: "Ada", source: "generated", note: "" },
        { version: 2, content: "# Intent v2", createdAt: 2, createdBy: "Bo", source: "edited", note: "tightened" },
      ],
      sdlcHistory: [{ at: 2, actor: "Bo", action: "edited intent v2", note: "" }],
      sdlcFindings: [
        { id: "f1", severity: "blocking", description: "No auth check", location: "api.ts:42", dismissed: false, dismissedBy: "" },
      ],
      sdlcOpenItems: [],
      sdlcGaps: [],
      sdlcDeviation: false,
    } as unknown as BoxData;

    const cleaned = cleanBoxDataForFirestore({ i: stage });
    expect(cleaned.i).toEqual(stage);

    // Firestore rejects undefined ANYWHERE in a nested value — walk the whole
    // record the way the SDK would.
    const nested: unknown[] = [];
    const walk = (value: unknown) => {
      if (value === undefined) nested.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(cleaned.i);
    expect(nested).toEqual([]);
  });
});
