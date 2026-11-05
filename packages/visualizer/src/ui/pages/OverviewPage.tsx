import { useState } from "react";
import { api } from "../api-client";
import { useFetch } from "../use-fetch";
import { StatCard } from "../components/StatCard";
import { EmptyState } from "../components/EmptyState";
import { ActivityFeedItem } from "../components/ActivityFeedItem";
import { BarChart, type BarDatum } from "../components/BarChart";
import { Skeleton, SkeletonLines } from "../components/Skeleton";
import { MEMORY_TYPE_COLORS } from "../memory-type-colors";
import { Icon } from "../components/Icon";

function coverage(label: string, n: number, total: number, denominator: string): BarDatum {
  const percent = total === 0 ? null : (n / total) * 100;
  return {
    label,
    value: percent,
    display: percent === null ? "—" : `${n} (${Math.round(percent * 10) / 10}%)`,
    detail: total === 0 ? `No ${denominator} to measure yet.` : `${n} of ${total} ${denominator}.`,
  };
}

export function OverviewPage() {
  const { data, error } = useFetch(api.getOverview, []);
  const [activityKind, setActivityKind] = useState("all");

  if (error) return <EmptyState message={`failed to load overview: ${error.message}`} tone="error" />;

  const memoryTypes = data ? Object.entries(data.memories.byType)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, value]) => {
      const label = type.replaceAll("_", " ");
      return {
        label, value,
        color: MEMORY_TYPE_COLORS[type as keyof typeof MEMORY_TYPE_COLORS],
        detail: `${label[0]?.toUpperCase() ?? ""}${label.slice(1)} · ${value} of ${data.memories.total} stored memories`,
      };
    }) : [];
  const events = data ? [
    { label: "Retrievals", value: data.events.retrievalEvents, detail: "Times Brain searched for memory candidates." },
    { label: "Contexts", value: data.events.contextEvents, detail: "Context packs delivered to agents." },
    { label: "Feedback", value: data.events.feedbackEvents, detail: "Feedback records about individual memories." },
    { label: "Outcomes", value: data.events.outcomeEvents, detail: "Task results reported by agents." },
  ].map((row) => ({ ...row, detail: `${row.value.toLocaleString()} total · ${row.detail}` })) : [];
  const activity = data?.recentActivity.filter((item) => activityKind === "all" || item.kind === activityKind);

  return (
    <div className="dashboard-page">
      {!data && <span className="sr-only" role="status">Loading overview…</span>}
      <header className="page-heading">
        <h1 className="icon-label"><Icon name="chart" />Overview</h1>
        <p>Memory inventory, retrieval activity, and workflow coverage.</p>
      </header>

      <h2 className="sr-only">Memories</h2>
      <div className="stat-grid overview-stats">
        {data ? (
          <>
            <StatCard label="Stored memories" value={data.memories.total.toLocaleString()} />
            <StatCard label="Active memories" value={data.memories.active.toLocaleString()} />
            <StatCard label="Archived memories" value={data.memories.archived.toLocaleString()} />
            <StatCard label="Observed tasks" value={data.workflow.tasksTracked.toLocaleString()} />
          </>
        ) : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={72} />)}
      </div>

      <div className="overview-grid">
        {data ? (
          <>
            <div className="overview-distribution">
              <BarChart title="Memory types" subtitle="Distribution of all stored memories" rows={memoryTypes} icon="layers"
                max={memoryTypes[0]?.value ?? 0} />
            </div>
            <BarChart title="Events" subtitle="All-time counts" rows={events} icon="pulse"
              max={Math.max(...events.map(({ value }) => value))} />
            <BarChart title="Workflow coverage" subtitle="Only tasks with a recorded context or outcome are counted." icon="chart"
              max={100} rows={[
                coverage("With context", data.workflow.tasksWithContext, data.workflow.tasksTracked, "observed tasks"),
                coverage("With feedback", data.workflow.tasksWithFeedback, data.workflow.tasksWithContext, "tasks with a context"),
                coverage("With outcome", data.workflow.tasksWithOutcome, data.workflow.tasksWithContext, "tasks with a context"),
              ]} />
          </>
        ) : (
          <>
            <div className="overview-distribution"><Skeleton height={320} /></div>
            <Skeleton height={152} />
            <Skeleton height={152} />
          </>
        )}
      </div>

      <div className="overview-bottom">
        <section className="panel">
          <header className="dashboard-panel-header">
            <h2 className="icon-label"><Icon name="pulse" />Recent Activity</h2>
            <select className="filter-input" aria-label="Activity type" value={activityKind}
              onChange={(event) => setActivityKind(event.target.value)}>
              <option value="all">All events</option>
              <option value="context">Contexts</option>
              <option value="feedback">Feedback</option>
              <option value="outcome">Outcomes</option>
              <option value="mutation">Memory changes</option>
            </select>
          </header>
          {!activity ? (
            <div className="panel-body"><SkeletonLines count={5} /></div>
          ) : activity.length === 0 ? (
            <EmptyState message={activityKind === "all" ? "No activity recorded yet." : "No recent events of this type."} />
          ) : (
            <div className="row-list">
              {activity.map((item) => <ActivityFeedItem key={`${item.kind}-${item.event.id}`} item={item} />)}
            </div>
          )}
        </section>
        <section className="panel">
          <header className="dashboard-panel-header"><h2 className="icon-label"><Icon name="database" />System</h2></header>
          <div className="system-status panel-body">
            {data ? (
              <>
                <div>Vector search: {data.vectorSearchAvailable ? "available" : "unavailable"}</div>
                <div>Applied migrations: {data.appliedMigrations.length}</div>
                <div>Learning: {data.learning.enabled ? "ON" : "OFF (default)"}</div>
                <div>Redundancy: {data.redundancy.enabled ? "ON" : "OFF (default)"}</div>
              </>
            ) : <SkeletonLines count={4} />}
          </div>
        </section>
      </div>
    </div>
  );
}
