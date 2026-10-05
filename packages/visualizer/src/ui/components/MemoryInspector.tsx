import { api } from "../api-client";
import { useFetch } from "../use-fetch";
import { EmptyState } from "./EmptyState";
import { SkeletonLines } from "./Skeleton";
import type { GraphMemoryNode, ContextDetailResponse } from "../../shared/api-types";

interface MemoryInspectorProps {
  id: string;
  nodesById: Map<string, GraphMemoryNode>;
  onClose: () => void;
  onSelectNeighbor: (id: string) => void;
  /** Set only while a ContextEvent is selected (trace mode) -- adds an "In This Context" section. */
  contextTrace?: ContextDetailResponse | null;
}

export function MemoryInspector({ id, nodesById, onClose, onSelectNeighbor, contextTrace = null }: MemoryInspectorProps) {
  const { data, error, loading } = useFetch(() => api.getMemoryDetail(id), [id]);
  const membership = contextTrace?.context.memories.find((m) => m.memoryId === id);
  const contextFeedback = contextTrace?.feedback.filter((f) => f.memoryId === id) ?? [];

  return (
    <aside className="panel inspector">
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Memory Inspector</span>
        <button type="button" onClick={onClose} aria-label="Close inspector">
          ×
        </button>
      </div>

      {loading && (
        <div className="panel-body">
          <span className="sr-only" role="status">
            Loading memory…
          </span>
          <SkeletonLines count={8} />
        </div>
      )}
      {error && <EmptyState message={`failed to load memory: ${error.message}`} tone="error" />}
      {data && (
        <div className="panel-body">
          <p>{data.memory.content}</p>

          <dl className="mono">
            <dt>id</dt>
            <dd>{data.memory.id}</dd>
            <dt>type</dt>
            <dd>{data.memory.type}</dd>
            <dt>scope</dt>
            <dd>
              {data.memory.scope.kind}
              {data.memory.scope.id ? `:${data.memory.scope.id}` : ""}
            </dd>
            <dt>domain</dt>
            <dd>{data.memory.domain ?? "—"}</dd>
            <dt>status</dt>
            <dd>{data.memory.status}</dd>
            <dt>confidence</dt>
            <dd>{data.memory.confidence.toFixed(2)}</dd>
            <dt>created</dt>
            <dd>{data.memory.createdAt}</dd>
            <dt>updated</dt>
            <dd>{data.memory.updatedAt}</dd>
          </dl>

          {data.memory.tags.length > 0 && (
            <p>
              {data.memory.tags.map((tag) => (
                <span key={tag} className="badge included" style={{ marginRight: 4 }}>
                  {tag}
                </span>
              ))}
            </p>
          )}

          {data.memory.supersedes && (
            <p>supersedes: {nodesById.get(data.memory.supersedes)?.contentPreview ?? data.memory.supersedes}</p>
          )}
          {data.supersededBy && <p>superseded by: {nodesById.get(data.supersededBy)?.contentPreview ?? data.supersededBy}</p>}

          {contextTrace && (
            <>
              <h3 className="section-title">In This Context</h3>
              <p className="meta mono">
                task {contextTrace.context.taskId ?? "(none)"} · {contextTrace.context.timestamp}
              </p>
              {membership ? (
                <p>
                  <span className={`badge ${membership.included ? "included" : "omitted"}`}>
                    {membership.included ? "included" : "omitted"}
                  </span>{" "}
                  rank {membership.rank ?? "-"} · {membership.tokenCount ?? "-"} tok
                </p>
              ) : (
                <EmptyState message="Not part of this context's candidate set." />
              )}
              {contextFeedback.length > 0 && (
                <p>
                  feedback in this context:{" "}
                  {contextFeedback.map((f) => (f.useful === true ? "useful" : f.useful === false ? "not useful" : "no signal")).join(", ")}
                </p>
              )}
              {contextTrace.outcomes.length > 0 && (
                <p>outcome: {contextTrace.outcomes.map((o) => o.outcome).join(", ")}</p>
              )}
            </>
          )}

          <h3 className="section-title">Semantic Neighbors</h3>
          {data.neighbors.length === 0 ? (
            <EmptyState message="No related memories above the visualization threshold." />
          ) : (
            <div className="row-list">
              {data.neighbors.map((pair) => {
                const neighborId = pair.a === id ? pair.b : pair.a;
                const neighbor = nodesById.get(neighborId);
                return (
                  <div key={neighborId} className="row-item" onClick={() => onSelectNeighbor(neighborId)}>
                    <span>{neighbor?.contentPreview ?? neighborId}</span>
                    <span className="meta mono">similarity {pair.similarity.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <h3 className="section-title">Delivery &amp; Feedback</h3>
          <p>
            delivered {data.deliveryCount} time{data.deliveryCount === 1 ? "" : "s"} · useful {data.feedback.useful} · not
            useful {data.feedback.notUseful} · other {data.feedback.other}
          </p>

          <h3 className="section-title">Performance (experimental)</h3>
          {data.performance === null ? (
            <EmptyState message="No usefulness evidence yet (cold start)." />
          ) : (
            <div>
              <p className="meta">
                usefulnessSignal and evidenceMass are DERIVED / EXPERIMENTAL -- not the same as confidence above, never merged with it.
              </p>
              <dl className="mono">
                <dt>usefulnessSignal</dt>
                <dd>{data.performance.usefulnessSignal.toFixed(3)}</dd>
                <dt>evidenceMass</dt>
                <dd>{data.performance.evidenceMass.toFixed(2)}</dd>
                <dt>usefulCount</dt>
                <dd>{data.performance.usefulCount}</dd>
                <dt>notUsefulCount</dt>
                <dd>{data.performance.notUsefulCount}</dd>
                <dt>redundantReasonCount</dt>
                <dd>{data.performance.redundantReasonCount}</dd>
                <dt>incorrectReasonCount</dt>
                <dd>{data.performance.incorrectReasonCount}</dd>
              </dl>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
