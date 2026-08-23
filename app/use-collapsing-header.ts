"use client";

import { useEffect, useRef, useState } from "react";

interface HeaderObserver {
  observe(target: HTMLSpanElement): void;
  disconnect(): void;
}

interface HeaderObserverRuntime {
  IntersectionObserver?: new (
    callback: (entries: readonly { isIntersecting: boolean }[]) => void,
    options?: { threshold?: number },
  ) => HeaderObserver;
}

export function useCollapsingHeader() {
  const [headerCompact, setHeaderCompact] = useState(false);
  const headerSentinelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const sentinel = headerSentinelRef.current;
    const Observer = (globalThis as unknown as HeaderObserverRuntime).IntersectionObserver;
    if (!sentinel || !Observer) return;

    const observer = new Observer((entries) => {
      const entry = entries[0];
      if (entry) setHeaderCompact(!entry.isIntersecting);
    }, { threshold: 0 });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return { headerCompact, headerSentinelRef };
}
