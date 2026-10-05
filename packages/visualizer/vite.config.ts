import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVisualizerBrain } from "./src/server/bootstrap.js";
import { createApiHandler } from "./src/server/router.js";

// This file's own location (packages/visualizer/), not process.cwd() -- `npm run
// dev --workspace=@brain/visualizer` runs with cwd already inside the package, so
// a bare "./data/brain.db" would resolve under packages/visualizer/data instead of
// the repo root's real data/brain.db. Same reasoning as db.ts's own migrations-dir
// resolution.
const packageRoot = dirname(fileURLToPath(import.meta.url));
const defaultDbPath = join(packageRoot, "..", "..", "data", "brain.db");

/**
 * Mounts the same ApiHandler production uses (server.ts) into Vite's dev
 * middleware -- at the ROOT, not an "/api" mount point. Connect's
 * `use(path, fn)` strips the mount prefix before `fn` sees the request, which
 * would make the dev path diverge from production (which sees the full
 * "/api/..." path) for no reason. Gating on the prefix inside the handler
 * instead keeps dev and prod running byte-identical routing code.
 */
function brainApiPlugin(): Plugin {
  return {
    name: "brain-visualizer-api",
    configureServer(server) {
      // vitest spins up its own internal Vite server to process this config, even
      // though UI tests never issue a real fetch (they mock api-client against
      // fixtures) -- opening a real readonly connection here would make `vitest
      // run` depend on a live data/brain.db existing, which fixture-based UI
      // tests must never require.
      if (process.env.VITEST) return;

      const dbPath = process.env.BRAIN_DB_PATH ?? defaultDbPath;
      const brain = createVisualizerBrain(dbPath);
      const handleApi = createApiHandler(brain.queryService);

      server.httpServer?.once("close", () => brain.close());
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith("/api/")) return next();
        handleApi(req, res).catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), brainApiPlugin()],
  build: {
    outDir: "dist/ui",
  },
  test: {
    environment: "jsdom",
    include: ["src/ui/**/*.test.{ts,tsx}"],
    globals: false,
    setupFiles: ["./src/ui/vitest-setup.ts"],
  },
});
