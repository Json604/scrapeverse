/**
 * Collector administration. `create` / `heal` / `approve` are CLI-only on Scraper Studio, so this
 * shells out to the official `brightdata` CLI and keeps it behind an interface for testability.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export interface HealProposal {
  collectorId: string;
  status: string;                  // "awaiting_approval" on the normal path
  previewResult: Array<Record<string, unknown>>;
  proposalId: string | null;
  diffSummary: string | null;
  raw: unknown;
}

export interface CollectorAdmin {
  create(url: string, description: string, name: string): Promise<{ collectorId: string }>;
  dumpTemplate(collectorId: string): Promise<unknown>;
  heal(collectorId: string, prompt: string): Promise<HealProposal>;
  approve(collectorId: string, reject?: boolean): Promise<{ status: string }>;
}

async function bd(args: string[], timeoutMs = 900_000): Promise<unknown> {
  try {
    const { stdout } = await exec("brightdata", args, {
      timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env },
    });
    const trimmed = stdout.trim();
    const start = trimmed.search(/[[{]/);
    return start >= 0 ? JSON.parse(trimmed.slice(start)) : { raw: trimmed };
  } catch (e) {
    const err = e as { code?: string; stderr?: string; message?: string };
    if (err.code === "ENOENT") {
      throw new Error(
        "the `brightdata` CLI is not installed. Install it with:\n" +
        "  npm install -g @brightdata/cli   (or: curl -fsSL https://cli.brightdata.com/install.sh | sh)\n" +
        "then authenticate with BRIGHTDATA_API_KEY or `brightdata login`.",
      );
    }
    throw new Error(`brightdata ${args[0]} ${args[1] ?? ""} failed: ${err.stderr ?? err.message}`);
  }
}

export class CliCollectorAdmin implements CollectorAdmin {
  async create(url: string, description: string, name: string) {
    const out = (await bd(["scraper", "create", url, description, "--name", name])) as { collector_id?: string };
    if (!out.collector_id) throw new Error(`create returned no collector_id: ${JSON.stringify(out).slice(0, 200)}`);
    return { collectorId: out.collector_id };
  }

  /** Dumped BEFORE any heal — without this there is no rollback path at all. */
  async dumpTemplate(collectorId: string): Promise<unknown> {
    try { return await bd(["scraper", "get", collectorId]); }
    catch { return { note: "template dump unsupported by this CLI version", collectorId }; }
  }

  async heal(collectorId: string, prompt: string): Promise<HealProposal> {
    // NO --auto-approve, ever: that surrenders the verification gate that is the whole point.
    const out = (await bd(["scraper", "heal", collectorId, prompt])) as Record<string, unknown>;
    return {
      collectorId,
      status: String(out["status"] ?? "unknown"),
      previewResult: (out["preview_result"] as Array<Record<string, unknown>>) ?? [],
      proposalId: (out["proposal_id"] ?? out["job_id"] ?? null) as string | null,
      diffSummary: (out["diff_summary"] ?? null) as string | null,
      raw: out,
    };
  }

  async approve(collectorId: string, reject = false) {
    // `--auto-save` is what actually activates the healed template. `approve` without it
    // reports status: done and leaves the old steps live — verified on GitHub Trending.
    const args = [
      "scraper", "approve", collectorId,
      ...(reject ? ["--reject"] : ["--auto-save"]),
    ];
    const out = (await bd(args)) as { status?: string };
    return { status: String(out.status ?? (reject ? "rejected" : "done")) };
  }
}
