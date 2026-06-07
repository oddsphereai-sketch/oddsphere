/**
 * Phase 7A Stage 2 — Context flag extraction + per-flag analysis.
 *
 * Pure module. Given a prediction_records row (with its snapshot_json),
 * returns a tri-state value per known flag:
 *
 *   "yes"     — flag confirmed present
 *   "no"      — flag confirmed absent
 *   "unknown" — the data needed to determine the flag isn't in the snapshot
 *
 * The "unknown" case is load-bearing: it lets the Stage 2 report be honest
 * about WHICH context flags the current snapshot supports vs WHICH dimensions
 * are missing (e.g., public-money % isn't currently captured in
 * snapshot_json; the report flags this as a data-availability gap).
 *
 * No DB. No I/O. Stage 2 is read-only.
 *
 * Adding a flag:
 *   1. Add an entry to CONTEXT_FLAG_DEFINITIONS with id, label, scope (which
 *      markets it applies to), and an extract(record) function returning
 *      "yes" | "no" | "unknown".
 *   2. The report and tests pick it up automatically.
 */

import type { PredictionRecordRow } from "../types/domain/Tracking";

export type ContextFlagState = "yes" | "no" | "unknown";

/** Which markets a flag is meaningful for. */
export type ContextFlagScope = "all" | "moneyline" | "total" | "first_inning";

export type ContextFlagDefinition = {
  id: string;
  /** Human-friendly label. */
  label: string;
  scope: ContextFlagScope;
  /**
   * What the flag means in calibration terms. Shown in the report so the
   * operator doesn't need to remember each flag's semantics.
   */
  description: string;
  /** Pure extractor over a single record. Must not throw. */
  extract: (record: PredictionRecordRow) => ContextFlagState;
};

/* ── path helpers — defensive against missing keys ────────────────── */

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function getPath(root: unknown, ...keys: string[]): unknown {
  let cur: unknown = root;
  for (const k of keys) {
    const obj = asObject(cur);
    if (obj === null) return undefined;
    cur = obj[k];
  }
  return cur;
}

function boolState(v: unknown, truthyIsYes: boolean = true): ContextFlagState {
  if (v === undefined || v === null) return "unknown";
  if (typeof v !== "boolean") return "unknown";
  const isYes = truthyIsYes ? v === true : v === false;
  return isYes ? "yes" : "no";
}

function numericPositive(v: unknown): ContextFlagState {
  if (v === undefined || v === null) return "unknown";
  if (typeof v !== "number" || !Number.isFinite(v)) return "unknown";
  return v > 0 ? "yes" : "no";
}

function stringEquals(v: unknown, target: string): ContextFlagState {
  if (v === undefined || v === null) return "unknown";
  if (typeof v !== "string") return "unknown";
  return v === target ? "yes" : "no";
}

/* ── Flag definitions ─────────────────────────────────────────────── */

