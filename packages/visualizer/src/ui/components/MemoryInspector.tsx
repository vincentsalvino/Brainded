import { useState } from "react";
import { api } from "../api-client";
import { useFetch } from "../use-fetch";
import { formatTimestamp, scopeLabel } from "../display-format";
import { MEMORY_TYPE_COLORS } from "../memory-type-colors";
import { EmptyState } from "./EmptyState";
import { SkeletonLines } from "./Skeleton";
import { Icon, type IconName } from "./Icon";
import { InspectorDock } from "./InspectorDock";
import type { GraphMemoryNode, ContextDetailResponse, MemoryDetailResponse } from "../../shared/api-types";

interface MemoryInspectorProps {
  id: string;
  nodesById: Map<string, GraphMemoryNode>;
  onClose: () => void;
  onSelectNeighbor: (id: string) => void;
  contextTrace?: ContextDetailResponse | null;
}

const PREVIEW_LIMIT = 320;

function previewContent(content: string): string {
  if (content.length <= PREVIEW_LIMIT) return content;
  const sample = content.slice(0, PREVIEW_LIMIT);
  const lastBreak = sample.search(/\s+\S*$/);
  return `${(lastBreak > PREVIEW_LIMIT * 0.75 ? sample.slice(0, lastBreak) : sample).trimEnd()}…`;
}

export function MemoryInspector({ id, onClose, ...props }: MemoryInspectorProps) {
  const { data, error, loading } = useFetch(() => api.getMemoryDetail(id), [id]);

  return (
    <InspectorDock>
      <header className="panel-header inspector-header">
        <span className="icon-label"><Icon name="panel" />Memory Inspector</span>
        <button type="button" onClick={onClose} aria-label="Close inspector"><Icon name="close" /></button>
      </header>

      {loading && (
        <div className="panel-body">
          <span className="sr-only" role="status">Loading memory…</span>
          <SkeletonLines count={8} />
        </div>
      )}
      {error && <EmptyState message={`failed to load memory: ${error.message}`} tone="error" />}
      {data?.memory.id === id && <MemoryDetails key={id} data={data} {...props} />}
    </InspectorDock>
  );
}

type InspectorPane = "Content" | "Related" | "Activity" | "Context";
const PANE_ICONS: Record<InspectorPane, IconName> = { Content: "file", Related: "link", Activity: "pulse", Context: "layers" };

