"use client";

import { ArrowLeft } from "lucide-react";
import { LiquidGlass } from "./liquid-glass.tsx";
import { useCollapsingHeader } from "./use-collapsing-header.ts";

export function ExplorerHeader({ label }: { label: string }) {
  const { headerCompact, headerSentinelRef } = useCollapsingHeader();

  return (
    <>
      <span ref={headerSentinelRef} className="header-collapse-sentinel" aria-hidden="true" />
      <header className={`explorer-nav glass-control ${headerCompact ? "explorer-nav--compact" : ""}`}>
        <a className="brand" href="/" aria-label="Driftwatch home">driftwatch</a>
        <span className="explorer-nav__label">{label}</span>
        <a className="explorer-back pressable glass-button" href="/">
          <LiquidGlass tone="dark"><ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />Back home</LiquidGlass>
        </a>
      </header>
    </>
  );
}
