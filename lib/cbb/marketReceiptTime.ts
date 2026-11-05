import type { CbbCanonicalReceipt } from "./types";

type Receipt = { fetchedAt: string; requestedAt?:string; canonicalReceipt?: CbbCanonicalReceipt };

/** PostgreSQL clocks may retain microseconds. Date.parse truncates those;
 * an availability upper bound must round outward, never become earlier. */
export function cbbAvailabilityUpperBoundMs(value:string){
  const parsed=Date.parse(value);
  const subMillisecond=value.match(/\.\d{3}(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1];
  return parsed+(subMillisecond&&/[1-9]/.test(subMillisecond)?1:0);
}

/** Do not silently turn a collector-start clock into response completion. */
export function cbbEvidenceReceiptBounds(value: Receipt) {
  const completed=Date.parse(value.fetchedAt), earliest=value.requestedAt===undefined?completed:Date.parse(value.requestedAt),source=value.canonicalReceipt;
  if(!Number.isFinite(earliest)||!Number.isFinite(completed)||earliest>completed)return {earliest:NaN,available:NaN,kind:"response_completed" as const};
  if (!source) return { earliest, available: completed, kind: "response_completed" as const };
  const available = typeof source.availableBy==="string"?cbbAvailabilityUpperBoundMs(source.availableBy):NaN;
  if (typeof source !== "object" || source.kind !== "db_inserted_upper_bound" || !Number.isFinite(earliest) ||
    !Number.isFinite(available) || available < completed || typeof source.providerEventId !== "string" || !source.providerEventId || source.providerEventId.length > 256 ||
    typeof source.ingestionRunId !== "string" || !source.ingestionRunId || source.ingestionRunId.length > 160 || !Array.isArray(source.observationIds) || source.observationIds.length !== 2 ||
    !source.observationIds.every(id => Number.isSafeInteger(id) && id > 0) ||
    source.observationIds[0] === source.observationIds[1] || !Array.isArray(source.rawPayloadHashes) || source.rawPayloadHashes.length !== 2 ||
    !source.rawPayloadHashes.every(hash => /^[a-f0-9]{64}$/i.test(hash))) {
    return { earliest: NaN, available: NaN, kind: "db_inserted_upper_bound" as const };
  }
  return { earliest, available, kind: "db_inserted_upper_bound" as const };
}

export const cbbEvidenceAvailableAt = (value: Receipt) => cbbEvidenceReceiptBounds(value).available;

/** A before-window upper bound must precede the next window's lower bound.
 * Insertion order inside one concurrent collection run proves no response order. */
export function cbbEvidenceProvablyBefore(first: Receipt, second: Receipt) {
  const a = cbbEvidenceReceiptBounds(first), b = cbbEvidenceReceiptBounds(second);
  return Number.isFinite(a.available) && Number.isFinite(b.earliest) && a.available <= b.earliest;
}
