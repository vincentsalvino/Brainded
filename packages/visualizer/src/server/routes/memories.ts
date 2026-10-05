import type { ServerResponse } from "node:http";
import type { VisualizerQueryService } from "../query-service.js";
import { sendJson, notFound } from "../http-utils.js";

export async function handleMemoryDetail(res: ServerResponse, queryService: VisualizerQueryService, id: string): Promise<void> {
  const detail = await queryService.getMemoryDetail(id);
  if (!detail) return notFound(res, `memory ${id} not found`);
  sendJson(res, 200, detail);
}
