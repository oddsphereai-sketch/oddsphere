import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assertMarketBrainEvidenceIdentity,
  type MarketBrainEvidenceIdentity,
} from "./marketBrainEvidenceAttempt";

export const MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE =
  "market_brain_attempt_claim_2026_10_27_r1_leased_due_and_missed" as const;

export type MarketBrainAttemptClaimMode = "due" | "missed_window_reconcile";

export type MarketBrainClaimedAttempt = MarketBrainEvidenceIdentity & Readonly<{
  attemptId: string;
  eventId: string | null;
  plannedAt: string;
  windowOpensAt: string;
  windowClosesAt: string;
  claimRelease: typeof MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE;
  claimToken: string;
  claimMode: MarketBrainAttemptClaimMode;
  claimedBy: string;
  claimedAt: string;
  leaseExpiresAt: string;
  claimSequence: number;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export async function claimDueMarketBrainAttempts(args: {
  client: SupabaseClient;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
  signal?: AbortSignal;
}): Promise<readonly MarketBrainClaimedAttempt[]> {
  return claim(args, "due", "claim_due_market_brain_attempts_v1");
}

export async function claimExpiredMarketBrainAttemptsForReconciliation(args: {
  client: SupabaseClient;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
  signal?: AbortSignal;
}): Promise<readonly MarketBrainClaimedAttempt[]> {
  return claim(args, "missed_window_reconcile", "claim_expired_market_brain_attempts_v1");
}

async function claim(
  args: {
    client: SupabaseClient;
    workerId: string;
    limit?: number;
    leaseSeconds?: number;
    signal?: AbortSignal;
  },
  mode: MarketBrainAttemptClaimMode,
  rpcName: "claim_due_market_brain_attempts_v1" | "claim_expired_market_brain_attempts_v1",
): Promise<readonly MarketBrainClaimedAttempt[]> {
  const limit = args.limit ?? 25;
  const leaseSeconds = args.leaseSeconds ?? 120;
  if (!WORKER.test(args.workerId) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
    throw new Error("Market Brain claim worker, batch limit, or lease duration is invalid.");
  }
  let query = args.client.rpc(rpcName, {
    p_claim_release: MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE,
    p_worker_id: args.workerId,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (args.signal) query = query.abortSignal(args.signal);
  const result = await query;
  if (result.error) throw new Error(`Market Brain ${mode} claim failed: ${result.error.message}`);
  if (!Array.isArray(result.data)) throw new Error(`Market Brain ${mode} claim returned a non-array payload.`);
  return Object.freeze(result.data.map((row) => mapRow(row as Record<string, unknown>, mode, args.workerId)));
}

function mapRow(
  row: Record<string, unknown>,
  mode: MarketBrainAttemptClaimMode,
  workerId: string,
): MarketBrainClaimedAttempt {
  const claim: MarketBrainClaimedAttempt = {
    attemptId: String(row.attempt_id),
    product: String(row.product_key) as MarketBrainClaimedAttempt["product"],
    qualificationScopeKeys: Object.freeze(asStringArray(row.qualification_scope_keys)),
    provider: String(row.provider),
    feed: String(row.feed),
    participant: row.participant === null ? null : String(row.participant),
    eventId: row.event_id === null ? null : String(row.event_id),
    phase: String(row.phase) as MarketBrainClaimedAttempt["phase"],
    plannedAt: normalizeTimestamp(row.planned_at),
    windowOpensAt: normalizeTimestamp(row.window_opens_at),
    windowClosesAt: normalizeTimestamp(row.window_closes_at),
    claimRelease: String(row.claim_release) as typeof MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE,
    claimToken: String(row.claim_token),
    claimMode: String(row.claim_mode) as MarketBrainAttemptClaimMode,
    claimedBy: String(row.claimed_by),
    claimedAt: normalizeTimestamp(row.claimed_at),
    leaseExpiresAt: normalizeTimestamp(row.lease_expires_at),
    claimSequence: Number(row.claim_sequence),
  };
  assertMarketBrainEvidenceIdentity(claim);
  if (!UUID.test(claim.attemptId) || !UUID.test(claim.claimToken) ||
    claim.claimRelease !== MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE || claim.claimMode !== mode ||
    claim.claimedBy !== workerId || !isTimestamp(claim.plannedAt) || !isTimestamp(claim.windowOpensAt) ||
    !isTimestamp(claim.windowClosesAt) || !isTimestamp(claim.claimedAt) || !isTimestamp(claim.leaseExpiresAt) ||
    !Number.isInteger(claim.claimSequence) || claim.claimSequence < 1 ||
    Date.parse(claim.windowOpensAt) > Date.parse(claim.plannedAt) ||
    Date.parse(claim.plannedAt) > Date.parse(claim.windowClosesAt) ||
    Date.parse(claim.claimedAt) >= Date.parse(claim.leaseExpiresAt) ||
    (mode === "due" && (Date.parse(claim.claimedAt) < Date.parse(claim.windowOpensAt) ||
      Date.parse(claim.claimedAt) > Date.parse(claim.windowClosesAt))) ||
    (mode === "missed_window_reconcile" && Date.parse(claim.claimedAt) <= Date.parse(claim.windowClosesAt))) {
    throw new Error("Market Brain claim response violates its frozen source, lease, or window contract.");
  }
  return Object.freeze(claim);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Market Brain claim response has invalid qualification scopes.");
  }
  return [...value];
}

function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function normalizeTimestamp(value: unknown): string {
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error("Market Brain claim response has an invalid timestamp.");
  return new Date(parsed).toISOString();
}
