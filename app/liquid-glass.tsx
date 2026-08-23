"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createLensDisplacementMap } from "../src/ui/liquid-glass";

interface LiquidGlassProps {
  children?: ReactNode;
  className?: string;
  strength?: number;
  tone?: "light" | "dark";
}

interface RenderedMap {
  dataUrl: string;
  width: number;
  height: number;
  radius: number;
}

interface GlassElement {
  getBoundingClientRect(): { width: number; height: number };
}

interface GlassCanvasContext {
  createImageData(width: number, height: number): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void;
}

interface GlassCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): GlassCanvasContext | null;
  toDataURL(type: "image/png"): string;
}

interface GlassResizeObserver {
  observe(element: GlassElement): void;
  disconnect(): void;
}

interface GlassBrowserRuntime {
  document: { createElement(tag: "canvas"): GlassCanvas };
  getComputedStyle(element: GlassElement): { borderTopLeftRadius: string };
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(frame: number): void;
  ResizeObserver: new (callback: () => void) => GlassResizeObserver;
}

function getGlassRuntime() {
  return globalThis as unknown as GlassBrowserRuntime;
}

function readRadius(element: GlassElement, runtime: GlassBrowserRuntime) {
  const radius = Number.parseFloat(runtime.getComputedStyle(element).borderTopLeftRadius);
  return Number.isFinite(radius) ? radius : element.getBoundingClientRect().height / 2;
}

function renderMap(element: GlassElement, runtime: GlassBrowserRuntime): Omit<RenderedMap, "radius"> & { radius: number } | null {
  const bounds = element.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1) return null;

  const scale = Math.min(1, 256 / Math.max(bounds.width, bounds.height));
  const width = Math.max(8, Math.round(bounds.width * scale));
  const height = Math.max(8, Math.round(bounds.height * scale));
  const radius = Math.max(0, readRadius(element, runtime) * scale);
  const map = createLensDisplacementMap({
    width,
    height,
    radius,
    depth: Math.max(5, Math.min(width, height) * 0.24),
  });
  const canvas = runtime.document.createElement("canvas");
  canvas.width = map.width;
  canvas.height = map.height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const image = context.createImageData(map.width, map.height);
  image.data.set(map.pixels);
  context.putImageData(image, 0, 0);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: map.width,
    height: map.height,
    radius,
  };
}

export function LiquidGlass({ children, className = "", strength = 9, tone = "light" }: LiquidGlassProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const geometryRef = useRef("");
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [lensMap, setLensMap] = useState<RenderedMap | null>(null);
  const [filterVersion, setFilterVersion] = useState(0);

  useEffect(() => {
    const element = elementRef.current as unknown as GlassElement | null;
    if (!element) return;
    const runtime = getGlassRuntime();

    let frame = 0;
    const update = () => {
      runtime.cancelAnimationFrame(frame);
      frame = runtime.requestAnimationFrame(() => {
        const nextMap = renderMap(element, runtime);
        if (!nextMap) return;
        const geometry = `${nextMap.width}:${nextMap.height}:${nextMap.radius.toFixed(2)}`;
        if (geometry === geometryRef.current) return;

        geometryRef.current = geometry;
        setLensMap(nextMap);
        // Safari caches SVG filter output aggressively, so geometry updates get a fresh id.
        setFilterVersion((current) => current + 1);
      });
    };

    update();
    const observer = new runtime.ResizeObserver(update);
    observer.observe(element);

    return () => {
      runtime.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const filterId = `liquid-glass-${instanceId}-${filterVersion}`;
  const filterStyle = lensMap
    ? { filter: `url(#${filterId})`, WebkitFilter: `url(#${filterId})` }
    : undefined;

  return (
    <span ref={elementRef} className={`liquid-glass ${className}`.trim()} data-tone={tone}>
      {lensMap ? (
        <svg className="liquid-glass__filter" aria-hidden="true">
          <filter id={filterId} x="-18%" y="-24%" width="136%" height="148%" colorInterpolationFilters="sRGB">
            <feImage href={lensMap.dataUrl} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="displacementMap" />
            <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale={strength} xChannelSelector="R" yChannelSelector="G" result="refracted" />
          </filter>
        </svg>
      ) : null}
      <span className="liquid-glass__refraction" style={filterStyle} aria-hidden="true" />
      <span className="liquid-glass__rim" aria-hidden="true" />
      {children !== undefined ? <span className="liquid-glass__content">{children}</span> : null}
    </span>
  );
}
