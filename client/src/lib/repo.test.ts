import { describe, expect, it } from "vitest";
import type { RepoMeta } from "../types.js";
import { buildCodeMapPrompt, findRepoRefInText, parseRepoRef, resolveRepoRef } from "./repo.js";

describe("parseRepoRef", () => {
  it("parses the URL forms people paste", () => {
    expect(parseRepoRef("https://github.com/alexbonti/ai-canva")).toMatchObject({
      owner: "alexbonti", repo: "ai-canva", branch: "", slug: "alexbonti/ai-canva",
    });
    expect(parseRepoRef("http://www.github.com/alexbonti/ai-canva/")).toMatchObject({ slug: "alexbonti/ai-canva" });
    expect(parseRepoRef("github.com/alexbonti/ai-canva")).toMatchObject({ slug: "alexbonti/ai-canva" });
    expect(parseRepoRef("https://github.com/alexbonti/ai-canva.git")).toMatchObject({ repo: "ai-canva" });
    expect(parseRepoRef("git@github.com:alexbonti/ai-canva.git")).toMatchObject({ slug: "alexbonti/ai-canva" });
  });

  it("extracts the branch from tree/blob URLs and fragments", () => {
    expect(parseRepoRef("https://github.com/o/r/tree/release/2.0")?.branch).toBe("release");
    expect(parseRepoRef("https://github.com/o/r#develop")?.branch).toBe("develop");
    expect(parseRepoRef("o/r#develop")?.branch).toBe("develop");
    expect(parseRepoRef("o/r@v1.2.3")?.branch).toBe("v1.2.3");
  });

  it("carries the branch into the URL sent to the backend", () => {
    // Without this the backend would read the default branch instead of the one
    // the user pointed at.
    expect(parseRepoRef("o/r#release-2.0")?.url).toBe("https://github.com/o/r#release-2.0");
    expect(parseRepoRef("https://github.com/o/r/tree/develop")?.url).toBe("https://github.com/o/r#develop");
    expect(parseRepoRef("o/r")?.url).toBe("https://github.com/o/r");
  });

  it("parses the short owner/repo form", () => {
    expect(parseRepoRef("alexbonti/ai-canva")).toMatchObject({ owner: "alexbonti", repo: "ai-canva", branch: "" });
    expect(parseRepoRef("  alexbonti/ai-canva  ")).toMatchObject({ slug: "alexbonti/ai-canva" });
  });

  it("rejects anything that is not a GitHub repository reference", () => {
    expect(parseRepoRef("")).toBeNull();
    expect(parseRepoRef(undefined)).toBeNull();
    expect(parseRepoRef("https://gitlab.com/o/r")).toBeNull();
    expect(parseRepoRef("https://github.com/only-owner")).toBeNull();
    expect(parseRepoRef("not a repo at all")).toBeNull();
    expect(parseRepoRef("owner/re po")).toBeNull();
    expect(parseRepoRef("https://evil.example.com/alexbonti/ai-canva")).toBeNull();
  });
});

describe("findRepoRefInText", () => {
  it("finds a repo link inside prose", () => {
    expect(findRepoRefInText("please map https://github.com/alexbonti/ai-canva before planning")?.slug)
      .toBe("alexbonti/ai-canva");
    expect(findRepoRefInText("Map the repo alexbonti/ai-canva and brief me.")?.slug).toBe("alexbonti/ai-canva");
  });

  it("ignores file paths, ratios and non-GitHub URLs", () => {
    expect(findRepoRefInText("see src/lib/repo.ts and package.json")).toBeNull();
    expect(findRepoRefInText("the ratio is 3/4 of the size")).toBeNull();
    expect(findRepoRefInText("https://gitlab.com/o/r")).toBeNull();
    expect(findRepoRefInText("")).toBeNull();
  });
});

