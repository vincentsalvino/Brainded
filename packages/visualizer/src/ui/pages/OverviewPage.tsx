import { api } from "../api-client";
import { useFetch } from "../use-fetch";
import { StatCard } from "../components/StatCard";
import { EmptyState } from "../components/EmptyState";
import { ActivityFeedItem } from "../components/ActivityFeedItem";
import { Skeleton, SkeletonLines } from "../components/Skeleton";

/** "—" (not "0%") when there's no tracked task to divide by -- 0/0 is undefined, not zero coverage. */
function coverage(n: number, total: number): string {
  return total === 0 ? "—" : `${n} (${Math.round((n / total) * 1000) / 10}%)`;
}

export function OverviewPage() {
  const { data, error } = useFetch(api.getOverview, []);

  if (error) return <EmptyState message={`failed to load overview: ${error.message}`} tone="error" />;

  return (
    <div>
      {!data && (
        <span className="sr-only" role="status">
          Loading overview…
        </span>
      )}

      <h2 className="section-title">Memories</h2>
      {!data ? (
        <div className="stat-grid">
          <Skeleton height={54} />
          <Skeleton height={54} />
          <Skeleton height={54} />
        </div>
      ) : (
        <div className="stat-grid">
          <StatCard label="Total" value={data.memories.total} />
          <StatCard label="Active" value={data.memories.active} />
          <StatCard label="Archived" value={data.memories.archived} />
        </div>
      )}

      <h2 className="section-title">Events</h2>
      {!data ? (
        <div className="stat-grid">
          <Skeleton height={54} />
          <Skeleton height={54} />
          <Skeleton height={54} />
          <Skeleton height={54} />
        </div>
      ) : (
        <div className="stat-grid">
          <StatCard label="Contexts" value={data.events.contextEvents} />
          <StatCard label="Retrievals" value={data.events.retrievalEvents} />
          <StatCard label="Feedback" value={data.events.feedbackEvents} />
          <StatCard label="Outcomes" value={data.events.outcomeEvents} />
        </div>
      )}

      <h2 className="section-title">Workflow</h2>
      {!data ? (
        <div className="stat-grid" style={{ marginBottom: "var(--space-5)" }}>
          <Skeleton height={54} />
          <Skeleton height={54} />
          <Skeleton height={54} />
          <Skeleton height={54} />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Observed Brain Tasks" value={data.workflow.tasksTracked} />
            <StatCard label="With Context" value={coverage(data.workflow.tasksWithContext, data.workflow.tasksTracked)} />
            <StatCard label="With Feedback" value={coverage(data.workflow.tasksWithFeedback, data.workflow.tasksWithContext)} />
            <StatCard label="With Outcome" value={coverage(data.workflow.tasksWithOutcome, data.workflow.tasksWithContext)} />
          </div>
          <p className="meta" style={{ marginBottom: "var(--space-5)" }}>
            <strong>Tasks that never contact Brain are not observable</strong> — "Observed Brain Tasks" is not a
            count of all substantive work, only of tasks that left a task id on a context or outcome event. "With
            Context" is a share of that observed total; "With Feedback"/"With Outcome" are a share of tasks with
            context specifically, since neither is expected before a context was delivered. Feedback is selective
            by policy, not required to reach 100%. Bypass isn't tracked yet: a genuinely bypassed task records no
            event.
          </p>
        </>
      )}

      <h2 className="section-title">System</h2>
      <div className="panel" style={{ marginBottom: "var(--space-5)" }}>
        <div className="panel-body">
          {!data ? (
            <SkeletonLines count={4} />
          ) : (
            <>
              <div>Vector search: {data.vectorSearchAvailable ? "available" : "unavailable"}</div>
              <div>Applied migrations: {data.appliedMigrations.length}</div>
              <div>Learning: {data.learning.enabled ? "ON" : "OFF (default)"}</div>
              <div>Redundancy: {data.redundancy.enabled ? "ON" : "OFF (default)"}</div>
            </>
          )}
        </div>
      </div>

      <h2 className="section-title">Recent Activity</h2>
      <div className="panel">
        {!data ? (
          <div className="panel-body">
            <SkeletonLines count={5} />
          </div>
        ) : data.recentActivity.length === 0 ? (
          <EmptyState message="No activity recorded yet." />
        ) : (
          <div className="row-list">
            {data.recentActivity.map((item, i) => (
              <ActivityFeedItem key={i} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
