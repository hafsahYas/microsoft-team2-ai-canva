import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeployError,
  MAX_DEPLOY_FILES,
  contentTypeFor,
  deploySite,
  describeDeployError,
  isSafeSitePath,
  validateDeployFiles,
} from "./herenow.js";

/**
 * The here.now deploy path. Everything except `deploySite` is pure; that one runs
 * against a stubbed `fetch`, so no test touches the network or creates a Site.
 */

describe("isSafeSitePath", () => {
  it("accepts site-relative paths", () => {
    for (const path of ["index.html", "assets/app.js", "docs/readme.md", "a/b/c/d.png"]) {
      expect(isSafeSitePath(path), path).toBe(true);
    }
  });

  it("refuses traversal, absolute paths, directories and reserved manifests", () => {
    for (const path of [
      "", "/index.html", "~/index.html", "../index.html", "a/../../b", "a\\b.html",
      "assets/", "C:\\x.html", "a\u0000b", ".gitignore", "x".repeat(201),
      // .herenow/ paths are here.now configuration, never site content.
      ".herenow/proxy.json", ".herenow/data.json",
    ]) {
      expect(isSafeSitePath(path), path).toBe(false);
    }
    expect(isSafeSitePath(undefined)).toBe(false);
  });
});

describe("contentTypeFor", () => {
  it("guesses sensible types", () => {
    expect(contentTypeFor("index.html")).toContain("text/html");
    expect(contentTypeFor("app.jsx")).toContain("javascript");
    expect(contentTypeFor("styles.css")).toContain("text/css");
    expect(contentTypeFor("CHANGES.md")).toContain("markdown");
    expect(contentTypeFor("logo.png")).toBe("image/png");
    expect(contentTypeFor("weird.xyz")).toBe("application/octet-stream");
  });
});

describe("validateDeployFiles", () => {
  it("normalizes paths, fills content types and measures bytes", () => {
    const { files, bytes } = validateDeployFiles([
      { path: "./index.html", content: "<h1>hi</h1>" },
      { path: "a//b.js", content: "const x = 1;" },
    ]);
    expect(files.map((f) => f.path)).toEqual(["index.html", "a/b.js"]);
    expect(files[0].contentType).toContain("text/html");
    expect(bytes).toBe(Buffer.byteLength("<h1>hi</h1>") + Buffer.byteLength("const x = 1;"));
  });

  it("refuses an empty set, unsafe paths, duplicates and oversized files", () => {
    expect(() => validateDeployFiles([])).toThrow(/nothing to publish/i);
    expect(() => validateDeployFiles([{ path: "../escape.html", content: "x" }])).toThrow(/site-relative/);
    expect(() => validateDeployFiles([{ path: ".herenow/proxy.json", content: "{}" }])).toThrow(/site-relative/);
    expect(() =>
      validateDeployFiles([{ path: "a.html", content: "x" }, { path: "a.html", content: "y" }])
    ).toThrow(/Duplicate path/);
    expect(() =>
      validateDeployFiles([{ path: "huge.html", content: "x".repeat(9 * 1024 * 1024) }])
    ).toThrow(/per-file limit/);
    expect(() =>
      validateDeployFiles(Array.from({ length: MAX_DEPLOY_FILES + 1 }, (_, i) => ({ path: `f${i}.txt`, content: "x" })))
    ).toThrow(/Too many files/);
  });
});

describe("describeDeployError", () => {
  it("turns here.now's failures into actionable messages", () => {
    const conflict = describeDeployError(409, {
      code: "version_conflict",
      details: { currentVersionId: "v9", currentVersionSource: "editor" },
    });
    expect(conflict).toMatch(/changed since it was deployed/);
    expect(conflict).toMatch(/v9/);
    expect(conflict).toMatch(/editor/);
    expect(describeDeployError(409, { code: "version_conflict" })).toMatch(/Redeploy to replace it/);
    expect(describeDeployError(401, {})).toMatch(/HERENOW_API_KEY/);
    expect(describeDeployError(403, { message: "nope" })).toMatch(/nope/);
    expect(describeDeployError(429, {})).toMatch(/rate-limited/);
    expect(describeDeployError(400, { message: "bad files" })).toMatch(/bad files/);
    expect(describeDeployError(503, {})).toMatch(/server error/);
  });
});