function MemoryDetails({ data, nodesById, onSelectNeighbor, contextTrace }: {
  data: MemoryDetailResponse;
  nodesById: Map<string, GraphMemoryNode>;
  onSelectNeighbor: (id: string) => void;
  contextTrace?: ContextDetailResponse | null;
}) {
  const { memory, neighbors, performance } = data;
  const [pane, setPane] = useState<InspectorPane>("Content");
  const [expanded, setExpanded] = useState(false);
  const [relatedType, setRelatedType] = useState("");
  const activePane = pane === "Context" && !contextTrace ? "Content" : pane;
  const panes: InspectorPane[] = contextTrace ? ["Content", "Related", "Activity", "Context"] : ["Content", "Related", "Activity"];
  const preview = previewContent(memory.content);

  const related = neighbors.map((pair) => {
    const id = pair.a === memory.id ? pair.b : pair.a;
    return { id, node: nodesById.get(id), similarity: pair.similarity };
  }).sort((a, b) => b.similarity - a.similarity);
  const relatedTypes = [...new Set(related.flatMap(({ node }) => node ? [node.type] : []))].sort();
  const visibleRelated = relatedType ? related.filter(({ node }) => node?.type === relatedType) : related;
  const versions = [
    { label: "Supersedes", id: memory.supersedes },
    { label: "Superseded by", id: data.supersededBy },
  ];

  const membership = contextTrace?.context.memories.find((item) => item.memoryId === memory.id);
  const inclusion = membership?.included
    ?? (contextTrace?.context.includedMemoryIds.includes(memory.id) ? true
      : contextTrace?.context.omittedMemoryIds.includes(memory.id) ? false : undefined);
  const contextFeedback = contextTrace?.feedback.filter((item) => item.memoryId === memory.id) ?? [];

  return (
    <>
      <div className="inspector-summary">
        <div className="inspector-summary-heading">
          <h2><i style={{ backgroundColor: MEMORY_TYPE_COLORS[memory.type] }} />{memory.type.replaceAll("_", " ")}</h2>
          <span className={`badge ${memory.status === "active" ? "included" : "omitted"}`}>{memory.status}</span>
        </div>
        <p className="meta">{scopeLabel(memory.scope)}{memory.domain ? ` · ${memory.domain}` : ""}</p>
      </div>

      <div className="inspector-nav" role="group" aria-label="Memory sections">
        {panes.map((section) => (
          <button key={section} type="button" aria-pressed={activePane === section} onClick={() => setPane(section)}>
            <Icon name={PANE_ICONS[section]} />
            {section}
          </button>
        ))}
      </div>

      <div className="inspector-content" key={activePane} role="region" tabIndex={0} aria-label={`Memory ${activePane.toLowerCase()}`}>
        {activePane === "Content" && (
          <>
            <h3>Memory text</h3>
            <p className="memory-text">{expanded ? memory.content : preview}</p>
            {preview !== memory.content && (
              <button type="button" className="inspector-action" aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}>
                {expanded ? "Show preview" : "Read full memory"}
              </button>
            )}
            {memory.tags.length > 0 && (
              <ul className="memory-tags" aria-label="Tags">
                {memory.tags.map((tag) => <li key={tag} className="badge omitted">{tag}</li>)}
              </ul>
            )}
            <dl className="inspector-metadata">
              <dt>Confidence</dt><dd>{memory.confidence.toFixed(2)}</dd>
              <dt>Updated</dt><dd><time dateTime={memory.updatedAt}>{formatTimestamp(memory.updatedAt)}</time></dd>
            </dl>
            <details className="inspector-record">
              <summary>Record details</summary>
              <dl className="inspector-metadata">
                <dt>Memory ID</dt><dd className="mono">{memory.id}</dd>
                <dt>Created</dt><dd><time dateTime={memory.createdAt}>{formatTimestamp(memory.createdAt)}</time></dd>
                <dt>Source</dt><dd>{memory.source.origin}</dd>
              </dl>
            </details>
          </>
        )}

        {activePane === "Related" && (
          <>
            <div className="inspector-section-heading">
              <h3>Semantic neighbors <span className="meta">({related.length})</span></h3>
              {relatedTypes.length > 0 && (
                <select className="filter-input" aria-label="Related memory type" value={relatedType}
                  onChange={(event) => setRelatedType(event.target.value)}>
                  <option value="">All types</option>
                  {relatedTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
                </select>
              )}
            </div>
            {visibleRelated.length === 0 ? <p className="meta">No related memories above the visualization threshold.</p> : (
              <ul className="inspector-related">
                {visibleRelated.map(({ id, node, similarity }) => (
                  <li key={id}>
                    <button type="button" onClick={() => onSelectNeighbor(id)}>
                      <span>{node?.contentPreview ?? id}</span>
                      <small>similarity {similarity.toFixed(2)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {versions.some(({ id }) => id !== null) && (
              <>
                <h3>Version history</h3>
                <ul className="inspector-related">
                  {versions.map(({ label, id }) => id && (
                    <li key={label}>
                      <button type="button" onClick={() => onSelectNeighbor(id)}>
                        <small>{label}</small>
                        <span>{nodesById.get(id)?.contentPreview ?? id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {activePane === "Activity" && (
          <>
            <h3>Delivery &amp; feedback</h3>
            <dl className="inspector-metadata">
              <dt>Deliveries</dt><dd>{data.deliveryCount}</dd>
              <dt>Useful</dt><dd>{data.feedback.useful}</dd>
              <dt>Not useful</dt><dd>{data.feedback.notUseful}</dd>
              <dt>Other feedback</dt><dd>{data.feedback.other}</dd>
            </dl>
            <h3>Performance <span className="meta">· experimental</span></h3>
            {performance === null ? <p className="meta">No usefulness evidence yet.</p> : (
              <>
                <p className="meta">Derived from feedback. Confidence is shown separately under Content.</p>
                <dl className="inspector-metadata">
                  <dt>Usefulness signal</dt><dd>{performance.usefulnessSignal.toFixed(3)}</dd>
                  <dt>Evidence mass</dt><dd>{performance.evidenceMass.toFixed(2)}</dd>
                  <dt>Useful judgments</dt><dd>{performance.usefulCount}</dd>
                  <dt>Not useful judgments</dt><dd>{performance.notUsefulCount}</dd>
                  <dt>Marked redundant</dt><dd>{performance.redundantReasonCount}</dd>
                  <dt>Marked incorrect</dt><dd>{performance.incorrectReasonCount}</dd>
                </dl>
              </>
            )}
          </>
        )}

        {activePane === "Context" && contextTrace && (
          <>
            <h3>In this context</h3>
            <p className="meta">Task {contextTrace.context.taskId ?? "(none)"} · {formatTimestamp(contextTrace.context.timestamp)}</p>
            {inclusion === undefined ? <p className="meta">Not part of this context’s candidate set.</p> : (
              <dl className="inspector-metadata">
                <dt>Selection</dt><dd><span className={`badge ${inclusion ? "included" : "omitted"}`}>{inclusion ? "included" : "omitted"}</span></dd>
                <dt>Rank</dt><dd>{membership?.rank ?? "—"}</dd>
                <dt>Tokens</dt><dd>{membership?.tokenCount ?? "—"}</dd>
              </dl>
            )}
            {contextFeedback.length > 0 && (
              <p>Feedback: {contextFeedback.map((item) => item.useful === true ? "useful" : item.useful === false ? "not useful" : "no signal").join(", ")}</p>
            )}
            {contextTrace.outcomes.length > 0 && <p>Task outcome: {contextTrace.outcomes.map((item) => item.outcome).join(", ")}</p>}
          </>
        )}
      </div>
    </>
  );
}
