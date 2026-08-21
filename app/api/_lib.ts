import { NextResponse } from "next/server";

/** Read-only API over the versioned store. The CLI owns ingestion; this only serves. */
export function ok(data: unknown, seconds = 30): NextResponse {
  return NextResponse.json(data, {
    headers: { "cache-control": `s-maxage=${seconds}, stale-while-revalidate=300` },
  });
}

export function fail(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function num(v: string | null, dflt: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : dflt;
}