// === deploySite against a stubbed here.now ===

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

/** Stubs the three-step flow and records every call. */
function stubHereNow(handlers: {
  create?: (body: any, call: Call) => { status?: number; body: unknown };
  upload?: (call: Call) => { status?: number };
  finalize?: (body: any) => { status?: number; body: unknown };
}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    // Only API bodies are JSON — an upload PUTs the file's raw bytes.
    let body: unknown;
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = String(init.body);
      }
    }
    const call: Call = { url, method, body };
    if (method === "PUT" && url.includes("storage")) {
      calls.push(call);
      const { status = 200 } = handlers.upload ? handlers.upload(call) : {};
      return { ok: status < 300, status, json: async () => ({}) } as unknown as Response;
    }
    if (url.endsWith("/finalize")) {
      calls.push(call);
      const { status = 200, body: res } = handlers.finalize ? handlers.finalize(body) : { body: {} };
      return { ok: status < 300, status, json: async () => res } as unknown as Response;
    }
    calls.push(call);
    const { status = 200, body: res } = handlers.create
      ? handlers.create(body, call)
      : { body: {} };
    return { ok: status < 300, status, json: async () => res } as unknown as Response;
  });
  return calls;
}

const CREATED = {
  slug: "bright-canvas-a7k2",
  siteUrl: "https://bright-canvas-a7k2.here.now/",
  anonymous: true,
  expiresAt: "2026-02-18T01:00:00.000Z",
  claimToken: "4fQ9tK2mXb7cW1pZ",
  claimUrl: "https://here.now/c/4fQ9tK2mXb7cW1pZ",
  upload: {
    versionId: "ver_1",
    finalizeUrl: "https://here.now/api/v1/publish/bright-canvas-a7k2/finalize",
    uploads: [{ path: "index.html", method: "PUT", url: "https://bucket.r2.cloudflarestorage.com/index.html", headers: { "x-amz-acl": "private" } }],
    skipped: [],
  },
};

const FINALIZED = {
  success: true,
  slug: "bright-canvas-a7k2",
  siteUrl: "https://bright-canvas-a7k2.here.now/",
  currentVersionId: "ver_1",
  unchanged: false,
};

