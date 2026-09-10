import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * Reads the server port from .server-port file.
 * Only called during dev (vite serve), not during build.
 */
function getServerPort(): number {
  const portFile = path.resolve(__dirname, "..", ".server-port");
  const maxAttempts = 100;
  const fallbackPort = 3001;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (fs.existsSync(portFile)) {
        const raw = fs.readFileSync(portFile, "utf-8").trim();
        const port = parseInt(raw, 10);
        if (!isNaN(port) && port > 0) return port;
      }
    } catch {}
    execSync("sleep 0.1");
  }
  console.warn(`[vite] Could not detect server port — falling back to ${fallbackPort}`);
  return fallbackPort;
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    ...(command === "serve"
      ? { proxy: { "/api": `http://localhost:${getServerPort()}` } }
      : {}),
  },
  build: {
    rollupOptions: {
      output: {
        // Split the large vendors into stable, separately-cached chunks so the
        // initial board UI (react + xyflow) is served before firebase/markdown
        // load. Also avoids a single ~1.3MB main chunk.
        manualChunks: {
          // React itself is not chunked — it is imported by the entry point and
          // must be present at first paint, so Rollup inlines it (an explicit
          // chunk would come out empty). Splitting the heavy SDKs below is what
          // actually shrinks the initial parse/render path.
          reactflow: ["@xyflow/react", "zustand"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage"],
          markdown: ["react-markdown"],
        },
      },
    },
  },
}));