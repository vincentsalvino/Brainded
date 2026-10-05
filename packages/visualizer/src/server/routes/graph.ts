import type { ServerResponse } from "node:http";
import type { VisualizerQueryService } from "../query-service.js";
import { sendJson } from "../http-utils.js";

export async function handleMemoryGraph(
  res: ServerResponse,
  queryService: VisualizerQueryService,
  minSimilarity: number | undefined,
): Promise<void> {
  sendJson(res, 200, await queryService.getMemoryGraph(minSimilarity !== undefined ? { minSimilarity } : {}));
}
