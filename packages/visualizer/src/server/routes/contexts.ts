import type { ServerResponse } from "node:http";
import type { VisualizerQueryService } from "../query-service.js";
import { sendJson, notFound } from "../http-utils.js";

export async function handleListContexts(res: ServerResponse, queryService: VisualizerQueryService): Promise<void> {
  sendJson(res, 200, await queryService.listContexts());
}

export async function handleContextDetail(res: ServerResponse, queryService: VisualizerQueryService, id: string): Promise<void> {
  const detail = await queryService.getContextDetail(id);
  if (!detail) return notFound(res, `context ${id} not found`);
  sendJson(res, 200, detail);
}
