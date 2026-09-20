import { describe, expect, it } from "vitest";
import { CODE_CHANGE_PROMPT } from "../types.js";
import {
  buildCodeChangePrompt,
  extractCode,
  isCompletePrototype,
  wrapCodeInHtml,
  wrapUIInHtml,
} from "./code.js";

describe("extractCode", () => {
  it("returns trimmed code with no markdown fence", () => {
    expect(extractCode("  const x = 1;  ")).toBe("const x = 1;");
  });

  it("strips a ```jsx ... ``` block", () => {
    const raw = "```jsx\nfunction App(){return null;}\n```";
    expect(extractCode(raw)).toBe("function App(){return null;}");
  });

  it("strips a plain ``` ... ``` block", () => {
    const raw = "```\nfunction App(){}\n```";
    expect(extractCode(raw)).toBe("function App(){}");
  });

  it("keeps surrounding prose that is not fenced", () => {
    const raw = "Here is the code:\nfunction App(){}";
    expect(extractCode(raw)).toBe(raw.trim());
  });
});

describe("wrapCodeInHtml", () => {
  it("produces an HTML document containing the code", () => {
    const html = wrapCodeInHtml("function App(){}");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('type="text/babel"');
    expect(html).toContain("function App(){}");
  });
});

describe("wrapUIInHtml", () => {
  it("includes Tailwind CDN and Inter font for UI previews", () => {
    const html = wrapUIInHtml("const x = 1;");
    expect(html).toContain("https://cdn.tailwindcss.com");
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("const x = 1;");
  });

describe("isCompletePrototype", () => {
  const good = "function App() { return null; }\nReactDOM.createRoot(document.getElementById('root')).render(<App />);";

  it("accepts a mountable component", () => {
    expect(isCompletePrototype(good)).toBe(true);
    expect(isCompletePrototype("const App = () => null;\nReactDOM.render(<App />, root);")).toBe(true);
    expect(isCompletePrototype("class App extends React.Component {}\nReactDOM.createRoot(root).render(<App />);")).toBe(true);
  });

  it("rejects truncated or non-prototype replies", () => {
    expect(isCompletePrototype("")).toBe(false);
    expect(isCompletePrototype("   ")).toBe(false);
    expect(isCompletePrototype("function App() { return null; }")).toBe(false); // no mount
    expect(isCompletePrototype("ReactDOM.createRoot(root).render(<Other />);")).toBe(false); // no App
    expect(isCompletePrototype("Here is your component!")).toBe(false);
  });
});

describe("buildCodeChangePrompt", () => {
  const code = "function App() {\n  return <h1>Hi</h1>;\n}\nReactDOM.createRoot(root).render(<App />);";

  it("carries the current code and the request with the no-feature-loss rules", () => {
    const prompt = buildCodeChangePrompt({ code, request: "make the heading dark" });
    expect(prompt).toContain("function App()");
    expect(prompt).toContain("make the heading dark");
    expect(prompt).toContain("Return the COMPLETE file");
    expect(prompt).toContain("no reformatting, no renaming");
    expect(prompt).not.toContain("{{code}}");
    expect(prompt).not.toContain("{{request}}");
  });

  it("appends connected context (e.g. a Review box's findings)", () => {
    const prompt = buildCodeChangePrompt({
      code,
      request: "fix the findings",
      context: [{ name: "5 · Review Box", output: "blocking: no rate limit" }],
    });
    expect(prompt).toContain("Additional context from connected boxes");
    expect(prompt).toContain("5 · Review Box");
    expect(prompt).toContain("no rate limit");
  });

  it("copes with an empty request and an empty context list", () => {
    const prompt = buildCodeChangePrompt({ code, request: "  ", context: [{ name: "x", output: "   " }] });
    expect(prompt).toContain("[no change request given]");
    expect(prompt).not.toContain("Additional context");
  });

  it("uses the shared template by default and honours an override", () => {
    expect(CODE_CHANGE_PROMPT).toContain("{{code}}");
    expect(buildCodeChangePrompt({ code, request: "r" })).toContain("Apply ONLY that change");
    expect(buildCodeChangePrompt({ code, request: "r" }, "custom {{request}}")).toBe("custom r");
  });
});
});
