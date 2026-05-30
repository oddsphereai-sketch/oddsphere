/**
 * Phase 4.1.3 — deterministic template-based pick breakdown generator.
 *
 * Pure function. Takes the model's `AutoModelOutput` plus a small
 * snapshot context (pitcher names, team abbreviations, sample sizes)
 * and returns a `BreakdownPayload` with member-facing and operator-only
 * text. No DB, no env reads, no network, no LLM.
 *
 * Grounding contract:
 *   • Every member-facing sentence traces to either a structured
 *     field (kind, zone, confidence, score, pitcher name) or a reason
 *     code from `MEMBER_FRAGMENTS`.
 *   • Codes in `MEMBER_HIDDEN` never appear in member text.
 *   • Forbidden phrases (technical code names, leaked operator-only
 *     metric names) are blocked by post-generation regex.
 *   • Member text is hard-capped at MEMBER_TEXT_CAP characters.
 *
 * V1 scope: MLB only. Other sports return an empty payload (string fields
 * empty, metadata populated). Future phases add per-sport fragment maps.
 *
 * Completeness assertion: the test suite enforces that every reason code
 * known to be emitted by mlbAutoModelV1.ts has either a member fragment
 * OR is in MEMBER_HIDDEN.
 */

import type { AutoModelOutput } from "../automodel/types";
import type { Sport } from "../types/domain/Sport";

export const BREAKDOWN_VERSION = "v1.0";
export const MEMBER_TEXT_CAP = 280;

export type BreakdownPayload = {
  member_summary: string;
  operator_detail: string;
  breakdown_version: string;
  breakdown_generated_at: string;
};

export type BreakdownContext = {
  sport: Sport;
  home_pitcher_name: string | null;
  away_pitcher_name: string | null;
  home_team_abbr: string;
  away_team_abbr: string;
  home_first_inning_starts: number | null;
  away_first_inning_starts: number | null;
  // Phase 4.1.3.b — per-pitcher FI ERA + season ERA for member-facing
  // pitcher-driven reasoning. Pulled from snapshot.{home,away}_starter.
  home_first_inning_era: number | null;
  away_first_inning_era: number | null;
  home_season_era: number | null;
  away_season_era: number | null;
};

// ─── Fragment maps ───────────────────────────────────────────────────

type MemberFragment = (ctx: BreakdownContext) => string;

const MEMBER_FRAGMENTS: Record<string, MemberFragment> = {
  // Hold-path codes
  missing_starter: () => "Probable starter has not been announced.",
  starter_scratched: () => "A starter has been scratched.",
  starter_era_unavailable: () => "Pitcher stats are not yet available.",
  thin_top_order: () =>
    "Lineup data is too sparse to support a confident first-inning call.",
  // FI source codes
  low_first_inning_sample: (ctx) => {
    const thin = thinSidePitcher(ctx);
    if (thin === null) return "One starter's first-inning sample is small.";
    return `${thin.name}'s first-inning sample is small (${thin.starts} starts) — season ERA used as fallback.`;
  },
  fallback_first_inning_era: (ctx) => {
    const missing = fallbackSidePitchers(ctx);
    if (missing.length === 0) return "Season-ERA fallback used for one side.";
    if (missing.length === 1) return `No first-inning data on file for ${missing[0]} — season ERA used as fallback.`;
    return `No first-inning data on file for ${missing.join(" or ")} — season ERA used as fallback.`;
  },
  both_starters_fallback_capped_to_toss_up: () =>
    "Neither pitcher has enough first-inning data on file yet — model is holding off on a confident call.",
  // Offense codes
  platoon_advantage_home: (ctx) => {
    const away = ctx.away_pitcher_name ?? "the away starter";
    return `Home lineup has a platoon edge against ${away}.`;
  },
  platoon_advantage_away: (ctx) => {
    const home = ctx.home_pitcher_name ?? "the home starter";
    return `Away lineup has a platoon edge against ${home}.`;
  },
  top_order_power_risk: () => "Top of the order shows strong slugging.",
  top_order_obp_risk: () => "Top of the order has strong on-base ability.",
  // Pitcher codes
  pitcher_quality_supports_nrfi: () =>
    "Starter quality favors strikeouts and weak contact.",
  pitcher_quality_risk: () => "Starter tends to allow more contact.",
  // Park codes
  park_boosts_runs: () => "Ballpark slightly favors runs.",
  park_suppresses_runs: () => "Ballpark suppresses runs.",
  // Weather codes
  weather_boosts_runs: () => "Weather conditions favor scoring.",
  weather_suppresses_runs: () => "Weather conditions suppress scoring.",
  // Market codes
  market_total_high: () => "Market total is on the high end.",
  market_total_low: () => "Market total is on the low end.",
  // Data-quality cap codes
  lineup_unconfirmed: () => "Lineup not yet confirmed.",
  starter_unconfirmed: () => "Starter not yet confirmed.",
};

