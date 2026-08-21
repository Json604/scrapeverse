/**
 * Diagnose → heal → VERIFY → approve.
 *
 * The ordering is the entire differentiator, and an earlier draft had it backwards
 * (`heal → run → verify → approve`). `scraper heal` does NOT commit: it halts at an approval gate
 * returning `preview_result`. Running before approving therefore re-runs the UNHEALED collector,
 * fails verification, retries, and quarantines — the loop could never once succeed.
 *
 * Second correction: `preview_result` is a SAMPLE, not a snapshot. Breadth, overlap and canaries
 * are meaningless on a handful of rows, so the preview gate is honestly schema-only and the real
 * gate is the post-approve full run. That makes ROLLBACK the actual safety mechanism, which is why
 * the template is dumped at step 0 before anything mutates.
 */
import type { SourceId, Channel, Snapshot, HealAttempt, HealState, Diagnosis } from "../types.ts";
import type { CollectorAdmin } from "./admin.ts";
import type { ExtractionBackend } from "../backend/types.ts";
import { acquireLease, holdsLease, releaseLease } from "./lease.ts";
import { getAdapter } from "../sources/index.ts";
import { checkSchema } from "../validate/schema.ts";
import { runSource } from "../pipeline.ts";
import { collections } from "../db.ts";
import { uuid, nowIso } from "../util.ts";
import { loadWeights } from "../config.ts";
import { stripPii } from "../sources/types.ts";

export interface HealOptions {
  source: SourceId;
  channel: Channel;
  collectorId: string;
  diagnosis: Diagnosis;
  before: Snapshot;
  admin: CollectorAdmin;
  backend: ExtractionBackend;
  dryRun?: boolean;
}

export interface HealOutcome {
  state: HealState;
  attempt: HealAttempt;
  message: string;
  events: number;
}

export async function healSource(opts: HealOptions): Promise<HealOutcome> {
  const adapter = getAdapter(opts.source);
  const weights = loadWeights();
  const c = await collections();

  // A non-live saga must NEVER lease a live collector: channel isolation in Mongo does not
  // protect shared remote state, and there is no clone command to fall back on.
  if (opts.channel !== "live" && !opts.collectorId.startsWith("fixture") && !opts.collectorId.includes(opts.channel)) {
    throw new Error(
      `refusing to heal collector "${opts.collectorId}" from channel "${opts.channel}": ` +
      `non-live channels require their own collector, or healing would mutate the live one.`,
    );
  }

  const lease = await acquireLease(opts.collectorId, opts.channel);
  if (!lease) throw new Error(`collector ${opts.collectorId} is already being healed (lease held)`);

  const prompt = opts.diagnosis.suggestedHealPrompt.slice(0, weights.healPromptMaxChars);
  const attempt: HealAttempt = {
    attemptId: `heal_${uuid()}`, source: opts.source, channel: opts.channel,
    collectorId: opts.collectorId, state: "proposed",
    triggeredBy: opts.diagnosis, prompt, attempt: 1,
    proposalId: null, priorTemplateRef: null,
    healthBefore: opts.before.health, healthAfter: null,
    previewVerified: false, postVerified: false, at: nowIso(),
  };

  const finish = async (state: HealState, message: string, events = 0): Promise<HealOutcome> => {
    attempt.state = state;
    await c.healLog.updateOne({ attemptId: attempt.attemptId }, { $set: attempt }, { upsert: true });
    await releaseLease(lease);
    return { state, attempt, message, events };
  };

  try {
    // ── step 0: dump the template BEFORE anything mutates ────────────────────
    const template = await opts.admin.dumpTemplate(opts.collectorId);
    const ref = `tmpl_${attempt.attemptId}`;
    await c.rawCaptures.insertOne({ rawRef: ref, kind: "collector_template", collectorId: opts.collectorId, payload: stripPii(template), at: nowIso() });
    attempt.priorTemplateRef = ref;

    if (!prompt) return await finish("rejected", "no actionable diagnosis — nothing to heal");
    if (opts.dryRun) return await finish("proposed", `dry run. prompt (${prompt.length}/${weights.healPromptMaxChars} chars):\n  ${prompt}`);

    // ── steps 3–4: heal, then gate on the preview ────────────────────────────
    const proposal = await opts.admin.heal(opts.collectorId, prompt);
    attempt.proposalId = proposal.proposalId;

    if (proposal.status !== "awaiting_approval") {
      return await finish("rejected", `unexpected heal status "${proposal.status}" — refusing to approve blind`);
    }
    if (!(await holdsLease(lease))) return await finish("rejected", "lease lost during heal — refusing to approve");

    const previewRecords = adapter.normalize(stripPii(proposal.previewResult), nowIso());
    const previewOk = previewGate(previewRecords, adapter, opts.diagnosis);
    attempt.previewVerified = previewOk.ok;

    if (!previewOk.ok) {
      await opts.admin.approve(opts.collectorId, true);   // --reject
      return await finish("rejected", `preview failed schema gate: ${previewOk.reason}. Rejected, collector unchanged.`);
    }

    // ── steps 6–7: approve, then the REAL gate — a full run with full evidence ─
    await opts.admin.approve(opts.collectorId, false);
    attempt.state = "approved";

    const verify = await runSource({
      source: opts.source, channel: opts.channel,
      collectorId: opts.collectorId, backend: opts.backend,
    });
    attempt.healthAfter = verify.snapshot.health;

    /**
     * `calibrating` means "not enough history to classify yet" — it is NOT evidence that the heal
     * worked, and accepting it here let a collector that still returned ZERO ROWS be marked
     * `active`. During calibration we cannot run the full classifier, but we can still demand the
     * things that need no baseline: real rows, valid schema, and no hard signals.
     */
    const h = verify.snapshot.health;
    const extractionSound = h.schemaValid && h.hardSignals.length === 0 && verify.snapshot.records.length > 0;
    const good = verify.snapshot.status === "healthy"
      || (verify.snapshot.status === "calibrating" && extractionSound);
    attempt.postVerified = good;

    if (!good) {
      // ── step 8: rollback ────────────────────────────────────────────────────
      const restored = await rollback(opts, ref);
      return await finish("rolled_back",
        `post-verify FAILED (${verify.snapshot.status}, rows=${verify.snapshot.records.length}: ${verify.snapshot.health.hardSignals[0] ?? "no hard signal but extraction unsound"}). ${restored}`);
    }

    return await finish("active", `healed and verified — status ${verify.snapshot.status}`, verify.eventsWritten);
  } catch (e) {
    await releaseLease(lease).catch(() => {});
    attempt.state = "rejected";
    await c.healLog.updateOne({ attemptId: attempt.attemptId }, { $set: attempt }, { upsert: true }).catch(() => {});
    throw e;
  }
}

