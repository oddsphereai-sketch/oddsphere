/**
 * Phase 4.1.8.A — deterministic template-based MODEL BREAKDOWN generator.
 *
 * Pure function. Takes the model's `AutoModelOutput` plus a small
 * snapshot context (pitcher names, team abbreviations, FI sample sizes)
 * and returns a `BreakdownPayload` with member-facing model prose +
 * operator-only diagnostic text. No DB, no env reads, no network, no LLM.
 *
 * Phase 4.1.8.A scope shift (vs Phase 4.1.3):
 *   • The generator now produces ONLY the model-side prose
 *     (`model_breakdown`). The verdict word and Sharp Read sentence are
 *     derived CLIENT-SIDE at render time by lib/services/verdictDerivation
 *     and lib/services/sharpReadSelector, because grades and sharp
 *     signals are computed AFTER pickBreakdownGenerator runs in
 *     automodelService. Persisting verdict / sharp_read at generator
 *     time would always be stale. See PHASE_4.1.8 Option B rationale.
 *   • The ML / O/U tail (e.g. "ML NYY 58% · O/U over 56%") has been
 *     DROPPED. The 3 pick tiles on the card already show per-market
 *     pick + confidence; the tail was redundancy that made the prose
 *     feel article-y.
 *   • Actionability lead ("Strong YRFI play (55% confidence).") has
 *     been DROPPED. The verdict pill carries the actionability cue.
 *   • Numeric confidence parentheticals ("(60% confidence)") have been
 *     DROPPED for the same reason — tiles + verdict carry quantitative
 *     weight.
 *   • New char cap: MODEL_BREAKDOWN_CAP = 180 (was MEMBER_TEXT_CAP = 280).
 *   • Expanded forbidden-phrase regex bars the technical vocabulary
 *     Daniel flagged (fallback, FI ERA, FI data, fair value, +EV, etc.).
 *
 * Back-compat shim (Phase 4.1.8.A → 4.1.8.B transition):
 *   The returned payload exposes both `model_breakdown` (canonical v2
 *   field) and `member_summary` (alias = model_breakdown). The existing
 *   automodelService write code still reads `breakdown.member_summary`,
 *   so the alias keeps the call site compiling without an out-of-scope
 *   automodelService edit. Phase 4.1.8.B drops the alias when the
 *   orchestrator migrates to write under sport_specific.breakdown_v2.
 *
 * Grounding contract (unchanged):
 *   • Every member-facing sentence traces to either a structured
 *     field (kind, zone, score, pitcher name) or a reason code from
 *     `MEMBER_FRAGMENTS`.
 *   • Codes in `MEMBER_HIDDEN` never appear in member text.
 *   • Forbidden phrases are blocked by post-generation regex.
 *   • Member text is hard-capped at MODEL_BREAKDOWN_CAP characters.
 *
 * V1 scope: MLB only. Other sports return an empty payload (string
 * fields empty, metadata populated).
 */

import type { AutoModelOutput } from "../automodel/types";
import type { Sport } from "../types/domain/Sport";

export const BREAKDOWN_VERSION = "v2.0";
/** Phase 4.1.8.A — model breakdown is short by design (decision support,
 *  not an article). 1 sentence preferred; 2 max when a caveat is material. */
export const MODEL_BREAKDOWN_CAP = 180;
/** Back-compat alias used by the existing test imports. Will be removed
 *  alongside the `member_summary` alias when 4.1.8.B lands. */
export const MEMBER_TEXT_CAP = MODEL_BREAKDOWN_CAP;

export type BreakdownPayload = {
  /** Phase 4.1.8.A v2 canonical field — model-side prose only. */
  model_breakdown: string;
  /** Back-compat alias = model_breakdown. Maintained through 4.1.8.A so
   *  automodelService's existing `breakdown.member_summary` read keeps
   *  compiling without an out-of-scope edit. Dropped in 4.1.8.B. */
  member_summary: string;
  /** Unchanged from v1. Admin-surface diagnostic prose. */
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
  home_first_inning_era: number | null;
  away_first_inning_era: number | null;
  home_season_era: number | null;
  away_season_era: number | null;
};

// ─── Fragment maps ───────────────────────────────────────────────────

type MemberFragment = (ctx: BreakdownContext) => string;