// Codes that intentionally do NOT appear in member text. Either purely
// diagnostic, redundant with structural fields, or operator-context.
const MEMBER_HIDDEN = new Set<string>([
  "first_inning_data_used",
  "top_order_missing_home",
  "top_order_missing_away",
  "data_quality_downgrade",
]);

// Dynamic prefix — `expected_first_inning_runs_X.XX` codes are hidden
// from member text and surfaced only in operator detail (as the parsed
// numeric value).
const DYNAMIC_EXPECTED_RUNS_PREFIX = "expected_first_inning_runs_";

function parseExpectedRunsCode(code: string): number | null {
  if (!code.startsWith(DYNAMIC_EXPECTED_RUNS_PREFIX)) return null;
  const v = parseFloat(code.slice(DYNAMIC_EXPECTED_RUNS_PREFIX.length));
  return Number.isFinite(v) ? v : null;
}

// Operator-side fragments — one entry per finite known code. Same trigger
// conditions as the model emissions; prose is more technical.
const OPERATOR_FRAGMENTS: Record<string, string> = {
  missing_starter: "Hold: missing_starter (home or away pitcher null).",
  starter_scratched: "Hold: starter_scratched (is_scratched=true).",
  starter_era_unavailable:
    "Hold: starter_era_unavailable (no FI ERA + no season ERA).",
  thin_top_order: "Hold: thin_top_order (fallback ERA + no top-of-order data).",
  first_inning_data_used:
    "FI source: at least one starter uses real first-inning ERA (sample ≥ 3 starts).",
  low_first_inning_sample:
    "FI source: at least one starter's FI sample < FIRST_INNING_SAMPLE_GATE (3); fell back to season_era × 1.0.",
  fallback_first_inning_era:
    "FI source: at least one starter has no FI data; fell back to season_era × 1.0.",
  top_order_missing_home:
    "Diagnostic: home top-of-order OPS unavailable.",
  top_order_missing_away:
    "Diagnostic: away top-of-order OPS unavailable.",
  platoon_advantage_home:
    "Offense: home top-3 handed OPS exceeds season-only by ≥ 0.030.",
  platoon_advantage_away:
    "Offense: away top-3 handed OPS exceeds season-only by ≥ 0.030.",
  top_order_power_risk:
    "Offense: top-3 SLG average ≥ 0.480.",
  top_order_obp_risk:
    "Offense: top-3 OBP average ≥ 0.360.",
  pitcher_quality_supports_nrfi:
    "Pitcher: at least one starter pitch_quality_score ≤ 0.96 (whiffy).",
  pitcher_quality_risk:
    "Pitcher: at least one starter pitch_quality_score ≥ 1.04 (contact-prone).",
  park_boosts_runs: "Park: park_factor_runs ≥ 105.",
  park_suppresses_runs: "Park: park_factor_runs ≤ 95.",
  weather_boosts_runs: "Weather: weatherDelta > 0.2.",
  weather_suppresses_runs: "Weather: weatherDelta < −0.2.",
  market_total_high: "Market: listed_total ≥ 9.5.",
  market_total_low: "Market: listed_total ≤ 7.5.",
  both_starters_fallback_capped_to_toss_up:
    "Guardrail: no real FI on either side → decision_kind capped to toss_up.",
  lineup_unconfirmed:
    "Data-quality cap: lineup_confirmed=false (−5 confidence).",
  starter_unconfirmed:
    "Data-quality cap: starter_confirmed=false (−5 confidence).",
  data_quality_downgrade:
    "Downgrade: confidence cap reduced below floor; threshold_zone=below_floor.",
};

