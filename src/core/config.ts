/**
 * Environment + tunables.
 * every threshold lives in a versioned weights file, fit from data — never hand-typed inline.
 */
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load local env files for the CLI only.
 *
 * Skipped under Next's server runtimes: Vercel injects env vars directly, and a dynamic
 * `resolve(process.cwd(), …)` makes the build tracer pull the ENTIRE project into the serverless
 * bundle ("this filesystem access causes the whole project to be traced"), which bloats deploys
 * and can trip size limits.
 */
if (!process.env["NEXT_RUNTIME"] && process.env["DRIFTWATCH_SKIP_ENV_FILES"] !== "1") {
  // Later files win only for keys not already set, so real env vars always take precedence.
  for (const f of ["atlas-credentials.env", ".env.local", ".env"]) {
    const p = resolve(/* turbopackIgnore: true */ process.cwd(), f);
    if (existsSync(p)) loadEnv({ path: p, override: false, quiet: true });
  }
}

export const DEFAULT_DB_NAME = "driftwatch";

/** Atlas onboarding emits a URI with no database and no options. Normalize both. */
export function normalizeMongoUri(uri: string, dbName = DEFAULT_DB_NAME): string {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    throw new Error(`MONGODB_URI is not a valid URI: ${uri.slice(0, 24)}…`);
  }
  if (u.pathname === "" || u.pathname === "/") u.pathname = `/${dbName}`;
  if (!u.searchParams.has("retryWrites")) u.searchParams.set("retryWrites", "true");
  if (!u.searchParams.has("w")) u.searchParams.set("w", "majority");
  return u.toString();
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing ${name}. Add it to atlas-credentials.env or .env.local ` +
        `(see .env.example). Never commit that file.`,
    );
  }
  return v.trim();
}

function optional(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : null;
}

export const config = {
  get mongoUri(): string {
    return normalizeMongoUri(required("MONGODB_URI"), this.dbName);
  },
  get dbName(): string {
    return optional("DRIFTWATCH_DB") ?? DEFAULT_DB_NAME;
  },
  /** Only needed from milestone 2 onward — milestone 1 runs against Atlas alone. */
  get brightDataKey(): string {
    return required("BRIGHTDATA_API_KEY");
  },
  get brightDataKeyOptional(): string | null {
    return optional("BRIGHTDATA_API_KEY");
  },
  get llmProvider(): string {
    return optional("DRIFTWATCH_LLM_PROVIDER") ?? "anthropic";
  },
  get llmModel(): string | null {
    return optional("DRIFTWATCH_LLM_MODEL");
  },
} as const;

/**
 * Tunables. Defaults are STARTING POINTS to be refit from the eval set and from each
 * source's own healthy history — they are deliberately not presented as calibrated truth.
 */
export interface Weights {
  version: string;
  /** Breadth bands: sparse ⇒ content change, universal ⇒ structure. */
  breadthContentMax: number;
  breadthStructureMin: number;
  /** Row-wise field-confusion threshold. */
  confusionFlag: number;
  /** Hard signal: coverage collapse. */
  coverageCollapse: number;
  coverageWarn: number;
  /** Same soft signal N runs in a row escalates to broken. */
  softEscalationRuns: number;
  /** Consecutive runs required before a baseline may be signed. */
  calibrationRuns: number;
  calibrationMinCoverage: number;
  /** Overlap needs this many healthy samples in a bucket before it is anything but informational. */
  overlapMinSamples: number;
  /** Candidate expiry. */
  candidateTtlRuns: number;
  /** Hard API cap on the heal prompt. */
  healPromptMaxChars: number;
  maxHealAttempts: number;
  /** Rolling baseline window. */
  baselineWindow: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  version: "0.1.0-uncalibrated",
  breadthContentMax: 0.25,
  breadthStructureMin: 0.6,
  confusionFlag: 0.6,
  coverageCollapse: 0.6,
  coverageWarn: 0.9,
  softEscalationRuns: 3,
  calibrationRuns: 3,
  calibrationMinCoverage: 0.9,
  overlapMinSamples: 10,
  candidateTtlRuns: 5,
  healPromptMaxChars: 1000,
  maxHealAttempts: 3,
  baselineWindow: 10,
};

export function loadWeights(): Weights {
  const p = resolve(process.cwd(), "config", "weights.json");
  if (!existsSync(p)) return DEFAULT_WEIGHTS;
  return { ...DEFAULT_WEIGHTS, ...JSON.parse(readFileSync(p, "utf8")) };
}
