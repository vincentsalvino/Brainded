import type { OverviewResponse, ContextListResponse, ContextDetailResponse, MemoryGraphResponse, MemoryDetailResponse } from "../shared/api-types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getOverview: (): Promise<OverviewResponse> => getJson("/api/overview"),
  listContexts: (): Promise<ContextListResponse> => getJson("/api/contexts"),
  getContextDetail: (id: string): Promise<ContextDetailResponse> => getJson(`/api/contexts/${encodeURIComponent(id)}`),
  getMemoryGraph: (minSimilarity?: number): Promise<MemoryGraphResponse> =>
    getJson(`/api/graph/memories${minSimilarity !== undefined ? `?minSimilarity=${minSimilarity}` : ""}`),
  getMemoryDetail: (id: string): Promise<MemoryDetailResponse> => getJson(`/api/memories/${encodeURIComponent(id)}`),
};
