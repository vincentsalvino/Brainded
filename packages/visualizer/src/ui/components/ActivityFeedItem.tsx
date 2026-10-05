import type { ActivityItem } from "../../shared/api-types";

function describe(item: ActivityItem): string {
  switch (item.kind) {
    case "context":
      return `context delivered -- ${item.event.tokenCount} tok, ${item.event.includedMemoryIds.length} memories`;
    case "feedback":
      return `feedback -- useful=${String(item.event.useful)}${item.event.reason ? ` (${item.event.reason})` : ""}`;
    case "outcome":
      return `outcome -- ${item.event.outcome}`;
    case "mutation":
      return `memory ${item.event.mutationType}${item.event.summary ? ` -- ${item.event.summary}` : ""}`;
  }
}

export function ActivityFeedItem({ item }: { item: ActivityItem }) {
  return (
    <div className="row-item" style={{ cursor: "default" }}>
      <span className="badge included">{item.kind}</span>
      <span>{describe(item)}</span>
      <span className="meta mono">{item.timestamp}</span>
    </div>
  );
}
