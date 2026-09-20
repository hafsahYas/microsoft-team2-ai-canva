import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

/**
 * The local server delegates AI generation to ./ollama, ./fal and ./stitch.
 * We mock those so API tests assert routing/validation/response shaping
 * without making real network calls.
 */
vi.mock("./ollama.js", () => ({
  generateContent: vi.fn(async (systemPrompt: string, userPrompt: string) => ({
    content: `response for: ${userPrompt}`,
    model: "mock-model",
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  })),
}));

vi.mock("./fal.js", () => ({
  generateCartoonImage: vi.fn(async () => "https://img.example/avatar.png"),
}));

vi.mock("./stitch.js", () => ({
  generateStitchUI: vi.fn(async () => ({
    html: "<div>mock ui</div>",
    imageUrl: "https://img.example/ui.png",
  })),
}));

// Silence expected console noise (error paths intentionally log).
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("reports ok with missing keys by default", async () => {
    delete process.env.OLLAMA_API_KEY;
    delete process.env.FAL_KEY;
    delete process.env.STITCH_API_KEY;

    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      ollamaKey: "missing",
      falKey: "missing",
      stitchKey: "missing",
      // The GitHub token is optional — public repositories read without it.
      githubToken: "optional",
      // Without a here.now key, deploys are anonymous 24-hour Sites.
      herenowKey: "anonymous",
    });
  });

  it("reports the GitHub token as configured when it is set", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    try {
      const res = await request(createApp()).get("/api/health");
      expect(res.body.githubToken).toBe("configured");
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });
});

