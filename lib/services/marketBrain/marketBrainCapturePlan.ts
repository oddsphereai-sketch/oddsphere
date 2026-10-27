import type { SupabaseClient } from "@supabase/supabase-js";

import { marketBrainCanonicalJson, marketBrainSha256 } from "./marketBrainCanonical";
import {
  assertMarketBrainEvidenceIdentity,
  type MarketBrainEvidenceIdentity,
} from "./marketBrainEvidenceAttempt";

export const MARKET_BRAIN_CAPTURE_PLAN_RELEASE =
  "market_brain_capture_plan_2026_10_27_r1_all_product_precommit" as const;

export const MARKET_BRAIN_CAPTURE_PLAN_MAX_ATTEMPTS = 4_096 as const;

export type MarketBrainPlannedAttempt = MarketBrainEvidenceIdentity & Readonly<{
  attemptId: string;
  eventId: string | null;
  plannedAt: string;
  windowOpensAt: string;
  windowClosesAt: string;
}>;

export type MarketBrainCapturePlanPayload = Readonly<{
  planId: string;
  createdAt: string;
  horizonOpensAt: string;
  horizonClosesAt: string;
  attempts: readonly MarketBrainPlannedAttempt[];
  details: Readonly<Record<string, unknown>>;
}>;

export type MarketBrainCapturePlan = MarketBrainCapturePlanPayload & Readonly<{
  release: typeof MARKET_BRAIN_CAPTURE_PLAN_RELEASE;
  checksum: string;
}>;

