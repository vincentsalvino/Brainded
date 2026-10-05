interface TopBarProps {
  vectorSearchAvailable: boolean | null;
}

export function TopBar({ vectorSearchAvailable }: TopBarProps) {
  return (
    <header className="topbar">
      <span className="topbar-name">BRAIN VISUALIZER</span>
      <span className="topbar-scope">project: ai-brain</span>
      <span style={{ marginLeft: "auto" }} className="topbar-scope">
        <span className={`status-dot ${vectorSearchAvailable === null ? "off" : vectorSearchAvailable ? "on" : "warn"}`} />
        {vectorSearchAvailable === null ? "connecting" : vectorSearchAvailable ? "vector search on" : "vector search unavailable"}
      </span>
    </header>
  );
}
