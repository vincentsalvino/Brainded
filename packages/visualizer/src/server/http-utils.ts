import type { ServerResponse } from "node:http";

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function notFound(res: ServerResponse, message: string): void {
  sendJson(res, 404, { error: message });
}

export function internalError(res: ServerResponse, error: unknown): void {
  console.error("visualizer API error:", error);
  sendJson(res, 500, { error: "internal error" });
}
