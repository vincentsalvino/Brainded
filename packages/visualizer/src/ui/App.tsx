import { useState, useEffect, useCallback } from "react";
import { TopBar } from "./components/TopBar";
import { Sidebar, type Section } from "./components/Sidebar";
import { StatusFooter } from "./components/StatusFooter";
import { OverviewPage } from "./pages/OverviewPage";
import { ContextListPage } from "./pages/ContextListPage";
import { BrainMapPage } from "./pages/BrainMapPage";
import { useFetch } from "./use-fetch";
import { api } from "./api-client";

export function App() {
  const [view, setView] = useState<Section>("map");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Lightweight status-footer poll, independent of whichever page is showing --
  // fine to keep as its own fetch rather than lifting a page's state up, since
  // it's the only cross-page consumer of this data.
  const { data: overview } = useFetch(api.getOverview, []);

  const clearTopmostOverlay = useCallback(() => {
    if (selectedMemoryId) setSelectedMemoryId(null);
    else if (activeContextId) setActiveContextId(null);
  }, [selectedMemoryId, activeContextId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") clearTopmostOverlay();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearTopmostOverlay]);

  function selectFromContextList(contextId: string): void {
    setActiveContextId(contextId);
    setView("map");
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <TopBar vectorSearchAvailable={overview?.vectorSearchAvailable ?? null} />
      <Sidebar
        active={view}
        onSelect={setView}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />
      <main className="main">
        {view === "overview" && <OverviewPage />}
        {view === "contexts-list" && <ContextListPage onSelect={selectFromContextList} />}
        {view === "map" && (
          <BrainMapPage
            activeContextId={activeContextId}
            onClearContext={() => setActiveContextId(null)}
            selectedMemoryId={selectedMemoryId}
            onSelectMemory={setSelectedMemoryId}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        )}
      </main>
      <StatusFooter learningEnabled={overview?.learning.enabled ?? null} redundancyEnabled={overview?.redundancy.enabled ?? null} />
    </div>
  );
}
