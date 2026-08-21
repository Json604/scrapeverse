/**
 * Row-count expectations are a property of the CHANNEL, not just the source.
 *
 * A 2025 GitHub Trending capture legitimately carries ~15 rows where today's live page carries ~25.
 * Applying the live rowRange to a replay channel marks genuinely-fine archived pages `broken`,
 * which is the exact false positive this project exists to avoid.
 */
import type { Channel, SourceExpectations, Baseline } from "../types.ts";

export function expectationsFor(
  base: SourceExpectations, channel: Channel, baseline: Baseline | null,
): SourceExpectations {
  if (channel === "live") return base;

  // Once the channel has its own healthy history, its size band comes from that history.
  if (baseline && baseline.rowCountMean > 0) {
    const spread = Math.max(3, baseline.rowCountStd * 3);
    return {
      ...base,
      rowRange: [
        Math.max(3, Math.floor(baseline.rowCountMean - spread)),
        Math.ceil(baseline.rowCountMean + spread),
      ],
    };
  }

  // Before that, stay deliberately wide: we are still learning what this era looks like.
  return { ...base, rowRange: [3, base.rowRange[1] * 3] };
}