describe("POST /api/generate", () => {
  it("returns 400 when userPrompt is missing", async () => {
    const res = await request(createApp())
      .post("/api/generate")
      .send({ systemPrompt: "sys" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("userPrompt");
  });

  it("returns content + token usage, defaulting the system prompt", async () => {
    const res = await request(createApp())
      .post("/api/generate")
      .send({ userPrompt: "hello" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      content: "response for: hello",
      model: "mock-model",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });
});

describe("POST /api/generate-image", () => {
  it("returns 400 when neither prompt nor imageUrl is provided", async () => {
    const res = await request(createApp()).post("/api/generate-image").send({});
    expect(res.status).toBe(400);
  });

  it("returns an imageUrl on success", async () => {
    const res = await request(createApp())
      .post("/api/generate-image")
      .send({ prompt: "a cartoon" });
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toBe("https://img.example/avatar.png");
  });
});

describe("POST /api/stitch-generate + GET /api/stitch-status/:jobId", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await request(createApp()).post("/api/stitch-generate").send({});
    expect(res.status).toBe(400);
  });

  it("returns a jobId immediately and the job reaches done", async () => {
    const app = createApp();
    const created = await request(app)
      .post("/api/stitch-generate")
      .send({ prompt: "build a screen" });
    expect(created.status).toBe(200);
    expect(created.body.jobId).toBeTruthy();
    expect(created.body.status).toBe("queued");
    const jobId = created.body.jobId as string;

    const { generateStitchUI } = await import("./stitch.js");
    const stitchMock = generateStitchUI as ReturnType<typeof vi.fn>;
    expect(stitchMock).toHaveBeenCalledWith("build a screen");

    // Poll until the background job reports done.
    await vi.waitFor(async () => {
      const res = await request(app).get(`/api/stitch-status/${jobId}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("done");
      expect(res.body.html).toBeDefined();
    });
  });

  it("returns 404 for an unknown job id", async () => {
    const res = await request(createApp()).get("/api/stitch-status/nope");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/stats", () => {
  it("returns 501 locally (production-only feature)", async () => {
    const res = await request(createApp()).get("/api/admin/stats");
    expect(res.status).toBe(501);
  });
});

describe("POST /api/herenow-deploy", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stubs the here.now three-step flow (create → upload → finalize). */
  function stubHereNow() {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      calls.push(`${method} ${new URL(url).pathname}`);
      if (url.includes("storage")) return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      if (url.endsWith("/finalize")) {
        return {
          ok: true, status: 200,
          json: async () => ({ success: true, slug: "bright-canvas-a7k2", siteUrl: "https://bright-canvas-a7k2.here.now/", currentVersionId: "ver_1" }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          slug: "bright-canvas-a7k2",
          siteUrl: "https://bright-canvas-a7k2.here.now/",
          anonymous: true,
          expiresAt: "2026-02-18T01:00:00.000Z",
          claimToken: "4fQ9tK2mXb7cW1pZ",
          claimUrl: "https://here.now/c/4fQ9tK2mXb7cW1pZ",
          upload: {
            versionId: "ver_1",
            finalizeUrl: "https://here.now/api/v1/publish/bright-canvas-a7k2/finalize",
            uploads: [{ path: "index.html", method: "PUT", url: "https://bucket.r2.cloudflarestorage.com/index.html", headers: {} }],
          },
        }),
      } as unknown as Response;
    });
    return calls;
  }

  it("publishes a file set and reports the live URL with its claim URL", async () => {
    const calls = stubHereNow();
    const res = await request(createApp())
      .post("/api/herenow-deploy")
      .send({ files: [{ path: "index.html", content: "<h1>hi</h1>" }], displayName: "Code Box" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, siteUrl: "https://bright-canvas-a7k2.here.now/", anonymous: true });
    expect(res.body.claimUrl).toBe("https://here.now/c/4fQ9tK2mXb7cW1pZ");
    expect(calls).toEqual([
      "POST /api/v1/publish",
      "PUT /index.html",
      "POST /api/v1/publish/bright-canvas-a7k2/finalize",
    ]);
  });

  it("refuses an empty set and reserved .herenow/ paths", async () => {
    stubHereNow();
    const empty = await request(createApp()).post("/api/herenow-deploy").send({ files: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/nothing to publish/i);

    const reserved = await request(createApp())
      .post("/api/herenow-deploy")
      .send({ files: [{ path: ".herenow/proxy.json", content: "{}" }] });
    expect(reserved.status).toBe(400);
    expect(reserved.body.error).toMatch(/site-relative/);

    const traversal = await request(createApp())
      .post("/api/herenow-deploy")
      .send({ files: [{ path: "../escape.html", content: "x" }] });
    expect(traversal.status).toBe(400);
  });
});

describe("POST /api/repo-digest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects anything that is not a GitHub repository (no request proxy)", async () => {
    for (const repoUrl of [undefined, "", "https://gitlab.com/o/r", "https://evil.example.com/o/r", "just words"]) {
      const res = await request(createApp()).post("/api/repo-digest").send({ repoUrl });
      expect(res.status, String(repoUrl)).toBe(400);
      expect(res.body.error).toMatch(/github\.com\/owner\/repo/);
    }
  });

  it("returns a digest built from the tree plus raw file contents", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.endsWith("/repos/alexbonti/ai-canva")) {
        return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) } as unknown as Response;
      }
      if (url.includes("/git/trees/")) {
        return {
          ok: true, status: 200,
          json: async () => ({ tree: [{ path: "src/index.ts", type: "blob", size: 20 }, { path: "README.md", type: "blob", size: 10 }] }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        text: async () => (url.includes("README") ? "# Hi" : "export const a = 1;"),
      } as unknown as Response;
    });

    const res = await request(createApp()).post("/api/repo-digest").send({ repoUrl: "https://github.com/alexbonti/ai-canva" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, repo: "alexbonti/ai-canva", branch: "main", truncated: false });
    expect(res.body.files).toBe(2);
    expect(res.body.digest).toContain("Repository: alexbonti/ai-canva@main");
    expect(res.body.digest).toContain("export const a = 1;");
    expect(urls.some((u) => u.startsWith("https://raw.githubusercontent.com/"))).toBe(true);
  });

  it("maps a GitHub failure onto a 502 with an actionable message", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" }) as unknown as Response);
    const res = await request(createApp()).post("/api/repo-digest").send({ repoUrl: "owner/missing" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/GITHUB_TOKEN/);
  });
});
