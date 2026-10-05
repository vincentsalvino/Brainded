import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createVisualizerBrain } from "./bootstrap.js";
import { createApiHandler } from "./router.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

export async function main(): Promise<void> {
  const dbPath = process.env.BRAIN_DB_PATH ?? process.argv[2] ?? "./data/brain.db";
  const brain = createVisualizerBrain(dbPath);
  const handleApi = createApiHandler(brain.queryService);
  const uiRoot = resolve(__dirname, "..", "ui"); // dist/server/server.js -> dist/ui

  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/")) {
      void handleApi(req, res);
      return;
    }

    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    // Resolve against uiRoot and reject anything that escapes it (e.g. "/../../etc/passwd").
    const requested = resolve(uiRoot, "." + pathname);
    const safePath = requested === uiRoot || requested.startsWith(uiRoot + sep) ? requested : uiRoot;
    const filePath = safePath === uiRoot || safePath.endsWith(sep) ? join(uiRoot, "index.html") : safePath;

    readFile(filePath)
      .then((body) => {
        res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream" });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404);
        res.end("not found");
      });
  });

  const port = Number(process.env.PORT ?? 4173);
  server.listen(port, () => console.log(`brain-visualizer listening on http://localhost:${port}`));
}

if (process.argv[1]?.endsWith("server.js")) {
  main().catch((error: unknown) => {
    console.error("brain-visualizer failed to start:", error);
    process.exit(1);
  });
}
