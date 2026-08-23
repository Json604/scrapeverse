"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

interface TooltipBubble {
  getBoundingClientRect(): { width: number; height: number };
}

interface TooltipRuntime {
  document: { body: Parameters<typeof createPortal>[1] };
  innerWidth: number;
}

type TooltipPlacement = "above" | "below";

interface TooltipPosition {
  anchorCenter: number;
  anchorTop: number;
  anchorBottom: number;
  left: number;
  top: number;
  placement: TooltipPlacement;
}

const TOOLTIP_GAP = 8;
const VIEWPORT_GUTTER = 12;

export function ContextTip({ label, definition }: { label: string; definition: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({
    anchorCenter: 0,
    anchorTop: 0,
    anchorBottom: 0,
    left: 0,
    top: 0,
    placement: "above",
  });

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current as unknown as TooltipBubble | null;
    if (!open || !bubble) return;

    const runtime = globalThis as unknown as TooltipRuntime;
    const bounds = bubble.getBoundingClientRect();
    const halfWidth = bounds.width / 2;
    const minimumLeft = VIEWPORT_GUTTER + halfWidth;
    const maximumLeft = Math.max(minimumLeft, runtime.innerWidth - VIEWPORT_GUTTER - halfWidth);
    const left = Math.min(maximumLeft, Math.max(minimumLeft, position.anchorCenter));
    const placement: TooltipPlacement = position.anchorTop >= bounds.height + TOOLTIP_GAP + VIEWPORT_GUTTER ? "above" : "below";
    const top = placement === "above" ? position.anchorTop - TOOLTIP_GAP : position.anchorBottom + TOOLTIP_GAP;

    setPosition((current) => current.left === left && current.top === top && current.placement === placement
      ? current
      : { ...current, left, top, placement });
  }, [open, position.anchorBottom, position.anchorCenter, position.anchorTop]);

  function showTooltip() {
    const anchor = anchorRef.current as unknown as TooltipAnchor | null;
    if (!anchor) return;
    const bounds = anchor.getBoundingClientRect();
    const anchorCenter = bounds.left + bounds.width / 2;
    setPosition({
      anchorCenter,
      anchorTop: bounds.top,
      anchorBottom: bounds.bottom,
      left: anchorCenter,
      top: bounds.top - TOOLTIP_GAP,
      placement: "above",
    });
    setOpen(true);
  }

  const bubble = (
    <span
      className="context-tip__bubble"
      data-placement={position.placement}
      data-open={open}
      id={tooltipId}
      ref={bubbleRef}
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
