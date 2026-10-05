export type Section = "map" | "contexts-list" | "overview";

interface SidebarProps {
  active: Section;
  onSelect: (section: Section) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const LINKS: { id: Section; label: string }[] = [
  { id: "map", label: "Brain" },
  { id: "contexts-list", label: "Contexts" },
  { id: "overview", label: "Overview" },
];

export function Sidebar({ active, onSelect, collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <nav className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? "»" : "«"}
      </button>
      {LINKS.map((link) => (
        <button
          key={link.id}
          type="button"
          className={`sidebar-link${active === link.id ? " active" : ""}`}
          onClick={() => onSelect(link.id)}
          title={collapsed ? link.label : undefined}
        >
          {collapsed ? link.label.slice(0, 1) : link.label}
        </button>
      ))}
    </nav>
  );
}
