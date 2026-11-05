import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";

interface CheckboxGroup {
  label: string;
  options: { value: string; label: string; color?: string }[];
  selected: ReadonlySet<string>;
  onChange: (values: Set<string>) => void;
}

export function CheckboxFilter({ groups }: { groups: CheckboxGroup[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selectionCount = groups.reduce((count, group) => count + group.selected.size, 0);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div ref={root} className="checkbox-filter"
      onBlur={(event) => {
        // Clicking a label's text can briefly blur with no focus target before activating its input.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}>
      <button ref={trigger} type="button" className="filter-input checkbox-trigger" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name="filter" />
        Filters
        {selectionCount > 0 && <span className="filter-count">{selectionCount}</span>}
      </button>
      <div id={id} className="panel checkbox-popover" hidden={!open}>
        <div className="checkbox-groups">
          {groups.map(({ label, options, selected, onChange }) => (
            <div key={label} role="group" aria-label={label}>
              <div className="checkbox-heading">
                <strong>{label}</strong>
                <button type="button" className="text-button" aria-label={`Clear ${label.toLowerCase()}`}
                  disabled={selected.size === 0}
                  onClick={() => { onChange(new Set()); trigger.current?.focus(); }}>Clear</button>
              </div>
              <div className="checkbox-options">
                {options.map((option) => (
                  <label key={option.value}>
                    <input type="checkbox" checked={selected.has(option.value)} onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(option.value);
                      else next.delete(option.value);
                      onChange(next);
                    }} />
                    {option.color && <i style={{ backgroundColor: option.color }} />}
                    <span>{option.label}</span>
                  </label>
                ))}
                {!options.length && <p className="meta">No options available.</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="checkbox-footnote">{selectionCount ? `${selectionCount} selected` : "Showing all"}</div>
      </div>
    </div>
  );
}
