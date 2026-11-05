import { useState } from "react";
import { api } from "../api-client";
import { useFetch } from "../use-fetch";
import { EmptyState } from "../components/EmptyState";
import { SkeletonLines } from "../components/Skeleton";
import { Icon } from "../components/Icon";
import { formatTimestamp, scopeLabel, scopeKey } from "../display-format";

interface ContextListPageProps {
  onSelect: (id: string) => void;
}

const PAGE_SIZE = 6;
const DEFAULT_FILTERS = { query: "", scope: "", delivery: "", sort: "recent" };

export function ContextListPage({ onSelect }: ContextListPageProps) {
  const { data, error } = useFetch(api.listContexts, []);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);

  function updateFilter(key: keyof typeof DEFAULT_FILTERS, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  }

  const items = data?.items ?? [];
  const scopes = [...new Map(items.map(({ scope }) => [scopeKey(scope), scopeLabel(scope)]))]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const query = filters.query.trim().toLowerCase();
  const hasFilters = Boolean(filters.query || filters.scope || filters.delivery || filters.sort !== DEFAULT_FILTERS.sort);
  const matches = items.filter((ctx) => (
    (!filters.scope || filters.scope === scopeKey(ctx.scope)) &&
    (!filters.delivery || (filters.delivery === "included" ? ctx.includedMemoryIds.length > 0 : ctx.omittedMemoryIds.length > 0)) &&
    (!query || [ctx.id, ctx.taskId, scopeLabel(ctx.scope)].some((value) => value?.toLowerCase().includes(query)))
  )).sort((a, b) => (filters.sort === "tokens" ? b.tokenCount - a.tokenCount : 0)
    || b.timestamp.localeCompare(a.timestamp));
  const start = page * PAGE_SIZE;
  const visible = matches.slice(start, start + PAGE_SIZE);

  return (
    <div className="dashboard-page context-page">
      <header className="page-heading">
        <h1 className="icon-label"><Icon name="layers" />Context Deliveries</h1>
        <p>Find a recent delivery and open its trace to see which memories were included or omitted.</p>
      </header>

      <div className="context-filters" role="group" aria-label="Filter context deliveries">
        <label className="filter-field">
          Search
          <span className="search-field">
            <Icon name="search" />
            <input className="filter-input" type="search" placeholder="Task, context ID, or scope"
              value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} />
          </span>
        </label>
        <label className="filter-field">
          Scope
          <select className="filter-input" value={filters.scope} onChange={(event) => updateFilter("scope", event.target.value)}>
            <option value="">All scopes</option>
            {scopes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="filter-field">
          Memory selection
          <select className="filter-input" value={filters.delivery} onChange={(event) => updateFilter("delivery", event.target.value)}>
            <option value="">Any delivery</option>
            <option value="included">Has included memories</option>
            <option value="omitted">Has omitted memories</option>
          </select>
        </label>
        <label className="filter-field">
          Sort by
          <select className="filter-input" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>
            <option value="recent">Newest first</option>
            <option value="tokens">Most tokens</option>
          </select>
        </label>
        <button type="button" className="text-button" disabled={!hasFilters}
          onClick={() => { setFilters(DEFAULT_FILTERS); setPage(0); }}>Reset</button>
      </div>

      <section className="panel context-panel" aria-label="Recent context deliveries">
        {error ? <EmptyState message={`failed to load contexts: ${error.message}`} tone="error" /> : !data ? (
          <div className="panel-body">
            <span className="sr-only" role="status">Loading context deliveries…</span>
            <SkeletonLines count={6} />
          </div>
        ) : matches.length === 0 ? (
          <EmptyState message={items.length === 0 ? "No context deliveries recorded yet." : "No deliveries match these filters."} />
        ) : (
          <>
            <div className="context-row context-columns" aria-hidden="true">
              <span>Delivery / scope</span><span>Tokens</span><span>Included</span><span>Omitted</span><span>Delivered</span><span />
            </div>
            <ul className="context-rows">
              {visible.map((ctx) => (
                <li key={ctx.id}>
                  <button type="button" className="context-row context-entry" onClick={() => onSelect(ctx.id)}>
                    <span className="context-identity">
                      <strong title={ctx.taskId ?? ctx.id}>{ctx.taskId ?? "(no task id)"}</strong>
                      <span className="meta" title={ctx.id}>{scopeLabel(ctx.scope)} · {ctx.id.slice(0, 8)}</span>
                    </span>
                    <span className="context-number"><span className="context-mobile-label">Tokens</span>{ctx.tokenCount.toLocaleString()}</span>
                    <span className="context-number context-included"><span className="context-mobile-label">Included</span>{ctx.includedMemoryIds.length}</span>
                    <span className="context-number"><span className="context-mobile-label">Omitted</span>{ctx.omittedMemoryIds.length}</span>
                    <time dateTime={ctx.timestamp} title={ctx.timestamp}>{formatTimestamp(ctx.timestamp)}</time>
                    <Icon name="arrow" className="context-open" />
                    <span className="sr-only">Open trace</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {data && !error && (
          <footer className="context-pagination">
            <span className="meta" role="status">
              {matches.length ? `${start + 1}–${start + visible.length} of ${matches.length}` : "0 matches"} · {items.length} recent deliveries
            </span>
            {matches.length > PAGE_SIZE && (
              <div>
                <button type="button" className="icon-label" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevronLeft" />Previous</button>
                <button type="button" className="icon-label" disabled={start + PAGE_SIZE >= matches.length} onClick={() => setPage(page + 1)}>Next<Icon name="chevronRight" /></button>
              </div>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