// ─── Helpers ─────────────────────────────────────────────────────────

function thinSidePitcher(
  ctx: BreakdownContext
): { name: string; starts: number } | null {
  const homeStarts = ctx.home_first_inning_starts ?? 0;
  const awayStarts = ctx.away_first_inning_starts ?? 0;
  if (homeStarts >= 1 && homeStarts < 3 && ctx.home_pitcher_name) {
    return { name: ctx.home_pitcher_name, starts: homeStarts };
  }
  if (awayStarts >= 1 && awayStarts < 3 && ctx.away_pitcher_name) {
    return { name: ctx.away_pitcher_name, starts: awayStarts };
  }
  return null;
}

function fallbackSidePitchers(ctx: BreakdownContext): string[] {
  const out: string[] = [];
  if (ctx.home_first_inning_starts === null && ctx.home_pitcher_name) {
    out.push(ctx.home_pitcher_name);
  }
  if (ctx.away_first_inning_starts === null && ctx.away_pitcher_name) {
    out.push(ctx.away_pitcher_name);
  }
  return out;
}

function formatConfidence(c: number | null): string {
  if (c === null) return "—";
  return `${Math.round(c)}%`;
}

function capMemberText(text: string): string {
  if (text.length <= MEMBER_TEXT_CAP) return text;
  return text.slice(0, MEMBER_TEXT_CAP - 1).trimEnd() + "…";
}

// Forbidden phrases — these must NEVER appear in member text. The regex
// is conservative; the unit-test suite asserts non-presence per fragment.
const FORBIDDEN_MEMBER_PATTERNS: RegExp[] = [
  /first_inning_data_used/,
  /both_starters_fallback_capped_to_toss_up/,
  /expected_first_inning_runs/,
  /data_quality_downgrade/,
  /top_order_missing/,
  /\bthreshold_zone\b/i,
  /\bbelow_floor\b/i,
  /\bsport_specific\b/i,
];

function assertNoForbiddenPhrases(text: string): void {
  for (const re of FORBIDDEN_MEMBER_PATTERNS) {
    if (re.test(text)) {
      throw new Error(
        `pickBreakdownGenerator: forbidden phrase ${re} detected in member text: "${text.slice(0, 80)}…"`
      );
    }
  }
}

// ─── Member summary composition (Phase 4.1.3.b — member-first priorities) ─

// Member-priority order for the "fallback" secondary signal slot when no
// FI-driven primary reason is available. Used by toss-up natural and by
// decisive picks where neither side has real FI data.
const SECONDARY_PRIORITY = [
  "pitcher_quality_supports_nrfi",
  "pitcher_quality_risk",
  "platoon_advantage_home",
  "platoon_advantage_away",
  "park_boosts_runs",
  "park_suppresses_runs",
  "weather_boosts_runs",
  "weather_suppresses_runs",
  "top_order_power_risk",
  "top_order_obp_risk",
  "market_total_high",
  "market_total_low",
];

function pickSecondarySignal(
  codes: string[],
  ctx: BreakdownContext
): string {
  for (const code of SECONDARY_PRIORITY) {
    if (codes.includes(code) && MEMBER_FRAGMENTS[code]) {
      return MEMBER_FRAGMENTS[code](ctx);
    }
  }
  return "";
}

type PitcherSide = "home" | "away";

type FiSideInfo = {
  side: PitcherSide;
  name: string;
  fi_era: number;
  starts: number;
};