describe("resolveRepoRef", () => {
  it("prefers the URL field, then content, then the prompt, then connected inputs", () => {
    expect(resolveRepoRef({
      repoUrl: "https://github.com/a/one",
      content: "https://github.com/b/two",
      inputs: [{ name: "X", output: "https://github.com/c/three" }],
    })?.slug).toBe("a/one");

    expect(resolveRepoRef({ content: "https://github.com/b/two", prompt: "https://github.com/d/four" })?.slug).toBe("b/two");
    expect(resolveRepoRef({ prompt: "map https://github.com/d/four please" })?.slug).toBe("d/four");
    expect(resolveRepoRef({ inputs: [{ name: "X", output: "https://github.com/c/three" }] })?.slug).toBe("c/three");
    expect(resolveRepoRef({ content: "no repo here", inputs: [{ name: "X", output: "nothing" }] })).toBeNull();
  });

  it("ignores the placeholder example inside the box's stock prompt", () => {
    // The Code Map box's default prompt documents the URL format with
    // `https://github.com/owner/repo` — that must never be read as a repository.
    const stockPrompt = "Turn the repository evidence below into a code map.\nSee https://github.com/owner/repo";
    expect(resolveRepoRef({ prompt: stockPrompt, defaultPrompt: stockPrompt })).toBeNull();
    expect(resolveRepoRef({ prompt: stockPrompt, defaultPrompt: stockPrompt, content: "" })).toBeNull();
    // …but a customised prompt naming a real repo IS used (the Agent box sets one).
    expect(resolveRepoRef({
      prompt: "Map https://github.com/alexbonti/ai-canva and brief me",
      defaultPrompt: stockPrompt,
    })?.slug).toBe("alexbonti/ai-canva");
  });
});

function meta(patch: Partial<RepoMeta> = {}): RepoMeta {
  return {
    repo: "alexbonti/ai-canva", branch: "main", files: 18, treeEntries: 240,
    chars: 41000, truncated: false, fetchedAt: 1700000000000, error: "", notes: [], ...patch,
  };
}

describe("buildCodeMapPrompt", () => {
  it("fills inputs and appends the digest with its provenance", () => {
    const prompt = buildCodeMapPrompt(
      { prompt: "Map the repo:\n{{inputs}}", digest: "## File tree\nsrc/index.ts", meta: meta() },
      [{ name: "Idea Box", output: "Understand this codebase" }]
    );
    expect(prompt).toContain("Understand this codebase");
    expect(prompt).toContain("## Repository digest — alexbonti/ai-canva@main");
    expect(prompt).toContain("Fetched 18 file(s) of 240 in the tree");
    expect(prompt).toContain("src/index.ts");
    expect(prompt).not.toContain("Repository not read");
  });

  it("warns the model when the digest was capped, and lists what was skipped", () => {
    const prompt = buildCodeMapPrompt(
      { prompt: "Map it", digest: "tree", meta: meta({ truncated: true, notes: ["skipped 12 lock/binary files", "node_modules ignored"] }) },
      []
    );
    expect(prompt).toContain("capped by the digest budget");
    expect(prompt).toContain("NOT the whole repository");
    expect(prompt).toContain("- skipped 12 lock/binary files");
    expect(prompt).toContain("- node_modules ignored");
  });

  it("states plainly that the repository was NOT read when a fetch failed", () => {
    const prompt = buildCodeMapPrompt(
      { prompt: "Map it", fetchError: "Repository or branch not found." },
      [{ name: "Code", output: "function main() {}" }]
    );
    expect(prompt).toContain("## Repository not read");
    expect(prompt).toContain("Repository or branch not found.");
    expect(prompt).toContain("function main() {}");
    expect(prompt).not.toContain("## Repository digest");
  });

  it("handles a digest with no metadata at all", () => {
    const prompt = buildCodeMapPrompt({ prompt: "Map it", digest: "only a tree" }, []);
    expect(prompt).toContain("## Repository digest");
    expect(prompt).toContain("only a tree");
  });

  it("never silently drops connected code when the template lacks {{inputs}}", () => {
    const prompt = buildCodeMapPrompt(
      { prompt: "Map this codebase.", digest: "tree" },
      [{ name: "Code Box", output: "export function main() { return 1; }" }]
    );
    expect(prompt).toContain("## Connected context");
    expect(prompt).toContain("Code Box:");
    expect(prompt).toContain("export function main()");
  });

  it("does not duplicate inputs the template already referenced", () => {
    const prompt = buildCodeMapPrompt(
      { prompt: "Map:\n{{inputs}}", digest: "tree" },
      [{ name: "Code Box", output: "export function main() { return 1; }" }]
    );
    expect(prompt).not.toContain("## Connected context");
    expect(prompt.match(/export function main\(\)/g)).toHaveLength(1);
  });
});
