import { createHash, randomUUID } from "node:crypto";

/** Stable stringify: sorted keys, so a hash never changes because a key moved. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(input: string, len = 12): string {
  return sha256(input).slice(0, len);
}

export const uuid = (): string => randomUUID();

export function nowIso(): string { return new Date().toISOString(); }

/** Jaccard similarity of two sets. 1 = identical membership, 0 = disjoint. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))));
  return s[i]!;
}

/** Parse "12,345" / "1.2k" / "3 stars today" → number. Returns null when there is no number. */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const m = cleaned.match(/(-?\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") return n * 1_000;
  if (suffix === "m") return n * 1_000_000;
  return n;
}

export function normalizeUrl(raw: string, base?: string): string {
  try {
    const u = new URL(raw, base);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|source$)/i.test(p)) u.searchParams.delete(p);
    }
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch { return raw; }
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
