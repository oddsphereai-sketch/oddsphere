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

/**
 * Phase 6B.22 — picked-side vs opposite-side public money / bets are
 * captured in snapshot_json.public_splits. Sources:
 *   snapshot_json.public_splits.conflict       (true | false | null)
 *   snapshot_json.public_splits.support        (true | false | null)
 * null means data not available on this row (sharp_signals had no
 * pair for the picked side at lock time).
 */
function publicSplitsField(
  r: PredictionRecordRow,
  field: "conflict" | "support",
): ContextFlagState {
  const ps = getPath(r.snapshot_json, "public_splits");
  if (!asObject(ps)) return "unknown";
  const v = (ps as Record<string, unknown>)[field];
  if (v === true) return "yes";
  if (v === false) return "no";
  return "unknown";
}

/**
 * Phase 6B.22 — line-movement direction relative to picked side from
 * snapshot_json.line_movement.direction ∈ {toward_pick, against_pick,
 * neutral, unknown}.
 */
function lineMovementDirection(
  r: PredictionRecordRow,
  target: "toward_pick" | "against_pick",
): ContextFlagState {
  const lm = getPath(r.snapshot_json, "line_movement");
  if (!asObject(lm)) return "unknown";
  const dir = (lm as Record<string, unknown>).direction;
  if (typeof dir !== "string") return "unknown";
  if (dir === "unknown") return "unknown";
  if (dir === target) return "yes";
  return "no";
}

/**
 * Phase 6B.22 — data-integrity tri-state flags from snapshot_json.data_integrity.
 */
function dataIntegrityField(
  r: PredictionRecordRow,
  field: string,
): ContextFlagState {
  const di = getPath(r.snapshot_json, "data_integrity");
  if (!asObject(di)) return "unknown";
  const v = (di as Record<string, unknown>)[field];
  if (v === "yes") return "yes";
  if (v === "no") return "no";
  return "unknown";
}

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

  // ── Phase 6B.22 — public splits + line movement + data integrity ────
  {
    id: "public_money_conflict",
    label: "Public-money conflict (opposite side has high money / low bets)",
    scope: "moneyline",
    description:
      "snapshot_json.public_splits.conflict — the opposite side has ≥60% public money but materially lower bet share (≥15pp gap), the classic sharp-fade pattern.",
    extract: (r) => publicSplitsField(r, "conflict"),
  },
  {
    id: "public_money_support",
    label: "Public-money support (picked side has high money / low bets)",
    scope: "moneyline",
    description:
      "snapshot_json.public_splits.support — picked side has ≥60% public money but materially lower bet share, the classic sharp-money signal in our favor.",
    extract: (r) => publicSplitsField(r, "support"),
  },
  {
    id: "public_money_conflict_total",
    label: "Public-money conflict (total — opposite side)",
    scope: "total",
    description: "Same as public_money_conflict but scoped to the over/under market.",
    extract: (r) => publicSplitsField(r, "conflict"),
  },
  {
    id: "public_money_support_total",
    label: "Public-money support (total — picked side)",
    scope: "total",
    description: "Same as public_money_support but scoped to the over/under market.",
    extract: (r) => publicSplitsField(r, "support"),
  },
  {
    id: "line_moved_toward_pick",
    label: "Line moved toward the picked side",
    scope: "all",
    description:
      "snapshot_json.line_movement.direction === 'toward_pick'. Picked-side implied probability rose between opener and lock.",
    extract: (r) => lineMovementDirection(r, "toward_pick"),
  },
  {
    id: "line_moved_against_pick",
    label: "Line moved against the picked side",
    scope: "all",
    description:
      "snapshot_json.line_movement.direction === 'against_pick'. Picked-side implied probability fell between opener and lock.",
    extract: (r) => lineMovementDirection(r, "against_pick"),
  },
  {
    id: "steam_on_picked_side",
    label: "Steam move on picked side",
    scope: "all",
    description: "snapshot_json.line_movement.has_steam_move === true for the picked side.",
    extract: (r) => {
      const lm = getPath(r.snapshot_json, "line_movement");
      if (!asObject(lm)) return "unknown";
      const v = (lm as Record<string, unknown>).has_steam_move;
      return boolState(v, true);
    },
  },
  {
    id: "rlm_on_picked_side",
    label: "Reverse line movement on picked side",
    scope: "all",
    description: "snapshot_json.line_movement.has_reverse_line_movement === true for the picked side.",
    extract: (r) => {
      const lm = getPath(r.snapshot_json, "line_movement");
      if (!asObject(lm)) return "unknown";
      const v = (lm as Record<string, unknown>).has_reverse_line_movement;
      return boolState(v, true);
    },
  },
  {
    id: "bullpen_fallback_used",
    label: "Bullpen fallback used",
    scope: "all",
    description:
      "snapshot_json.data_integrity.bullpen_fallback === 'yes'. NOTE: until bullpenService surfaces an explicit boolean, this will read 'unknown' for all rows — the framework will pick it up automatically once available.",
    extract: (r) => dataIntegrityField(r, "bullpen_fallback"),
  },
  {
    id: "weather_fallback_used",
    label: "Weather fallback used",
    scope: "all",
    description:
      "snapshot_json.data_integrity.weather_fallback === 'yes'. NOTE: until weatherService surfaces an explicit boolean, this will read 'unknown' for all rows.",
    extract: (r) => dataIntegrityField(r, "weather_fallback"),
  },
  {
    id: "market_two_sided_unavailable",
    label: "Market two-sided price unavailable",
    scope: "all",
    description:
      "snapshot_json.data_integrity.market_two_sided_available === 'no'. Lock-time odds had only one side populated.",
    extract: (r) => {
      const v = dataIntegrityField(r, "market_two_sided_available");
      // Invert: flag fires when "no"
      if (v === "yes") return "no";
      if (v === "no") return "yes";
      return "unknown";
    },
  },
];

