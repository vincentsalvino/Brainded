import { useId, useRef, useState, type PointerEvent, type ReactNode } from "react";

const STOPS = ["collapsed", "compact", "wide"] as const;
type Stop = (typeof STOPS)[number];

export function InspectorDock({ children }: { children: ReactNode }) {
  const id = useId();
  const [stop, setStop] = useState<Stop>("compact");
  const [dragging, setDragging] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const points = useRef<Array<HTMLSpanElement | null>>([]);
  const drag = useRef<{ pointer: number; x: number; width: number; stops: number[]; moved: boolean } | null>(null);
  const collapsed = stop === "collapsed";

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current || !dock.current || !slider.current) return;
    const right = dock.current.getBoundingClientRect().right;
    const stops = points.current.map((point) => right - (point?.getBoundingClientRect().left ?? right));
    drag.current = { pointer: event.pointerId, x: event.clientX, width: slider.current.clientWidth, stops, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const delta = current.x - event.clientX;
    if (!current.moved) {
      if (Math.abs(delta) < 4) return;
      current.moved = true;
      setDragging(true);
    }
    const width = Math.max(current.stops[0]!, Math.min(current.stops[2]!, current.width + delta));
    slider.current?.style.setProperty("--drag-width", `${width}px`);
  }

  function end(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    slider.current?.style.removeProperty("--drag-width");
    setDragging(false);
    if (cancel || !current.moved) return;
    const width = current.width + current.x - event.clientX;
    const nearest = current.stops.reduce((best, value, index) =>
      Math.abs(value - width) < Math.abs(current.stops[best]! - width) ? index : best, 0);
    setStop(STOPS[nearest]!);
  }

  return (
    <div ref={dock} className="inspector-dock" data-dragging={dragging}>
      <div className="inspector-snap-points" aria-hidden="true">
        {STOPS.map((point, index) => <span key={point} data-stop={point}
          ref={(element) => { points.current[index] = element; }} />)}
      </div>
      <div ref={slider} className="inspector-slider" data-stop={stop}>
        <div className="inspector-edge" role="separator" tabIndex={0} aria-controls={id}
          aria-label="Resize memory inspector" aria-orientation="vertical"
          aria-valuemin={1} aria-valuemax={STOPS.length} aria-valuenow={STOPS.indexOf(stop) + 1}
          aria-valuetext={stop}
          onPointerDown={start} onPointerMove={move}
          onPointerUp={end} onPointerCancel={(event) => end(event, true)}
          onLostPointerCapture={(event) => end(event, true)}
          onKeyDown={(event) => {
            const index = STOPS.indexOf(stop);
            const next = {
              ArrowLeft: STOPS[Math.min(index + 1, STOPS.length - 1)],
              ArrowRight: STOPS[Math.max(index - 1, 0)],
              Home: "collapsed",
              End: "wide",
            }[event.key] as Stop | undefined;
            if (!next) return;
            event.preventDefault();
            setStop(next);
          }}
        />
        <aside id={id} className="panel inspector" aria-label="Memory Inspector" hidden={collapsed && !dragging}>
          {children}
        </aside>
      </div>
    </div>
  );
}
