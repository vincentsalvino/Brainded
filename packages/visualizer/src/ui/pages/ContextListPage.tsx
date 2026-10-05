import { api } from "../api-client";
import { useFetch } from "../use-fetch";
import { EmptyState } from "../components/EmptyState";
import { SkeletonLines } from "../components/Skeleton";

interface ContextListPageProps {
  onSelect: (id: string) => void;
}

export function ContextListPage({ onSelect }: ContextListPageProps) {
  const { data, error } = useFetch(api.listContexts, []);

  if (error) return <EmptyState message={`failed to load contexts: ${error.message}`} tone="error" />;

  return (
    <div>
      {!data && (
        <span className="sr-only" role="status">
          Loading context deliveries…
        </span>
      )}

      <h2 className="section-title">Context Deliveries</h2>
      <div className="panel">
        {!data ? (
          <div className="panel-body">
            <SkeletonLines count={6} />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState message="No context deliveries recorded yet. brain_context hasn't been called against this database." />
        ) : (
          <div className="row-list">
            {data.items.map((ctx) => (
              <div key={ctx.id} className="row-item" onClick={() => onSelect(ctx.id)}>
                <span className="id">{ctx.id.slice(0, 8)}</span>
                <span>{ctx.taskId ?? "(no task id)"}</span>
                <span className="meta mono">
                  {ctx.tokenCount} tok / {ctx.includedMemoryIds.length} incl / {ctx.omittedMemoryIds.length} omit
                </span>
                <span className="meta mono">{ctx.timestamp}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