describe("deploySite", () => {
  it("runs create → upload → finalize and reports the live URL", async () => {
    const calls = stubHereNow({
      create: () => ({ body: CREATED }),
      finalize: () => ({ body: FINALIZED }),
    });

    const result = await deploySite({
      files: [{ path: "index.html", content: "<h1>hi</h1>" }],
      displayName: "AI Canva — Code Box",
    });

    expect(result.siteUrl).toBe("https://bright-canvas-a7k2.here.now/");
    expect(result.slug).toBe("bright-canvas-a7k2");
    expect(result.versionId).toBe("ver_1");
    expect(result.anonymous).toBe(true);
    expect(result.claimUrl).toBe("https://here.now/c/4fQ9tK2mXb7cW1pZ");
    expect(result.claimToken).toBe("4fQ9tK2mXb7cW1pZ");
    expect(result.fileCount).toBe(1);
    expect(result.unchanged).toBe(false);

    // Step order and shape.
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /api/v1/publish",
      "PUT /index.html",
      "POST /api/v1/publish/bright-canvas-a7k2/finalize",
    ]);
    expect(calls[0].body).toMatchObject({
      files: [{ path: "index.html", size: Buffer.byteLength("<h1>hi</h1>"), contentType: "text/html; charset=utf-8" }],
      displayName: "AI Canva — Code Box",
    });
    expect(calls[2].body).toEqual({ versionId: "ver_1" });
  });

  it("updates an existing anonymous site with its claim token and base version", async () => {
    const calls = stubHereNow({ create: () => ({ body: CREATED }), finalize: () => ({ body: FINALIZED }) });
    await deploySite({
      files: [{ path: "index.html", content: "<h1>v2</h1>" }],
      slug: "bright-canvas-a7k2",
      claimToken: "4fQ9tK2mXb7cW1pZ",
      baseVersionId: "ver_1",
    });
    expect(calls[0].method).toBe("PUT");
    expect(new URL(calls[0].url).pathname).toBe("/api/v1/publish/bright-canvas-a7k2");
    expect(calls[0].body).toMatchObject({ claimToken: "4fQ9tK2mXb7cW1pZ", baseVersionId: "ver_1" });
    // A create-only field must never be sent on an update.
    expect(calls[0].body).not.toHaveProperty("ttlSeconds");
  });

  it("relays a stale-base conflict instead of clobbering the live site", async () => {
    stubHereNow({
      create: () => ({
        status: 409,
        body: { code: "version_conflict", message: "conflict", details: { currentVersionId: "ver_9", currentVersionSource: "editor" } },
      }),
    });
    await expect(
      deploySite({ files: [{ path: "index.html", content: "x" }], slug: "s", claimToken: "t", baseVersionId: "ver_1" })
    ).rejects.toThrow(/changed since it was deployed/);
  });

  it("fails loudly when an upload is rejected (the site is not live)", async () => {
    stubHereNow({
      create: () => ({ body: CREATED }),
      upload: () => ({ status: 403 }),
      finalize: () => ({ body: FINALIZED }),
    });
    await expect(deploySite({ files: [{ path: "index.html", content: "x" }] })).rejects.toThrow(DeployError);
    await expect(deploySite({ files: [{ path: "index.html", content: "x" }] })).rejects.toThrow(/Uploading index\.html/);
  });

  it("reports a finalize that did not succeed", async () => {
    stubHereNow({ create: () => ({ body: CREATED }), finalize: () => ({ status: 500, body: { message: "boom" } }) });
    await expect(deploySite({ files: [{ path: "index.html", content: "x" }] })).rejects.toThrow(/finalize/i);
  });

  it("carries finalize warnings (e.g. an invalid manifest) to the caller", async () => {
    stubHereNow({
      create: () => ({ body: { ...CREATED, warning: "anonymous site expires in 24 hours" } }),
      finalize: () => ({ body: { ...FINALIZED, warnings: [".herenow/proxy.json is invalid JSON — proxy routes disabled"] } }),
    });
    const result = await deploySite({ files: [{ path: "index.html", content: "x" }] });
    expect(result.warnings.join(" | ")).toMatch(/proxy.json is invalid/);
    expect(result.warnings.join(" | ")).toMatch(/expires in 24 hours/);
  });

  it("sends the API key when one is configured, and none when it is not", async () => {
    const seen: (string | undefined)[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.authorization);
      if (url.endsWith("/finalize")) {
        return { ok: true, status: 200, json: async () => FINALIZED } as unknown as Response;
      }
      if (url.includes("storage")) return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => CREATED } as unknown as Response;
    });
    await deploySite({ files: [{ path: "index.html", content: "x" }], apiKey: "hnk_secret" });
    await deploySite({ files: [{ path: "index.html", content: "x" }] });
    expect(seen[0]).toBe("Bearer hnk_secret");
    expect(seen[seen.length - 1]).toBeUndefined();
  });

  it("validates before making any request", async () => {
    const calls = stubHereNow({ create: () => ({ body: CREATED }), finalize: () => ({ body: FINALIZED }) });
    await expect(deploySite({ files: [] })).rejects.toThrow(/nothing to publish/i);
    await expect(deploySite({ files: [{ path: "/abs.html", content: "x" }] })).rejects.toThrow(/site-relative/);
    expect(calls).toEqual([]);
  });

  it("treats a permanent (authenticated) site as non-anonymous", async () => {
    stubHereNow({
      create: () => ({ body: { slug: "s", siteUrl: "https://s.here.now/", anonymous: false, upload: CREATED.upload } }),
      finalize: () => ({ body: FINALIZED }),
    });
    const result = await deploySite({ files: [{ path: "index.html", content: "x" }], apiKey: "k" });
    expect(result.anonymous).toBe(false);
    expect(result.claimUrl).toBe("");
    expect(result.expiresAt).toBe("");
  });
});