/** Return only the pitcher sides that have real FI data above the gate. */
function realFiSides(ctx: BreakdownContext): FiSideInfo[] {
  const out: FiSideInfo[] = [];
  const homeStarts = ctx.home_first_inning_starts ?? 0;
  const awayStarts = ctx.away_first_inning_starts ?? 0;
  if (
    ctx.home_first_inning_era !== null &&
    ctx.home_pitcher_name !== null &&
    homeStarts >= 3
  ) {
    out.push({
      side: "home",
      name: ctx.home_pitcher_name,
      fi_era: ctx.home_first_inning_era,
      starts: homeStarts,
    });
  }
  if (
    ctx.away_first_inning_era !== null &&
    ctx.away_pitcher_name !== null &&
    awayStarts >= 3
  ) {
    out.push({
      side: "away",
      name: ctx.away_pitcher_name,
      fi_era: ctx.away_first_inning_era,
      starts: awayStarts,
    });
  }
  return out;
}

/** Pitcher with the lowest FI ERA among above-gate starters (drives NRFI). */
function nrfiDriver(ctx: BreakdownContext): FiSideInfo | null {
  const sides = realFiSides(ctx);
  if (sides.length === 0) return null;
  return sides.reduce((a, b) => (a.fi_era <= b.fi_era ? a : b));
}

/** Pitcher with the highest FI ERA among above-gate starters (drives YRFI). */
function yrfiDriver(ctx: BreakdownContext): FiSideInfo | null {
  const sides = realFiSides(ctx);
  if (sides.length === 0) return null;
  return sides.reduce((a, b) => (a.fi_era >= b.fi_era ? a : b));
}

/** Caveat string for fallback / low-sample data quality, if applicable. */
function caveatLine(codes: string[], ctx: BreakdownContext): string {
  // Suppress the per-side caveats when the guardrail already explains
  // the no-data situation in the lead — avoid double-billing.
  if (codes.includes("both_starters_fallback_capped_to_toss_up")) return "";
  if (codes.includes("low_first_inning_sample")) {
    const thin = thinSidePitcher(ctx);
    if (thin !== null) {
      return `Caveat: ${thin.name} has only ${thin.starts} FI starts, so his side uses season ERA.`;
    }
    return "Caveat: one starter has a thin FI sample.";
  }
  if (codes.includes("fallback_first_inning_era")) {
    const missing = fallbackSidePitchers(ctx);
    if (missing.length === 1) {
      return `Caveat: no FI data on file for ${missing[0]}, so his side uses season ERA.`;
    }
    if (missing.length > 1) {
      return `Caveat: no FI data on file for ${missing.join(" or ")} — season ERA used as fallback.`;
    }
    return "Caveat: one side uses season-ERA fallback.";
  }
  return "";
}

/** Held framing: short, no-play, with the specific hold reason. */
function buildHoldMemberText(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const ss = output.sport_specific;
  const codes = ss.nrfi_reason_codes ?? [];
  for (const code of [
    "missing_starter",
    "starter_scratched",
    "starter_era_unavailable",
    "thin_top_order",
  ]) {
    if (codes.includes(code)) {
      return `Held — no play. ${MEMBER_FRAGMENTS[code](ctx)}`;
    }
  }
  const reason = ss.nrfi_hold_reason ?? "";
  return reason
    ? `Held — no play. ${reason}.`
    : "Held — no play.";
}

/** Toss-up framing: explain WHY the model is staying away. */
function buildTossUpMemberText(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const ss = output.sport_specific;
  const codes = ss.nrfi_reason_codes ?? [];
  // Guardrail: no real FI on either side — flag prominently.
  if (codes.includes("both_starters_fallback_capped_to_toss_up")) {
    return "Toss-up — the model lacks real first-inning data for both starters, so it is not forcing a pick.";
  }
  // Real FI on at least one side but expected runs land in toss-up band.
  // Try to surface a secondary contextual signal if available.
  const exp = ss.auto_factors.nrfi_expected_runs;
  const expStr = exp !== null ? `~${exp.toFixed(2)} runs` : "near average";
  const secondary = pickSecondarySignal(codes, ctx);
  if (secondary) {
    return `Toss-up — projected first-inning runs land in the middle (${expStr}); no clear NRFI/YRFI edge. ${secondary}`;
  }
  return `Toss-up — projected first-inning runs land in the middle (${expStr}); no clear NRFI/YRFI edge.`;
}

