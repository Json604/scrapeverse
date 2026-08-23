export type TooltipPlacement = "above" | "below";

export interface TooltipAnchorBounds {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
  placement: TooltipPlacement;
}

const TOOLTIP_WIDTH = 260;
const TOOLTIP_HEIGHT_ESTIMATE = 64;
const TOOLTIP_GAP = 8;
const VIEWPORT_GUTTER = 12;

export function fitTooltipPosition(bounds: TooltipAnchorBounds, viewportWidth: number): TooltipPosition {
  const renderedWidth = Math.min(TOOLTIP_WIDTH, Math.max(0, viewportWidth - VIEWPORT_GUTTER * 2));
  const halfWidth = renderedWidth / 2;
  const minimumLeft = VIEWPORT_GUTTER + halfWidth;
  const maximumLeft = Math.max(minimumLeft, viewportWidth - VIEWPORT_GUTTER - halfWidth);
  const anchorCenter = bounds.left + bounds.width / 2;
  const left = Math.min(maximumLeft, Math.max(minimumLeft, anchorCenter));
  const placement: TooltipPlacement = bounds.top >= TOOLTIP_HEIGHT_ESTIMATE + TOOLTIP_GAP + VIEWPORT_GUTTER ? "above" : "below";
  const top = placement === "above" ? bounds.top - TOOLTIP_GAP : bounds.bottom + TOOLTIP_GAP;

  return { left, top, placement };
}
