import { describe, expect, it } from "vitest";
import type { BoxData, FileChange } from "../types.js";
import {
  MAX_DEPLOY_FILE_BYTES,
  canDeployCode,
  deployBlockedReason,
  deployBytes,
  deployFilesFor,
  deploySiteTitle,
  hasDeployableCode,
  validateDeploySet,
} from "./deploy.js";

function data(patch: Partial<BoxData> = {}): BoxData {
  return { content: "", prompt: "", systemPrompt: "", output: "", status: "idle", ...patch } as BoxData;
}

const CODE = "function App() {\n  return <h1>Hi</h1>;\n}\nReactDOM.createRoot(document.getElementById('root')).render(<App />);";

describe("canDeployCode / hasDeployableCode / deployBlockedReason", () => {
  it("covers the code-bearing boxes only", () => {
    for (const type of ["code", "ui", "stitch", "codeedit"]) expect(canDeployCode(type), type).toBe(true);
    for (const type of ["idea", "research", "prd", "slides", "cartoon", "note", "checklist", "agent"]) {
      expect(canDeployCode(type), type).toBe(false);
    }
  });

  it("needs code (or a change set) before anything can be published", () => {
    expect(hasDeployableCode("code", data({ code: CODE }))).toBe(true);
    expect(hasDeployableCode("code", data())).toBe(false);
    expect(hasDeployableCode("stitch", data({ code: "<h1>ui</h1>" }))).toBe(true);
    expect(hasDeployableCode("codeedit", data({ changeSet: [] }))).toBe(false);
    expect(hasDeployableCode("codeedit", data({ changeSet: [{ path: "a.ts", operation: "update", content: "x", original: "y", added: 1, removed: 1, reason: "" }] }))).toBe(true);

    expect(deployBlockedReason("idea", data())).toMatch(/no code/);
    expect(deployBlockedReason("code", data())).toMatch(/Generate code first/);
    expect(deployBlockedReason("codeedit", data({ changeSet: [] }))).toMatch(/no change set/);
    expect(deployBlockedReason("code", data({ code: CODE }))).toBe("");
  });
});

describe("deployFilesFor", () => {
  it("publishes a Code box as a self-contained index.html plus its source", () => {
    const files = deployFilesFor("code", data({ code: CODE }));
    expect(files.map((f) => f.path)).toEqual(["index.html", "App.jsx"]);
    expect(files[0].content).toContain("<!DOCTYPE html>");
    expect(files[0].content).toContain("ReactDOM.createRoot");
    expect(files[1].content).toBe(CODE + "\n");
  });

  it("wraps a UI Design box with Tailwind, and publishes Stitch HTML as-is", () => {
    const ui = deployFilesFor("ui", data({ code: "const App = () => <div className=\"p-4\" />;" }));
    expect(ui[0].content).toContain("cdn.tailwindcss.com");

    const stitch = deployFilesFor("stitch", data({ code: "<html><body>screen</body></html>" }));
    expect(stitch).toEqual([{ path: "index.html", content: "<html><body>screen</body></html>" }]);
  });

  it("publishes an empty set when there is no code", () => {
    expect(deployFilesFor("code", data())).toEqual([]);
    expect(deployFilesFor("code", data({ code: "   " }))).toEqual([]);
    expect(deployFilesFor("idea", data({ code: CODE }))).toEqual([]);
    expect(deployFilesFor("code", undefined)).toEqual([]);
  });

  it("publishes a Code Edit change set at its repository paths, plus the diff document", () => {
    const changeSet: FileChange[] = [
      { path: "./src/app.ts", operation: "update", content: "export const x = 2;\n", original: "export const x = 1;\n", added: 1, removed: 1, reason: "bump" },
      { path: "index.html", operation: "create", content: "<h1>site</h1>\n", original: "", added: 1, removed: 0, reason: "new page" },
      { path: "src/gone.ts", operation: "delete", content: "", original: "bye\n", added: 0, removed: 1, reason: "dead" },
    ];
    const files = deployFilesFor("codeedit", data({ changeSet }));
    // The leading ./ is normalized; a deleted file is not published.
    expect(files.map((f) => f.path)).toEqual(["src/app.ts", "index.html", "CHANGES.md"]);
    expect(files[0].content).toBe("export const x = 2;\n");
    expect(files[2].content).toContain("# Change set");
    expect(files[2].content).toContain("```diff");
  });
});

describe("validateDeploySet / deployBytes", () => {
  it("measures utf-8 bytes and accepts a normal set", () => {
    expect(deployBytes([{ path: "a", content: "abc" }])).toBe(3);
    expect(deployBytes([{ path: "a", content: "héllo" }])).toBe(6); // é is two bytes
    expect(validateDeploySet([{ path: "index.html", content: "<h1>ok</h1>" }])).toBe("");
  });

  it("refuses an empty set and an oversized file", () => {
    expect(validateDeploySet([])).toMatch(/nothing to publish/);
    const huge = "x".repeat(MAX_DEPLOY_FILE_BYTES + 1);
    expect(validateDeploySet([{ path: "huge.bin", content: huge }])).toMatch(/per-file limit/);
  });
});

describe("deploySiteTitle", () => {
  it("names the site after the box and describes where it came from", () => {
    const title = deploySiteTitle("code", data({ content: "a counter with   big buttons" }), "Counter Box", "Demo board");
    expect(title.displayName).toBe("Counter Box");
    expect(title.displayDescription).toContain("AI Canva (Code box)");
    expect(title.displayDescription).toContain("Demo board");
    expect(title.displayDescription).toContain("a counter with big buttons"); // whitespace collapsed
    expect(deploySiteTitle("ui", data(), "", "").displayName).toBe("UI Design Box");
    expect(deploySiteTitle("codeedit", data(), "Edits", "b").displayDescription).toContain("Code Edit");
  });

  it("caps the fields to here.now's limits", () => {
    const long = "x".repeat(200);
    const title = deploySiteTitle("code", data({ content: long }), long, long);
    expect(title.displayName.length).toBeLessThanOrEqual(80);
    expect(title.displayDescription.length).toBeLessThanOrEqual(280);
  });
});