/** Decisive NRFI/YRFI: actionability lead + primary FI-driven reason + caveat. */
function buildDecisiveMemberText(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const ss = output.sport_specific;
  const codes = ss.nrfi_reason_codes ?? [];
  const direction = ss.nrfi_decision_kind === "nrfi" ? "NRFI" : "YRFI";
  const isStrong =
    ss.nrfi_threshold_zone === "strong_nrfi" ||
    ss.nrfi_threshold_zone === "strong_yrfi";
  const conf = formatConfidence(output.nrfi_confidence);
  // Lead — actionability language, not just a confidence number.
  const lead = isStrong
    ? `Strong ${direction} play (${conf} confidence).`
    : `Lean ${direction} — moderate edge (${conf} confidence).`;

  // Primary reason — prefer pitcher-driven FI signal when real data is
  // available; fall back to a secondary contextual code when not.
  let primary = "";
  if (ss.nrfi_decision_kind === "nrfi") {
    const driver = nrfiDriver(ctx);
    if (driver !== null) {
      primary = `${driver.name} has been strong in first innings (${driver.fi_era.toFixed(2)} FI ERA in ${driver.starts} starts).`;
    }
  } else {
    const driver = yrfiDriver(ctx);
    if (driver !== null) {
      primary = `${driver.name} has struggled in first innings (${driver.fi_era.toFixed(2)} FI ERA in ${driver.starts} starts).`;
    }
  }
  // If no real-FI primary, surface the strongest secondary signal so the
  // member still gets a "why".
  if (!primary) {
    primary = pickSecondarySignal(codes, ctx);
  }

  const caveat = caveatLine(codes, ctx);

  const parts = [lead];
  if (primary) parts.push(primary);
  if (caveat) parts.push(caveat);
  return parts.join(" ");
}

/** Compact ML+OU tail. Short by design so it doesn't dominate the blurb. */
function buildMlOuTail(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const segments: string[] = [];
  if (output.predicted_ml_winner !== null) {
    const winner =
      output.predicted_ml_winner === "home"
        ? ctx.home_team_abbr
        : ctx.away_team_abbr;
    const conf = formatConfidence(output.ml_confidence);
    segments.push(`ML ${winner} ${conf}`);
  }
  if (output.predicted_ou_side !== null) {
    const conf = formatConfidence(output.ou_confidence);
    segments.push(`O/U ${output.predicted_ou_side} ${conf}`);
  }
  return segments.length > 0 ? segments.join(" · ") + "." : "";
}

function buildMemberSummary(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const ss = output.sport_specific;
  let main = "";
  if (ss.nrfi_decision_kind === "held") {
    main = buildHoldMemberText(output, ctx);
  } else if (ss.nrfi_decision_kind === "toss_up") {
    main = buildTossUpMemberText(output, ctx);
  } else {
    main = buildDecisiveMemberText(output, ctx);
  }
  const tail = buildMlOuTail(output, ctx);
  const text = tail ? `${main} ${tail}` : main;
  assertNoForbiddenPhrases(text);
  return capMemberText(text);
}

// ─── Operator detail composition ────────────────────────────────────

