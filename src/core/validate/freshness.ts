/**
 * Transport freshness is NOT semantic equality.
 *
 * An earlier draft defined `stale` as "payload hash unchanged", which is wrong in both directions:
 * a quiet StackShare day is byte-identical and completely honest, while a payload carrying a job id
 * never repeats. Conflating them froze quiet sources and deadlocked calibration.
 */
import type { Snapshot, TransportMeta } from "../types.ts";

export interface FreshnessVerdict {
  stale: boolean;
  payloadUnchanged: boolean;
  refetched: boolean;
  reason: string;
}

export function assessFreshness(
  transport: TransportMeta,
  currentPayloadHash: string,
  previous: Snapshot | null,
): FreshnessVerdict {
  const payloadUnchanged = previous?.provenance.payloadHash === currentPayloadHash;
  const refetched = transport.refetched && transport.providerJobId !== previous?.provenance.transport.providerJobId;

  if (!payloadUnchanged) {
    return { stale: false, payloadUnchanged: false, refetched, reason: "payload changed" };
  }
  if (refetched) {
    // Fresh fetch, identical records = a normal quiet day. Healthy, zero events, no alert.
    return { stale: false, payloadUnchanged: true, refetched: true, reason: "fresh fetch, unchanged payload (quiet source)" };
  }
  return {
    stale: true, payloadUnchanged: true, refetched: false,
    reason: "payload unchanged AND transport indicates no refetch",
  };
}