export const CONTEXT_FLAG_DEFINITIONS: ContextFlagDefinition[] = [
  // Top-level snapshot booleans
  {
    id: "starter_unconfirmed",
    label: "Starter not confirmed at lock time",
    scope: "all",
    description:
      "starter_confirmed=false in the locked snapshot. Indicates one or both probable starters were unconfirmed when the pick was locked.",
    extract: (r) => boolState(getPath(r.snapshot_json, "starter_confirmed"), false),
  },
  {
    id: "lineup_unconfirmed",
    label: "Lineup not confirmed at lock time",
    scope: "all",
    description:
      "lineup_confirmed=false in the locked snapshot. Picks made without confirmed lineups carry extra feature uncertainty.",
    extract: (r) => boolState(getPath(r.snapshot_json, "lineup_confirmed"), false),
  },
  {
    id: "market_line_missing",
    label: "Market line unavailable at lock time",
    scope: "all",
    description:
      "market_line_available=false in the locked snapshot. The market-baseline pillar was absent when the pick was generated.",
    extract: (r) => boolState(getPath(r.snapshot_json, "market_line_available"), false),
  },
  {
    id: "stale_data",
    label: "Locked snapshot flagged stale",
    scope: "all",
    description: "stale=true in the locked snapshot (e.g., upstream data older than the freshness window).",
    extract: (r) => boolState(getPath(r.snapshot_json, "stale"), true),
  },
  {
    id: "provisional_pick",
    label: "Provisional pick",
    scope: "all",
    description:
      "Top-level provisional column OR snapshot_json.v2_provisional. Picks generated before the safety-gate confirmation window.",
    extract: (r) => {
      const top = r.provisional === true ? true : r.provisional === false ? false : null;
      if (top !== null) return top ? "yes" : "no";
      const snap = getPath(r.snapshot_json, "v2_provisional");
      return boolState(snap, true);
    },
  },
  {
    id: "opposing_deterministic_warning",
    label: "Opposing-deterministic warning raised",
    scope: "all",
    description:
      "opposing_deterministic_warning=true in the locked snapshot — model output disagrees with a deterministic check.",
    extract: (r) => boolState(getPath(r.snapshot_json, "opposing_deterministic_warning"), true),
  },
  {
    id: "data_quality_low",
    label: "Data quality tier = low",
    scope: "all",
    description: "v2_data_quality_tier='low' (or fi_v2_audit.data_quality_tier='low' for FI rows).",
    extract: (r) => {
      const top = stringEquals(getPath(r.snapshot_json, "v2_data_quality_tier"), "low");
      if (top !== "unknown") return top;
      return stringEquals(getPath(r.snapshot_json, "fi_v2_audit", "data_quality_tier"), "low");
    },
  },
  {
    id: "data_quality_high",
    label: "Data quality tier = high",
    scope: "all",
    description: "v2_data_quality_tier='high' (or fi_v2_audit.data_quality_tier='high' for FI rows).",
    extract: (r) => {
      const top = stringEquals(getPath(r.snapshot_json, "v2_data_quality_tier"), "high");
      if (top !== "unknown") return top;
      return stringEquals(getPath(r.snapshot_json, "fi_v2_audit", "data_quality_tier"), "high");
    },
  },
  // v2_2_audit sub-object — ML / OU specific
  {
    id: "model_capped_by_total",
    label: "v2.2 posterior capped by total",
    scope: "all",
    description:
      "v2_2_audit.capped_by_total=true — the model's full-game total estimate was constrained by the cap.",
    extract: (r) => boolState(getPath(r.snapshot_json, "v2_2_audit", "capped_by_total"), true),
  },
  {
    id: "model_capped_by_diff",
    label: "v2.2 posterior capped by diff",
    scope: "all",
    description: "v2_2_audit.capped_by_diff=true — the model's home/away diff was constrained.",
    extract: (r) => boolState(getPath(r.snapshot_json, "v2_2_audit", "capped_by_diff"), true),
  },
  {
    id: "market_baseline_invalid",
    label: "Market baseline invalid",
    scope: "all",
    description:
      "v2_2_audit.market_baseline_valid=false. No-vig pair de-vig failed; market baseline pillar disabled.",
    extract: (r) => boolState(getPath(r.snapshot_json, "v2_2_audit", "market_baseline_valid"), false),
  },
  {
    id: "trust_independent",
    label: "Trusted independent over market",
    scope: "all",
    description:
      "v2_2_audit.trust_independent=true OR fi_v2_audit.trust_independent=true. Model overrode market baseline.",
    extract: (r) => {
      const v22 = getPath(r.snapshot_json, "v2_2_audit", "trust_independent");
      if (typeof v22 === "boolean") return v22 ? "yes" : "no";
      const fi = getPath(r.snapshot_json, "fi_v2_audit", "trust_independent");
      if (typeof fi === "boolean") return fi ? "yes" : "no";
      return "unknown";
    },
  },
  // auto_factors sub-object
  {
    id: "ml_dampening_applied",
    label: "ML model dampening applied",
    scope: "moneyline",
    description:
      "auto_factors.ml_dampening_penalty > 0 — the V2.2 ML pillar applied a dampening penalty.",
    extract: (r) => numericPositive(getPath(r.snapshot_json, "auto_factors", "ml_dampening_penalty")),
  },
  {
    id: "ou_dampening_applied",
    label: "O/U model dampening applied",
    scope: "total",
    description: "auto_factors.ou_dampening_penalty > 0.",
    extract: (r) => numericPositive(getPath(r.snapshot_json, "auto_factors", "ou_dampening_penalty")),
  },
  {
    id: "stage_confidence_capped",
    label: "Stage confidence cap applied",
    scope: "all",
    description:
      "auto_factors.stage_confidence_cap was set (raw confidence exceeded the per-stage cap).",
    extract: (r) => {
      const v = getPath(r.snapshot_json, "auto_factors", "stage_confidence_cap");
      if (v === undefined || v === null) return "unknown";
      if (typeof v !== "number" || !Number.isFinite(v)) return "unknown";
      // Convention: cap field carries the cap VALUE when applied, undefined when not.
      return v > 0 && v < 100 ? "yes" : "no";
    },
  },
  // FI-specific
  {
    id: "nrfi_used_fallback_era",
    label: "NRFI used fallback ERA",
    scope: "first_inning",
    description: "auto_factors.nrfi_used_fallback_era=true — first-inning ERA estimate used league fallback.",
    extract: (r) => boolState(getPath(r.snapshot_json, "auto_factors", "nrfi_used_fallback_era"), true),
  },
  {
    id: "fi_posterior_capped",
    label: "FI posterior capped",
    scope: "first_inning",
    description: "fi_v2_audit.posterior_capped=true — FI posterior probability was constrained.",
    extract: (r) => boolState(getPath(r.snapshot_json, "fi_v2_audit", "posterior_capped"), true),
  },
  // Review layer
  {
    id: "review_logic_audit_failed",
    label: "Review logic audit failed",
    scope: "all",
    description: "review_v1.logic_audit_passed=false — the reviewer detected a logic inconsistency.",
    extract: (r) => boolState(getPath(r.snapshot_json, "review_v1", "logic_audit_passed"), false),
  },
];

