import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function place(tip: HTMLDivElement, x: number, y: number) {
  const gap = 14;
  const edge = 8;
  const right = document.documentElement.clientWidth - tip.offsetWidth - edge;
  const bottom = document.documentElement.clientHeight - tip.offsetHeight - edge;
  const left = Math.max(edge, Math.min(x + gap, right));
  const top = Math.max(edge, Math.min(y + gap <= bottom ? y + gap : y - tip.offsetHeight - gap, bottom));
  tip.style.transform = `translate(${left}px, ${top}px)`;
}

export function usePointerTooltip() {
  const [content, setContent] = useState<ReactNode>(null);
  const tip = useRef<HTMLDivElement>(null);
  const point = useRef({ x: 0, y: 0 });

  function move(x: number, y: number) {
    point.current = { x, y };
    if (tip.current) place(tip.current, x, y);
  }

  function show(x: number, y: number, body: ReactNode) {
    move(x, y);
    setContent(body);
  }

  function focus(target: Element, body: ReactNode) {
    if (!target.matches(":focus-visible")) return;
    const bounds = target.getBoundingClientRect();
    show(bounds.left + bounds.width / 2, bounds.bottom, body);
  }

  useLayoutEffect(() => {
    if (tip.current) place(tip.current, point.current.x, point.current.y);
  }, [content]);

  const visible = content !== null;
  useEffect(() => {
    if (!visible) return;
    const dismiss = () => setContent(null);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [visible]);

  return {
    move,
    show,
    focus,
    hide: () => setContent(null),
    // Triggers already expose their description to assistive technology.
    tooltip: visible ? createPortal(<div ref={tip} className="pointer-tooltip" aria-hidden="true">{content}</div>, document.body) : null,
  };
}
