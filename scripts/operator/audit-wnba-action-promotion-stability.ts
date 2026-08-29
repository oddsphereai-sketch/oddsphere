/**
 * SELECT-only WNBA action-promotion chronology audit.
 *
 * This script never calls a provider, cron, model, writer, RPC, insert, update,
 * upsert, or delete. It summarizes only evidence already captured by the
 * authoritative natural WNBA writer.
 */
import { supabase } from "../../lib/db/supabase";
import {
  WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION,
  WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC,
  WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES,
  WNBA_ACTION_PROMOTION_EVIDENCE_KEY,
  WNBA_ACTION_PROMOTION_EVIDENCE_MAX_BYTES,
  WNBA_ACTION_PROMOTION_EVIDENCE_MAX_OBSERVATIONS,
} from "../../lib/services/wnba/buildWnbaPredictionRecords";

type Observation = {
  cycle_id?: unknown;
  grade?: unknown;
  actionable?: unknown;
  economic_equivalence_key?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function observations(snapshot: unknown): Observation[] {
  const evidence = object(object(snapshot)[WNBA_ACTION_PROMOTION_EVIDENCE_KEY]);
  return evidence.contract_version === WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION &&
      evidence.mode === "shadow_only" &&
      evidence.production_gate_enabled === false &&
      Array.isArray(evidence.observations)
    ? evidence.observations.map((value) => object(value))
    : [];
}

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id, game_id, external_id, slate_date, market, play_grade, locked_at, snapshot_json")
    .eq("sport", "wnba")
    .order("slate_date", { ascending: true })
    .limit(10_000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const evidenceRows = rows
    .map((row) => ({ row, observations: observations(row.snapshot_json) }))
    .filter((entry) => entry.observations.length > 0);
  let directCliffs = 0;
  let nonactionToAction = 0;
  let actionToNonaction = 0;
  let economicResets = 0;
  let duplicateCycles = 0;
  let outOfOrderCycles = 0;
  for (const entry of evidenceRows) {
    const seenCycles = new Set<string>();
    let previousCycleMs = Number.NEGATIVE_INFINITY;
    let prior: Observation | null = null;
    let priorPrior: Observation | null = null;
    for (const current of entry.observations) {
      const cycleId = typeof current.cycle_id === "string" ? current.cycle_id : "";
      const cycleMs = Date.parse(cycleId);
      if (seenCycles.has(cycleId)) duplicateCycles += 1;
      seenCycles.add(cycleId);
      if (!Number.isFinite(cycleMs) || cycleMs <= previousCycleMs) outOfOrderCycles += 1;
      previousCycleMs = Math.max(previousCycleMs, cycleMs);
      if (prior) {
        if (prior.actionable === false && current.actionable === true) nonactionToAction += 1;
        if (prior.actionable === true && current.actionable === false) actionToNonaction += 1;
        if (prior.economic_equivalence_key !== current.economic_equivalence_key) economicResets += 1;
      }
      if (priorPrior?.actionable === false && prior?.actionable === true && current.actionable === false) {
        directCliffs += 1;
      }
      priorPrior = prior;
      prior = current;
    }
  }
  const currentGradeCounts: Record<string, number> = {};
  for (const row of rows.filter((value) => value.locked_at == null)) {
    const key = `${row.market}:${row.play_grade ?? "missing"}`;
    currentGradeCounts[key] = (currentGradeCounts[key] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    mode: "select_only",
    production_gate_enabled: false,
    contract_version: WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION,
    bounds: {
      max_observations_per_market: WNBA_ACTION_PROMOTION_EVIDENCE_MAX_OBSERVATIONS,
      max_bytes_per_market: WNBA_ACTION_PROMOTION_EVIDENCE_MAX_BYTES,
      cadence_interval_minutes: WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES,
      cadence_anchor_minute_utc: WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC,
    },
    coverage: {
      prediction_records: rows.length,
      evidence_rows: evidenceRows.length,
      observations: evidenceRows.reduce((sum, entry) => sum + entry.observations.length, 0),
      first_cycle: evidenceRows.flatMap((entry) => entry.observations)
        .map((entry) => entry.cycle_id).filter((value): value is string => typeof value === "string").sort()[0] ?? null,
      last_cycle: evidenceRows.flatMap((entry) => entry.observations)
        .map((entry) => entry.cycle_id).filter((value): value is string => typeof value === "string").sort().at(-1) ?? null,
    },
    integrity: { duplicate_cycles: duplicateCycles, out_of_order_cycles: outOfOrderCycles },
    transitions: {
      nonaction_to_action: nonactionToAction,
      action_to_nonaction: actionToNonaction,
      direct_nonaction_action_nonaction_cliffs: directCliffs,
      economic_identity_resets: economicResets,
    },
    current_unlocked_grade_counts: currentGradeCounts,
    board_impact: { grades: 0, probabilities: 0, sides: 0, stakes: 0 },
  }, null, 2));
}

void main();