/**
 * Dimensions the user listed for Stage 2 that are NOT currently captured in
 * `snapshot_json`. The report surfaces this explicitly so we know what to
 * add to the lock-time snapshot before those dimensions can become
 * actionable calibration inputs.
 */
export const MISSING_DIMENSIONS: Array<{ id: string; label: string; reason: string }> = [
  {
    id: "public_money_pct",
    label: "Public money % (picked side)",
    reason:
      "Not captured in snapshot_json. Available in sharp_signals at lock time but not currently snapshotted onto prediction_records. Required to analyze 'public-money conflict' vs 'public-money support' calibration cuts.",
  },
  {
    id: "line_movement_direction",
    label: "Line movement toward/against pick",
    reason:
      "Not captured in snapshot_json as a discrete signal. v2_2_audit.posterior_moved_runs_from_market captures the model's shift from market, not the line's drift over time. Required to analyze 'sharp-money confirmation' calibration cuts.",
  },
  {
    id: "bullpen_fallback",
    label: "Bullpen fallback used",
    reason:
      "No explicit boolean. auto_factors.{home,away}_bullpen_factor carries the value but doesn't surface whether the value came from a real bullpen stat row vs a league-average fallback.",
  },
];

/** Extract every flag's tri-state value for a single record. */
export function extractContextFlags(record: PredictionRecordRow): Record<string, ContextFlagState> {
  const out: Record<string, ContextFlagState> = {};
  for (const def of CONTEXT_FLAG_DEFINITIONS) {
    out[def.id] = def.extract(record);
  }
  return out;
}