/**
 * Member-facing fragments per reason code. Phase 4.1.8.A rewrote three
 * fragments that previously used forbidden vocabulary (`FI ERA`,
 * `FI data on file`, `season ERA`, `fallback`): low_first_inning_sample,
 * fallback_first_inning_era, both_starters_fallback_capped_to_toss_up.
 * The others were already plain-English clean.
 */
const MEMBER_FRAGMENTS: Record<string, MemberFragment> = {
  // Hold-path codes
  missing_starter: () =>
    "Probable starters haven't been announced for this matchup yet.",
  starter_scratched: () => "A starter has been scratched from this matchup.",
  starter_era_unavailable: () =>
    "Starter stats aren't available for this matchup yet.",
  thin_top_order: () =>
    "Lineup details aren't deep enough yet to call this matchup.",
  // FI-source codes (Phase 4.1.8.A vocabulary cleanup)
  low_first_inning_sample: (ctx) => {
    const thin = thinSidePitcher(ctx);
    if (thin === null) return "One starter's early-inning sample is still small.";
    return `${thin.name}'s early-inning sample is still small this year.`;
  },
  fallback_first_inning_era: (ctx) => {
    const missing = fallbackSidePitchers(ctx);
    if (missing.length === 0) return "One side has limited early-inning data.";
    if (missing.length === 1)
      return `Limited early-inning data on ${missing[0]} this year.`;
    return `Limited early-inning data on ${missing.join(" and ")} this year.`;
  },
  both_starters_fallback_capped_to_toss_up: () =>
    "Limited first-inning data on both starters tonight, so the model is holding off on a confident first-inning call.",
  // Offense codes
  platoon_advantage_home: (ctx) => {
    const away = ctx.away_pitcher_name ?? "the away starter";
    return `Home lineup has a platoon edge against ${away}.`;
  },
  platoon_advantage_away: (ctx) => {
    const home = ctx.home_pitcher_name ?? "the home starter";
    return `Away lineup has a platoon edge against ${home}.`;
  },
  top_order_power_risk: () => "The top of the order adds scoring risk.",
  top_order_obp_risk: () => "The top of the order adds on-base risk.",
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
  market_total_high: () => "Listed total is on the high end.",
  market_total_low: () => "Listed total is on the low end.",
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
// conditions as the model emissions; prose is more technical. Unchanged
// from Phase 4.1.3; operator surface stays admin-only.
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

function capModelBreakdown(text: string): string {
  if (text.length <= MODEL_BREAKDOWN_CAP) return text;
  return text.slice(0, MODEL_BREAKDOWN_CAP - 1).trimEnd() + "…";
}

/** Back-compat alias for tests that imported the v1 helper name. */
const capMemberText = capModelBreakdown;

/**
 * Forbidden phrases — these must NEVER appear in member text. Phase
 * 4.1.8.A expanded the v1 list with Daniel's vocab guardrails:
 *   • Generator-internal identifiers (fallback, reason code, market
 *     signal, +EV, fair value, positive EV).
 *   • FI-specific shorthand (FI ERA, FI data, FI starts).
 *   • Grade enum names (best_signal, sharp_confirmed, etc.).
 *   • V1 tail patterns ("ML XXX NN%", "O/U over NN%").
 *   • The actionability lead's confidence parenthetical
 *     ("(NN% confidence)") — verdict + tiles carry this now.
 *
 * Tests assert non-presence on every fragment AND every composed
 * model_breakdown across the slate fixtures.
 */
const FORBIDDEN_MEMBER_PATTERNS: RegExp[] = [
  // v1 patterns preserved
  /first_inning_data_used/,
  /both_starters_fallback_capped_to_toss_up/,
  /expected_first_inning_runs/,
  /data_quality_downgrade/,
  /top_order_missing/,
  /\bthreshold_zone\b/i,
  /\bbelow_floor\b/i,
  /\bsport_specific\b/i,
  // Phase 4.1.8.A expanded vocab guards
  /\bfallback\b/i,
  /\bFI ERA\b/,
  /\bFI data\b/i,
  /\bFI starts\b/,
  /\bfair value\b/i,
  /\bpositive EV\b/i,
  /\+EV\b/,
  /\bmarket signal\b/i,
  /\breason code\b/i,
  /\bbest_signal\b/,
  /\bsharp_confirmed\b/,
  /\bmarket_led\b/,
  /\bmodel_only\b/,
  /\bmarket_watch\b/,
  /\bpublic_smoke\b/,
  /\bsharp_conflict\b/,
  /capped to toss[- ]up/i,
  // Drop the v1 ML/OU tail
  /\bML\s+[A-Z]{2,4}\s+\d+%/,
  /\bO\/U\s+(over|under)\s+\d+%/i,
  // Drop the v1 actionability confidence parenthetical
  /\d+%\s*confidence/i,
  // Drop the v1 actionability lead verbs
  /^Strong (NRFI|YRFI) play/,
  /^Lean (NRFI|YRFI)\b/,
];

function assertNoForbiddenPhrases(text: string): void {
  for (const re of FORBIDDEN_MEMBER_PATTERNS) {
    if (re.test(text)) {
      throw new Error(
        `pickBreakdownGenerator: forbidden phrase ${re} detected in model breakdown: "${text.slice(0, 80)}…"`
      );
    }
  }
}

// ─── Model breakdown composition ─────────────────────────────────────

/**
 * Priority list for the "primary fallback" signal slot — used when no
 * real-FI pitcher driver is available. Order: pitcher → lineup → park
 * → weather → market. Keeps the prose pitcher-narrative when possible,
 * which is what members find easiest to parse.
 */
const PRIMARY_FALLBACK_PRIORITY = [
  "pitcher_quality_supports_nrfi",
  "pitcher_quality_risk",
  "platoon_advantage_home",
  "platoon_advantage_away",
  "top_order_power_risk",
  "top_order_obp_risk",
  "park_boosts_runs",
  "park_suppresses_runs",
  "weather_boosts_runs",
  "weather_suppresses_runs",
  "market_total_high",
  "market_total_low",
];

function pickPrimaryFallbackSignal(
  codes: string[],
  ctx: BreakdownContext
): string {
  for (const code of PRIMARY_FALLBACK_PRIORITY) {
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

/**
 * Caveat clause appended to the lead sentence when data-quality issues
 * are material to the model's read. Returns "" when no caveat is needed
 * (or when the guardrail code already handled the framing in the lead).
 *
 * Phase 4.1.8.A — phrasings updated to plain-English forms Daniel approved:
 *   "though early-inning data on [Name] is still thin."     (low_sample)
 *   "though early-inning data on [Name] is limited."         (1 fallback)
 *   "though early-inning data on both starters is limited tonight." (2)
 */
function buildCaveat(codes: string[], ctx: BreakdownContext): string {
  // Guardrail already explains the no-data situation in the lead — avoid
  // double-billing.
  if (codes.includes("both_starters_fallback_capped_to_toss_up")) return "";

  if (codes.includes("low_first_inning_sample")) {
    const thin = thinSidePitcher(ctx);
    if (thin !== null) {
      return `though early-inning data on ${thin.name} is still thin.`;
    }
    return "though one starter's early-inning data is still thin.";
  }

  if (codes.includes("fallback_first_inning_era")) {
    const missing = fallbackSidePitchers(ctx);
    if (missing.length === 1) {
      return `though early-inning data on ${missing[0]} is limited.`;
    }
    if (missing.length > 1) {
      return "though early-inning data on both starters is limited tonight.";
    }
    return "though early-inning data on one side is limited.";
  }

  return "";
}

/** Held framing: short, plain-English hold reason. No "Held — no play."
 *  prefix anymore (the verdict pill carries "No Play"). */
function buildHeldLead(
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
      return MEMBER_FRAGMENTS[code](ctx);
    }
  }
  // Generic hold fallback when no specific reason code fires.
  return "The model is holding off on this matchup tonight.";
}

/**
 * Toss-up natural framing: explain WHY the model isn't picking a side,
 * without the v1 "Toss-up —" prefix and without quoting the expected
 * runs number. Verdict pill carries the actionability.
 */
function buildTossUpLead(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const codes = output.sport_specific.nrfi_reason_codes ?? [];
  // Guardrail: no real FI on either side — surface the data caveat
  // directly as the lead.
  if (codes.includes("both_starters_fallback_capped_to_toss_up")) {
    return MEMBER_FRAGMENTS.both_starters_fallback_capped_to_toss_up(ctx);
  }
  // Real FI on at least one side but expected runs landed in toss-up
  // band. Lead with the strongest secondary signal when available;
  // generic "thin edge" fallback otherwise. Phase 4.1.8.A copy refresh:
  // "Early-inning edge is thin, but ..." reads cleaner than the older
  // "Both starters look roughly even early, but ..." which clashed when
  // the secondary signal was a scoring-risk note (the lead implied low
  // scoring, the appended clause implied the opposite).
  const secondary = pickPrimaryFallbackSignal(codes, ctx);
  if (secondary) {
    return `Early-inning edge is thin, but ${lcFirst(secondary)}`;
  }
  return "Early-inning edge is thin, with no clear lean either way.";
}

/**
 * Decisive NRFI/YRFI framing: lead with the pitcher-driven primary
 * reason when real FI data is available; fall back to the strongest
 * secondary signal otherwise. Caveat appended when material.
 */
function buildDecisiveLead(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const ss = output.sport_specific;
  const codes = ss.nrfi_reason_codes ?? [];

  let lead = "";
  if (ss.nrfi_decision_kind === "nrfi") {
    const driver = nrfiDriver(ctx);
    if (driver !== null) {
      lead = `${driver.name} has been strong in first innings this year.`;
    }
  } else if (ss.nrfi_decision_kind === "yrfi") {
    const driver = yrfiDriver(ctx);
    if (driver !== null) {
      lead = `${driver.name} has struggled in early innings this year.`;
    }
  }

  // No real-FI driver — surface the strongest secondary signal so the
  // member still gets a "why."
  if (!lead) {
    const secondary = pickPrimaryFallbackSignal(codes, ctx);
    lead = secondary || "The matchup leans one way on the model's read, with no single factor standing out.";
  }

  const caveat = buildCaveat(codes, ctx);
  if (caveat) {
    // Connect with a comma + the caveat (which already starts with
    // "though"). Strip the lead's trailing period so the sentence reads
    // as one continuous thought.
    const leadNoPeriod = lead.replace(/\.\s*$/, "");
    return `${leadNoPeriod}, ${caveat}`;
  }
  return lead;
}

/** Lowercase the first character — used when embedding a fragment after
 *  a conjunction ("but", "and"). Keeps the result grammatical. */
function lcFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ─── Phase R-12: multi-market lead-signal chooser ───────────────────
//
// Pre-R-12 the generator branched ONLY on `nrfi_decision_kind` — even
// when the full-game ML or O/U markets had a clear edge, the copy
// stayed FI-flavored. R-11 surfaced this when real season ERAs landed:
// PIT @ HOU started projecting 9.4–3.5 from a Jones 10.38 / Teng 2.57
// gap, but the breakdown still read "Early-inning edge is thin…".
//
// R-12 introduces a per-game lead-signal picker that surveys ML run
// gap, O/U total-vs-line gap, and NRFI decision, then picks the
// strongest model signal as the lead. The held path is unchanged
// (fully held games still route through `buildHeldLead`). When no
// market is materially decisive, the generator falls back to one of a
// small set of honest "thin signal" variants — not always the same
// "Early-inning edge is thin…" line.

/** R-12: ML run-gap threshold. ≥ 1.0 projected run difference fires
 *  the ML-decisive lead. Below this the gap is treated as thin
 *  (tonight's "tight game" framing). 1.0 catches PIT@HOU (5.9),
 *  SD@PHI (2.0), CLE@NYY (1.5), SF@MIL (1.8), LAD@ARI (1.5),
 *  TOR@ATL projected gap (1.5) — i.e. real edges — and skips
 *  KC@MIN (0.4) + BAL@BOS (0.9). */
const ML_RUN_GAP_THRESHOLD = 1.0;

/** R-12: O/U projected-total-vs-market-line threshold. ≥ 1.0 run
 *  gap fires the O/U-decisive lead. Catches BAL@BOS (~2.6) and
 *  PIT@HOU (~4.4); skips thin-edge games (SD@PHI, LAD@ARI ~0.1). */
const OU_TOTAL_GAP_THRESHOLD = 1.0;

/**
 * R-12: full-game lead signal. Returns one of three "override" kinds
 * (`held` / `ml_decisive` / `ou_decisive`) when a full-game read
 * deserves to drive the lead, OR `fall_through` to let the legacy
 * NRFI-based path handle it. Limiting the override surface to ML +
 * OU decisive cases preserves every pre-R-12 test for held / NRFI
 * decisive / NRFI toss-up / thin-signal copy paths.
 */
type LeadSignal =
  | { kind: "held" }
  | {
      kind: "ml_decisive";
      runGap: number;
      winner: "home" | "away";
      favoredPitcher: string | null;
      underdogPitcher: string | null;
    }
  | {
      kind: "ou_decisive";
      side: "over" | "under";
      projectedTotal: number;
      listedLine: number;
      totalGap: number;
    }
  | { kind: "fall_through" };

function pickLeadSignal(output: AutoModelOutput, ctx: BreakdownContext): LeadSignal {
  const ss = output.sport_specific;

  // 1. Fully-held — single source of truth for held framing.
  if (ss.held === true) return { kind: "held" };

  // 2. ML decisive when projected score gap clears the threshold.
  const home = output.predicted_home_score;
  const away = output.predicted_away_score;
  const winner = output.predicted_ml_winner;
  if (home !== null && away !== null && winner !== null) {
    const runGap = Math.abs(home - away);
    if (runGap >= ML_RUN_GAP_THRESHOLD) {
      const favored = winner === "home" ? ctx.home_pitcher_name : ctx.away_pitcher_name;
      const underdog = winner === "home" ? ctx.away_pitcher_name : ctx.home_pitcher_name;
      return {
        kind: "ml_decisive",
        runGap,
        winner,
        favoredPitcher: favored,
        underdogPitcher: underdog,
      };
    }
  }

  // 3. O/U decisive when projected total clearly diverges from market
  //    line. Skip when listed_line is missing — undefined !== null,
  //    so check both explicitly.
  const projTotal = output.predicted_total;
  const listed =
    ss.listed_line !== null && ss.listed_line !== undefined ? ss.listed_line : null;
  const ouSide = output.predicted_ou_side;
  if (projTotal !== null && listed !== null && ouSide !== null) {
    const totalGap = Math.abs(projTotal - listed);
    if (totalGap >= OU_TOTAL_GAP_THRESHOLD) {
      return {
        kind: "ou_decisive",
        side: ouSide,
        projectedTotal: projTotal,
        listedLine: listed,
        totalGap,
      };
    }
  }

  // 4. Anything else: let the legacy NRFI-based path handle it.
  //    Preserves held / decisive NRFI / toss-up / thin-signal copy
  //    exactly as it was pre-R-12, so the existing fixture tests
  //    continue to pass without modification.
  return { kind: "fall_through" };
}

/** Format a runs-gap value to one decimal for member copy. */
function fmtGap(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * R-12: build the lead sentence for an ML-decisive signal. Varies
 * phrasing by gap magnitude so multiple ML-decisive games on the
 * same slate don't all read identically.
 */
function buildMlDecisiveLead(
  signal: Extract<LeadSignal, { kind: "ml_decisive" }>
): string {
  const favored = signal.favoredPitcher ?? "The favored starter";
  const underdog = signal.underdogPitcher ?? "the opposing starter";
  const gapStr = fmtGap(signal.runGap);
  if (signal.runGap >= 3.0) {
    return `${favored} projects a sizable run-prevention edge over ${underdog} tonight (~${gapStr}-run projected gap).`;
  }
  if (signal.runGap >= 2.0) {
    return `${favored} projects to outpitch ${underdog} by roughly ${gapStr} runs tonight.`;
  }
  return `${favored} projects a small starter edge over ${underdog} (~${gapStr}-run gap).`;
}

/** R-12: build the lead sentence for an O/U-decisive signal. */
function buildOuDecisiveLead(
  signal: Extract<LeadSignal, { kind: "ou_decisive" }>
): string {
  const projStr = fmtGap(signal.projectedTotal);
  const lineStr = fmtGap(signal.listedLine);
  if (signal.side === "over") {
    return `Model projects ~${projStr} total runs, above the listed ${lineStr}.`;
  }
  return `Model projects ~${projStr} total runs, under the listed ${lineStr}.`;
}

/**
 * R-12: optional secondary clause appended to the ML-decisive lead.
 * Adds a "why" when the underdog has an extreme season ERA, or
 * surfaces a parallel O/U lean when the same game has a big total
 * gap. Stays inside the 180-char cap.
 */
function buildMlSecondaryClause(
  signal: Extract<LeadSignal, { kind: "ml_decisive" }>,
  output: AutoModelOutput,
  ctx: BreakdownContext
): string | null {
  const ss = output.sport_specific;

  // (a) Extreme ERA on the underdog side — adds the WHY without
  //     restating the projected gap.
  const underdogEra =
    signal.winner === "home" ? ctx.away_season_era : ctx.home_season_era;
  const underdogName =
    signal.winner === "home" ? ctx.away_pitcher_name : ctx.home_pitcher_name;
  if (underdogEra !== null && underdogName !== null && underdogEra >= 6.0) {
    return `${underdogName} is at ${underdogEra.toFixed(2)} ERA this year.`;
  }

  // (b) Big parallel O/U lean — separate market, separate lean.
  const listed =
    ss.listed_line !== null && ss.listed_line !== undefined ? ss.listed_line : null;
  const projTotal = output.predicted_total;
  const ouSide = output.predicted_ou_side;
  if (
    listed !== null &&
    projTotal !== null &&
    ouSide !== null &&
    Math.abs(projTotal - listed) >= OU_TOTAL_GAP_THRESHOLD
  ) {
    return `Projected total ~${fmtGap(projTotal)} runs vs listed ${fmtGap(listed)}.`;
  }

  return null;
}

function buildModelBreakdown(
  output: AutoModelOutput,
  ctx: BreakdownContext
): string {
  const ss = output.sport_specific;

  // Held — top priority, never overridden by R-12 paths.
  if (ss.held === true) {
    const text = buildHeldLead(output, ctx);
    assertNoForbiddenPhrases(text);
    return capModelBreakdown(text);
  }

  // R-12: when ML or O/U has a decisive full-game edge, override the
  // legacy NRFI-based lead. This is the case that caught PIT @ HOU at
  // 9.4–3.5 still saying "Early-inning edge is thin…" — the new path
  // surfaces the ML projection instead.
  const signal = pickLeadSignal(output, ctx);
  if (signal.kind === "ml_decisive") {
    let text = buildMlDecisiveLead(signal);
    const secondary = buildMlSecondaryClause(signal, output, ctx);
    if (secondary !== null && text.length + 1 + secondary.length <= MODEL_BREAKDOWN_CAP) {
      text = `${text} ${secondary}`;
    }
    assertNoForbiddenPhrases(text);
    return capModelBreakdown(text);
  }
  if (signal.kind === "ou_decisive") {
    const text = buildOuDecisiveLead(signal);
    assertNoForbiddenPhrases(text);
    return capModelBreakdown(text);
  }

  // Fall-through: original NRFI-based dispatch. Preserves all pre-R-12
  // held / decisive-NRFI / toss-up / thin-signal copy and its tests.
  let text = "";
  if (ss.nrfi_decision_kind === "held") {
    text = buildHeldLead(output, ctx);
  } else if (ss.nrfi_decision_kind === "toss_up") {
    text = buildTossUpLead(output, ctx);
  } else {
    text = buildDecisiveLead(output, ctx);
  }
  assertNoForbiddenPhrases(text);
  return capModelBreakdown(text);
}

// ─── Operator detail composition ────────────────────────────────────
// Unchanged from Phase 4.1.3. Admin-surface diagnostic prose; never
// exposed to the member API per the Phase 4.1.6 contract.

function formatConfidence(c: number | null): string {
  if (c === null) return "—";
  return `${Math.round(c)}%`;
}

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
      `confidence=${formatConfidence(output.ml_confidence)} ` +
      `predicted_home=${output.predicted_home_score ?? "null"} ` +
      `predicted_away=${output.predicted_away_score ?? "null"} ` +
      `predicted_total=${output.predicted_total ?? "null"}`
  );
  lines.push(
    `O/U: side=${output.predicted_ou_side ?? "null"} ` +
      `confidence=${formatConfidence(output.ou_confidence)}`
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
    model_breakdown: "",
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
  const model_breakdown = buildModelBreakdown(output, ctx);
  const operator_detail = buildOperatorDetail(output, ctx);
  return {
    model_breakdown,
    // Back-compat alias = model_breakdown. Maintained through 4.1.8.A so
    // automodelService's existing reads keep compiling; dropped in 4.1.8.B.
    member_summary: model_breakdown,
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
  PRIMARY_FALLBACK_PRIORITY,
  parseExpectedRunsCode,
  capMemberText,
  capModelBreakdown,
  assertNoForbiddenPhrases,
  FORBIDDEN_MEMBER_PATTERNS,
  buildModelBreakdown,
  buildOperatorDetail,
};