function buildOperatorDetail(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const ss = output.sport_specific;
  const codes = ss.nrfi_reason_codes ?? [];
  const lines: string[] = [];

  lines.push(
    `NRFI: kind=${ss.nrfi_decision_kind ?? "?"} zone=${ss.nrfi_threshold_zone ?? "?"} ` +
      `expected_runs=${ss.auto_factors.nrfi_expected_runs?.toFixed(3) ?? "null"} ` +
      `confidence=${output.nrfi_confidence ?? "null"}`
  );
  if (ss.nrfi_hold_reason) lines.push(`hold_reason: ${ss.nrfi_hold_reason}`);
  if (Array.isArray(ss.hold_picks) && ss.hold_picks.length > 0) {
    lines.push(`hold_picks: ${ss.hold_picks.join(", ")}`);
  }
  lines.push(
    `ML: winner=${output.predicted_ml_winner ?? "null"} ` +
      `confidence=${output.ml_confidence ?? "null"} ` +
      `predicted_home=${output.predicted_home_score ?? "null"} ` +
      `predicted_away=${output.predicted_away_score ?? "null"} ` +
      `predicted_total=${output.predicted_total ?? "null"}`
  );
  lines.push(
    `O/U: side=${output.predicted_ou_side ?? "null"} ` +
      `confidence=${output.ou_confidence ?? "null"}`
  );

  lines.push("Reason codes:");
  for (const code of codes) {
    const expectedVal = parseExpectedRunsCode(code);
    if (expectedVal !== null) {
      lines.push(`  • ${code}: expected_first_inning_runs = ${expectedVal.toFixed(2)}`);
      continue;
    }
    const frag = OPERATOR_FRAGMENTS[code];
    if (frag) {
      lines.push(`  • ${code}: ${frag}`);
    } else {
      lines.push(`  • ${code}: (no operator fragment registered)`);
    }
  }

  lines.push(
    `Context: home=${ctx.home_team_abbr} (${ctx.home_pitcher_name ?? "?"}, ` +
      `fi_starts=${ctx.home_first_inning_starts ?? "null"}), ` +
      `away=${ctx.away_team_abbr} (${ctx.away_pitcher_name ?? "?"}, ` +
      `fi_starts=${ctx.away_first_inning_starts ?? "null"})`
  );

  return lines.join("\n");
}

// ─── Public entry point ─────────────────────────────────────────────

function emptyPayload(now?: Date): BreakdownPayload {
  return {
    member_summary: "",
    operator_detail: "",
    breakdown_version: BREAKDOWN_VERSION,
    breakdown_generated_at: (now ?? new Date()).toISOString(),
  };
}

export function generatePickBreakdown(
  output: AutoModelOutput,
  ctx: BreakdownContext,
  opts?: { now?: Date }
): BreakdownPayload {
  // V1: MLB only. Other sports return empty payload (still typed/safe).
  if (ctx.sport !== "mlb") {
    return emptyPayload(opts?.now);
  }
  const member_summary = buildMemberSummary(output, ctx);
  const operator_detail = buildOperatorDetail(output, ctx);
  return {
    member_summary,
    operator_detail,
    breakdown_version: BREAKDOWN_VERSION,
    breakdown_generated_at: (opts?.now ?? new Date()).toISOString(),
  };
}

/**
 * Known reason codes emitted by mlbAutoModelV1.ts as of Phase 3.x.3.
 * Source-of-truth list for the completeness assertion test. Must be
 * updated alongside any new reason code added to the model.
 */
export const KNOWN_MLB_REASON_CODES = [
  // Hold-path
  "missing_starter",
  "starter_scratched",
  "starter_era_unavailable",
  "thin_top_order",
  // FI source
  "first_inning_data_used",
  "low_first_inning_sample",
  "fallback_first_inning_era",
  // Top-order
  "top_order_missing_home",
  "top_order_missing_away",
  "platoon_advantage_home",
  "platoon_advantage_away",
  "top_order_power_risk",
  "top_order_obp_risk",
  // Pitcher
  "pitcher_quality_supports_nrfi",
  "pitcher_quality_risk",
  // Park/weather/market
  "park_boosts_runs",
  "park_suppresses_runs",
  "weather_boosts_runs",
  "weather_suppresses_runs",
  "market_total_high",
  "market_total_low",
  // Guardrail
  "both_starters_fallback_capped_to_toss_up",
  // Data-quality
  "lineup_unconfirmed",
  "starter_unconfirmed",
  "data_quality_downgrade",
] as const;

// Internal exports for the test suite.
export const __TEST__ = {
  MEMBER_FRAGMENTS,
  MEMBER_HIDDEN,
  OPERATOR_FRAGMENTS,
  SECONDARY_PRIORITY,
  parseExpectedRunsCode,
  capMemberText,
  assertNoForbiddenPhrases,
  FORBIDDEN_MEMBER_PATTERNS,
  buildMemberSummary,
  buildOperatorDetail,
};
