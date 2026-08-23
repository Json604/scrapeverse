"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fitTooltipPosition, type TooltipPosition } from "../src/ui/tooltip-position.ts";

export const EVENT_TERM_HELP = {
  entered: "Appeared on a watched list since the last trusted check.",
  moved: "Rank changed beyond this source's noise band.",
  changed: "A watched metric or attribute changed.",
} as const;

export const STATUS_TERM_HELP: Record<string, string> = {
  healthy: "Latest fetch returned usable rows and passed trust checks.",
  quiet: "Fetch passed, but nothing meaningful moved.",
  broken: "Trust checks failed, so new events are muted.",
  degraded: "One warning was detected; results remain quarantined.",
  stale: "The source did not return a fresh fetch.",
  calibrating: "The source is building its first trusted baseline.",
  unavailable: "No live snapshot is available yet.",
};

interface TooltipAnchor {
  getBoundingClientRect(): { top: number; bottom: number; left: number; width: number };
}

interface TooltipRuntime {
  document: { body: Parameters<typeof createPortal>[1] };
  innerWidth: number;
}

export function ContextTip({ label, definition }: { label: string; definition: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    placement: "above",
  });

  useEffect(() => setMounted(true), []);

  function showTooltip() {
    const anchor = anchorRef.current as unknown as TooltipAnchor | null;
    if (!anchor) return;
    const runtime = globalThis as unknown as TooltipRuntime;
    const bounds = anchor.getBoundingClientRect();
    setPosition(fitTooltipPosition(bounds, runtime.innerWidth));
    setOpen(true);
  }

  const bubble = (
    <span
      className="context-tip__bubble"
      data-placement={position.placement}
      data-open={open}
      id={tooltipId}
      role="tooltip"
      style={{ left: position.left, top: position.top }}
    >
      {definition}
    </span>
  );

  return (
    <span
      className="context-tip"
      ref={anchorRef}
      tabIndex={0}
      aria-describedby={tooltipId}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setOpen(false)}
      onFocus={showTooltip}
      onBlur={() => setOpen(false)}
    >
      {label}
      {mounted ? createPortal(bubble, (globalThis as unknown as TooltipRuntime).document.body) : null}
    </span>
  );
}