/**
 * Honest about what a sample can prove: shape only. Claiming breadth/canary verification on a
 * handful of preview rows would be exactly the kind of unfalsifiable assurance this design rejects.
 */
function previewGate(
  records: ReturnType<ReturnType<typeof getAdapter>["normalize"]>,
  adapter: ReturnType<typeof getAdapter>,
  diagnosis: Diagnosis,
): { ok: boolean; reason: string } {
  if (records.length === 0) return { ok: false, reason: "preview produced zero normalized rows" };

  const relaxed = { ...adapter.expectations, rowRange: [1, adapter.expectations.rowRange[1] * 2] as [number, number] };
  const schema = checkSchema(records, relaxed);
  if (!schema.valid) return { ok: false, reason: schema.problems.join("; ") };

  // The fields we asked it to fix must actually be populated now.
  for (const bf of diagnosis.brokenFields) {
    const cov = schema.coverage[bf.field] ?? 0;
    if (cov < 0.5) return { ok: false, reason: `field "${bf.field}" still only ${(cov * 100).toFixed(0)}% covered in preview` };
  }
  return { ok: true, reason: "preview schema gate passed" };
}

async function rollback(opts: HealOptions, templateRef: string): Promise<string> {
  try {
    await opts.admin.approve(opts.collectorId, true);
    return `rolled back via reject (template ${templateRef} retained).`;
  } catch {
    return `ROLLBACK NEEDS ATTENTION: collector ${opts.collectorId} is on an unverified template. ` +
           `Stored template: ${templateRef}. Recreate with: driftwatch collector create ${opts.source}`;
  }
}

/** Crash recovery: what to do for each state found on restart. */
export const RECOVERY: Record<HealState, string> = {
  proposed: "reject the pending proposal; re-diagnose from a fresh snapshot",
  preview_verified: "reject — approval intent cannot be proven after a crash",
  approved: "run + full evidence check, then activate or roll back",
  post_verified: "mark active; release lease",
  active: "nothing to do",
  rolled_back: "release lease only",
  rejected: "release lease only",
};
