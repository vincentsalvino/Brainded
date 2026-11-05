import { useId } from "react";
import { Icon, type IconName } from "./Icon";
import { usePointerTooltip } from "../use-pointer-tooltip";

export interface BarDatum {
  label: string;
  value: number | null;
  display?: string;
  detail: string;
  color?: string;
}

export function BarChart({ title, subtitle, rows, max, icon }: {
  title: string;
  subtitle: string;
  rows: BarDatum[];
  max: number;
  icon: IconName;
}) {
  const id = useId();
  const tip = usePointerTooltip();

  return (
    <section className="panel overview-chart" aria-labelledby={id}>
      <header>
        <h2 id={id} className="icon-label"><Icon name={icon} />{title}</h2>
        <p>{subtitle}</p>
      </header>
      {rows.length === 0 ? <p className="meta">No data recorded yet.</p> : (
        <ul className="chart-bars">
          {rows.map(({ label, value, display, detail, color }, index) => (
            <li key={label} className="chart-row" tabIndex={0} aria-describedby={`${id}-${index}`}
              onPointerEnter={(event) => { if (event.pointerType !== "touch") tip.show(event.clientX, event.clientY, detail); }}
              onPointerMove={(event) => tip.move(event.clientX, event.clientY)}
              onPointerLeave={tip.hide}
              onFocus={(event) => tip.focus(event.currentTarget, detail)}
              onBlur={tip.hide}
              onKeyDown={(event) => { if (event.key === "Escape") tip.hide(); }}>
              <span className="chart-label">{label}</span>
              <span className="chart-track" aria-hidden="true">
                <span style={{ width: `${((value ?? 0) / Math.max(1, max)) * 100}%`, backgroundColor: color }} />
              </span>
              <span className="chart-value">{display ?? value?.toLocaleString() ?? "—"}</span>
              <span className="sr-only" id={`${id}-${index}`}>{detail}</span>
            </li>
          ))}
        </ul>
      )}
      {tip.tooltip}
    </section>
  );
}
