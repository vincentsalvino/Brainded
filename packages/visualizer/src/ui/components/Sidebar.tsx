import { useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Icon, type IconName } from "./Icon";

export type Section = "map" | "contexts-list" | "overview";

interface SidebarProps {
  active: Section;
  onSelect: (section: Section) => void;
}

const COLLAPSED_WIDTH = 48;
const EXPANDED_WIDTH = 120;
const SNAP_MIDPOINT = (COLLAPSED_WIDTH + EXPANDED_WIDTH) / 2;

const LINKS: { id: Section; label: string; icon: IconName }[] = [
  { id: "map", label: "Map", icon: "network" },
  { id: "contexts-list", label: "Contexts", icon: "layers" },
  { id: "overview", label: "Overview", icon: "chart" },
];

export function Sidebar({ active, onSelect }: SidebarProps) {
  const navId = useId();
  const dock = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const snapWidth = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current || !dock.current) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: dock.current.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const width = current.startWidth + (event.clientX - current.startX);
    const clamped = Math.min(EXPANDED_WIDTH, Math.max(COLLAPSED_WIDTH, width));
    dock.current?.style.setProperty("--sidebar-drag-width", `${clamped}px`);
  }

  function finishResize(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    dock.current?.style.removeProperty("--sidebar-drag-width");
    setDragging(false);

    const delta = event.clientX - current.startX;
    if (!cancelled && Math.abs(delta) >= 4) {
      setCollapsed(current.startWidth + delta < SNAP_MIDPOINT);
    }
  }

  return (
    <div ref={dock} className="sidebar-dock" data-dragging={dragging}
      style={{ "--sidebar-snap-width": `${snapWidth}px` } as CSSProperties}>
      <nav id={navId} className={`sidebar${collapsed ? " collapsed" : ""}`} aria-label="Visualizer">
        {LINKS.map((link) => (
          <button
            key={link.id}
            type="button"
            className={`sidebar-link${active === link.id ? " active" : ""}`}
            onClick={() => onSelect(link.id)}
            title={collapsed ? link.label : undefined}
            aria-label={link.label}
            aria-current={active === link.id ? "page" : undefined}
          >
            <Icon name={link.icon} />
            <span>{link.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-edge" role="separator" tabIndex={0} aria-label="Resize navigation sidebar"
        aria-orientation="vertical" aria-controls={navId}
        aria-valuemin={COLLAPSED_WIDTH} aria-valuemax={EXPANDED_WIDTH} aria-valuenow={snapWidth}
        aria-valuetext={collapsed ? "Collapsed" : "Expanded"}
        onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={finishResize}
        onPointerCancel={(event) => finishResize(event, true)}
        onLostPointerCapture={(event) => finishResize(event, true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "Home") {
            event.preventDefault();
            setCollapsed(true);
          } else if (event.key === "ArrowRight" || event.key === "End") {
            event.preventDefault();
            setCollapsed(false);
          }
        }}
      />
    </div>
  );
}
