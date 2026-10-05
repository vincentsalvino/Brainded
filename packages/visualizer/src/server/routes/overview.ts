import type { ServerResponse } from "node:http";
import type { VisualizerQueryService } from "../query-service.js";
import { sendJson } from "../http-utils.js";

export async function handleOverview(res: ServerResponse, queryService: VisualizerQueryService): Promise<void> {
  sendJson(res, 200, await queryService.getOverview());
}