/**
 * Dimensions the user listed for Stage 2 that are NOT currently captured in
 * `snapshot_json`. The report surfaces this explicitly so we know what to
 * add to the lock-time snapshot before those dimensions can become
 * actionable calibration inputs.
 */
/**
 * Phase 6B.22 — three formerly-missing dimensions are now captured in
 * snapshot_json (public_splits, line_movement) or surfaced as
 * tri-state placeholders with a clear upstream TODO
 * (data_integrity.bullpen_fallback / weather_fallback). They've moved
 * out of this list and into CONTEXT_FLAG_DEFINITIONS. Remaining gaps
 * surfaced below.
 */
export const MISSING_DIMENSIONS: Array<{ id: string; label: string; reason: string }> = [
  {
    id: "bullpen_fallback_real_boolean",
    label: "Bullpen fallback (real boolean from bullpenService)",
    reason:
      "snapshot_json.data_integrity.bullpen_fallback is plumbed but currently always 'unknown'. bullpenService doesn't yet emit an explicit boolean indicating whether the bullpen-factor value came from real stats vs league fallback. A small follow-up (set di.bullpen_fallback = 'yes' | 'no' in the service when computing the factor) will populate the flag with real values.",
  },
  {
    id: "weather_fallback_real_boolean",
    label: "Weather fallback (real boolean from weatherService)",
    reason:
      "snapshot_json.data_integrity.weather_fallback is plumbed but currently always 'unknown'. weatherService doesn't yet emit an explicit boolean indicating whether weather_total_adjust was derived from real forecast data vs a neutral default.",
  },
  {
    id: "fi_market_line_history",
    label: "First-inning market line + history",
    reason:
      "FI rows snapshot public_splits=null and line_movement=null today. sharp_signals is scoped to ML / OU / spread (no FI splits), and the lines / line_history queries currently filter to market_type IN ('moneyline','total'). Add first_inning_total to those queries + a small first-inning splits provider to unlock FI calibration dimensions.",
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