export type AttestedMarketBrainCapturePlan = MarketBrainCapturePlan & Readonly<{
  persistenceAttestation: Readonly<{
    serverCreatedAt: string;
    checksum: string;
  }>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createMarketBrainCapturePlan(
  payload: MarketBrainCapturePlanPayload,
): MarketBrainCapturePlan {
  assertPayload(payload);
  const normalized = deepFreeze(structuredClone(payload));
  const plan = Object.freeze({
    release: MARKET_BRAIN_CAPTURE_PLAN_RELEASE,
    ...normalized,
    checksum: marketBrainSha256({ release: MARKET_BRAIN_CAPTURE_PLAN_RELEASE, ...normalized }),
  });
  assertMarketBrainCapturePlan(plan);
  return plan;
}

export function assertMarketBrainCapturePlan(plan: MarketBrainCapturePlan): void {
  const { checksum, ...payload } = plan;
  if (plan.release !== MARKET_BRAIN_CAPTURE_PLAN_RELEASE || checksum !== marketBrainSha256(payload)) {
    throw new Error("Market Brain capture-plan release or checksum is invalid.");
  }
  const { release: _release, ...withoutRelease } = payload;
  assertPayload(withoutRelease);
}

export async function persistMarketBrainCapturePlan(args: {
  client: SupabaseClient;
  plan: MarketBrainCapturePlan;
  signal?: AbortSignal;
}): Promise<AttestedMarketBrainCapturePlan> {
  assertMarketBrainCapturePlan(args.plan);
  const { checksum: _checksum, ...checksumPayload } = args.plan;
  let rpc = args.client.rpc("persist_market_brain_capture_plan_v1", {
    p_plan_payload: args.plan,
    p_plan_payload_text: marketBrainCanonicalJson(args.plan),
    p_checksum_payload_text: marketBrainCanonicalJson(checksumPayload),
    p_plan_checksum: args.plan.checksum,
  });
  if (args.signal) rpc = rpc.abortSignal(args.signal);
  const persisted = await rpc;
  if (persisted.error) {
    throw new Error(`Market Brain capture-plan persistence failed: ${persisted.error.message}`);
  }

  let query = args.client.from("market_brain_capture_plans")
    .select("plan_payload,plan_payload_text,checksum_payload_text,plan_checksum,server_created_at")
    .eq("release", args.plan.release).eq("plan_id", args.plan.planId);
  if (args.signal) query = query.abortSignal(args.signal);
  const stored = await query.maybeSingle();
  if (stored.error || !stored.data) {
    throw new Error(`Market Brain capture-plan attestation failed: ${stored.error?.message ?? "no row returned"}`);
  }
  return attest(stored.data, args.plan);
}

function assertPayload(payload: MarketBrainCapturePlanPayload): void {
  if (!UUID.test(payload.planId) || !isTimestamp(payload.createdAt) ||
    !isTimestamp(payload.horizonOpensAt) || !isTimestamp(payload.horizonClosesAt) ||
    Date.parse(payload.createdAt) > Date.parse(payload.horizonOpensAt) ||
    Date.parse(payload.horizonOpensAt) >= Date.parse(payload.horizonClosesAt) ||
    payload.attempts.length < 1 || payload.attempts.length > MARKET_BRAIN_CAPTURE_PLAN_MAX_ATTEMPTS) {
    throw new Error("Market Brain capture-plan identity, horizon, or bounded size is invalid.");
  }
  const attemptIds = new Set<string>();
  const logicalAttempts = new Set<string>();
  const canonicalKeys: string[] = [];
  for (const attempt of payload.attempts) {
    assertMarketBrainEvidenceIdentity(attempt);
    if (!UUID.test(attempt.attemptId) || !isTimestamp(attempt.plannedAt) ||
      !isTimestamp(attempt.windowOpensAt) || !isTimestamp(attempt.windowClosesAt) ||
      Date.parse(attempt.windowOpensAt) > Date.parse(attempt.plannedAt) ||
      Date.parse(attempt.plannedAt) > Date.parse(attempt.windowClosesAt) ||
      Date.parse(attempt.windowOpensAt) < Date.parse(payload.horizonOpensAt) ||
      Date.parse(attempt.windowClosesAt) > Date.parse(payload.horizonClosesAt)) {
      throw new Error("Market Brain planned-attempt identity or chronology is invalid.");
    }
    const logicalKey = marketBrainCanonicalJson({
      product: attempt.product,
      qualificationScopeKeys: attempt.qualificationScopeKeys,
      provider: attempt.provider,
      feed: attempt.feed,
      participant: attempt.participant,
      eventId: attempt.eventId,
      phase: attempt.phase,
      plannedAt: attempt.plannedAt,
      windowOpensAt: attempt.windowOpensAt,
      windowClosesAt: attempt.windowClosesAt,
    });
    if (attemptIds.has(attempt.attemptId) || logicalAttempts.has(logicalKey)) {
      throw new Error("Market Brain capture plan contains a duplicate attempt identity or obligation.");
    }
    attemptIds.add(attempt.attemptId);
    logicalAttempts.add(logicalKey);
    canonicalKeys.push(`${attempt.plannedAt}\u0000${logicalKey}\u0000${attempt.attemptId}`);
  }
  const sortedKeys = [...canonicalKeys].sort(compareUtf16CodeUnits);
  if (canonicalKeys.some((key, index) => key !== sortedKeys[index])) {
    throw new Error("Market Brain capture-plan attempts must use canonical chronological/source order.");
  }
  // Canonical JSON validates details as a finite, acyclic plain JSON object before persistence.
  marketBrainCanonicalJson(payload.details);
}

function attest(row: Record<string, unknown>, expected: MarketBrainCapturePlan): AttestedMarketBrainCapturePlan {
  const stored = row.plan_payload as MarketBrainCapturePlan;
  const { checksum: _checksum, ...checksumPayload } = expected;
  if (row.plan_checksum !== expected.checksum || row.plan_payload_text !== marketBrainCanonicalJson(expected) ||
    row.checksum_payload_text !== marketBrainCanonicalJson(checksumPayload) ||
    marketBrainCanonicalJson(stored) !== marketBrainCanonicalJson(expected) ||
    !isTimestamp(String(row.server_created_at))) {
    throw new Error("Stored Market Brain capture plan differs from its immutable requested payload.");
  }
  return deepFreeze({ ...structuredClone(stored), persistenceAttestation: Object.freeze({
    serverCreatedAt: String(row.server_created_at), checksum: String(row.plan_checksum),
  }) });
}

function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function compareUtf16CodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
