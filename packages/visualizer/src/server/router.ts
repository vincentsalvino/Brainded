import type { IncomingMessage, ServerResponse } from "node:http";
import type { VisualizerQueryService } from "./query-service.js";
import { handleOverview } from "./routes/overview.js";
import { handleListContexts, handleContextDetail } from "./routes/contexts.js";
import { handleMemoryGraph } from "./routes/graph.js";
import { handleMemoryDetail } from "./routes/memories.js";
import { notFound, internalError } from "./http-utils.js";

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function parseMinSimilarity(url: URL): number | undefined {
  const raw = url.searchParams.get("minSimilarity");
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The read-only API surface: exactly five routes, each calling exactly one
 * queryService method -- see boundaries.test.ts, which enforces that 1:1
 * correspondence mechanically. No arbitrary-SQL endpoint, no query-string
 * passthrough into a store method (minSimilarity is parsed/validated here,
 * not forwarded as raw text).
 */
export function createApiHandler(queryService: VisualizerQueryService): ApiHandler {
  return async function handleApiRequest(req, res) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/api/overview") {
        return await handleOverview(res, queryService);
      }
      if (req.method === "GET" && url.pathname === "/api/contexts") {
        return await handleListContexts(res, queryService);
      }
      if (req.method === "GET" && url.pathname === "/api/graph/memories") {
        return await handleMemoryGraph(res, queryService, parseMinSimilarity(url));
      }
      const contextMatch = /^\/api\/contexts\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && contextMatch?.[1]) {
        return await handleContextDetail(res, queryService, decodeURIComponent(contextMatch[1]));
      }
      const memoryMatch = /^\/api\/memories\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && memoryMatch?.[1]) {
        return await handleMemoryDetail(res, queryService, decodeURIComponent(memoryMatch[1]));
      }

      notFound(res, `no route for ${req.method} ${url.pathname}`);
    } catch (error) {
      internalError(res, error);
    }
  };
}
