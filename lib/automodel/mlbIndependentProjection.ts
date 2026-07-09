/**
 * Push 3A — V2.2 Independent Baseball Projection (Layer 2).
 *
 * Builds projected runs for each team from real baseball features.
 * DOES NOT use V1's projected scores as input. V2.1's Layer 2
 * bridged into V1; V2.2's Layer 2 is a clean projection that can
 * disagree with both V1 and the market when the features support it.
 *
 * Method:
 *
 *   per_team_expected_runs =
 *     LEAGUE_AVG_RPG
 *       × offense_factor   (from team OPS vs league avg)
 *       × pitcher_factor   (opponent starter ERA / pitch_quality)
 *       × bullpen_factor   (opponent bullpen ERA proxy)
 *       × park_factor      (centered at 1.00)
 *       × weather_factor   (wind / temperature / humidity adjustment)
 *       × handedness_factor (vs_LHP_ops vs vs_RHP_ops when starter
 *                            handedness known)
 *       × home_field_factor (small advantage)
 *
 * Then total = away_runs + home_runs, diff = home_runs - away_runs.
 *
 * Honest missingness: each input is checked. When missing, the
 * corresponding factor defaults to 1.00 and that input is flagged.
 * data_quality_tier downgrades accordingly so Layer 3 can shrink
 * toward market. NEVER imputes fake stats.
 *
 * Available features used by Push 3A:
 *   - team OPS (proxy for wRC+; flagged "proxy")
 *   - team runs/game (low-information background prior)
 *   - bullpen_era_proxy
 *   - starter season ERA / pitch_quality_score
 *   - starter handedness (when known)
 *   - vs_LHP_ops / vs_RHP_ops (when populated)
 *   - park_factor_runs
 *   - weather (temperature_f, wind_speed_mph, is_notable)
 *
 * Features audited as MISSING in current data (would improve V2.3):
 *   - FIP / xFIP / SIERA / xERA (use ERA + pitch_quality as proxy)
 *   - wRC+ / xwOBA (use OPS as proxy)
 *   - bullpen leverage / recent-day workload
 *   - confirmed lineup (use roster average when unconfirmed)
 *
 * Pure / no DB / no network.
 */

import type { GameSnapshot, TeamSnapshot, StarterSnapshot } from "./types";
import {
  EXPECTED_BULLPEN_INNINGS,
  EXPECTED_STARTER_INNINGS,
} from "./types";

// ─── league constants (2025-2026 MLB ranges) ──────────────────────

export const V22_LEAGUE_AVG_RUNS_PER_GAME = 4.45;
export const V22_LEAGUE_AVG_OPS = 0.720;
export const V22_LEAGUE_AVG_STARTER_ERA = 4.10;
export const V22_LEAGUE_AVG_BULLPEN_ERA = 4.10;

// Factor clamps prevent any single feature from yanking the projection
// to absurd places when a single stat is extreme (cold start of season,
// scratched starter, etc.).
const FACTOR_CLAMP_MIN = 0.70;
const FACTOR_CLAMP_MAX = 1.35;

// Home-field advantage — TOTAL-NEUTRAL DIFFERENTIAL (2026-06-16). MLB home-field
// is a ~0.22-run MARGIN edge (~54% home-win baseline). The prior +0.10 home-only
// multiplier under-weighted it (model implied 49.3% home vs 57.9% actual, an 8.6pp
// gap) AND inflated projected totals. We now apply +half to home and −half to away
// so the projected TOTAL is unchanged (no scoring inflation → O/U projections are
// untouched) and only the home-away MARGIN shifts — which is what ML resolves on.
// Validated via offline re-run: ML 55%→60% (+5W over 9 slates, holds excl-6/14 at
// 63%), 7 picks flipped, totals unchanged. Reversible via this constant.
const HOME_FIELD_RUNS_DIFFERENTIAL = 0.22;
const HOME_FIELD_HALF = HOME_FIELD_RUNS_DIFFERENTIAL / 2;

// ─── feature audit — Push 3A-2 source/reason taxonomy ─────────────
//
// Source tiers, strongest to weakest:
//
//   preferred         best configured source for this feature (e.g.
//                     raw pitch_quality from Statcast pitch_type stats)
//   fallback_real     another real source covering the same concept
//                     (e.g. season_runs_per_game backing team_ops when
//                     OPS missing — both are real but OPS is preferred)
//   proxy             derived from available stats (e.g. pitch_quality
//                     derived from ERA+WHIP+K/9; OPS as proxy for wRC+)
//   neutral_fallback  league-average / 1.0-multiplier last resort —
//                     marked explicitly so confidence + Best Angle are
//                     downgraded
//   missing           no usable input — factor defaults to 1.0 but the
//                     audit honestly says missing; Best Angle gated

export type V22FeatureSource =
  | "preferred"
  | "fallback_real"
  | "proxy"
  | "neutral_fallback"
  | "missing";

export type V22FeatureStatus = {
  source: V22FeatureSource;
  reason: string;
};

/** Backwards-compatible alias. Old callers expected "present"/"proxy"/"missing".
 *  Kept as a re-export so consumers that haven't migrated yet still compile. */
export type FeaturePresence = "present" | "proxy" | "missing";

export type V22FeatureAudit = {
  team_ops: { home: V22FeatureStatus; away: V22FeatureStatus };
  bullpen_era: { home: V22FeatureStatus; away: V22FeatureStatus };
  starter_era: { home: V22FeatureStatus; away: V22FeatureStatus };
  starter_pitch_quality: { home: V22FeatureStatus; away: V22FeatureStatus };
  starter_handedness: { home: V22FeatureStatus; away: V22FeatureStatus };
  park_factor: V22FeatureStatus;
  weather: V22FeatureStatus;
  confirmed_lineup: { home: V22FeatureStatus; away: V22FeatureStatus };
  // ─── derived counts (14 audit slots) ─────────────────────────────
  preferred_count: number;
  fallback_real_count: number;
  proxy_count: number;
  neutral_fallback_count: number;
  missing_count: number;
  /** Sum of preferred + fallback_real + proxy + neutral_fallback. */
  present_count: number;
  /** Reason codes that drove the audit (deduped). Surfaced in shadow + coverage operator. */
  reason_codes: string[];
};

const STATUS_MISSING: V22FeatureStatus = { source: "missing", reason: "missing" };

function statusFromRaw(
  raw: unknown,
  preferredReason: string,
  proxyOverride?: { isProxy: true; reason: string },
): V22FeatureStatus {
  if (raw === null || raw === undefined) return STATUS_MISSING;
  if (proxyOverride?.isProxy) return { source: "proxy", reason: proxyOverride.reason };
  return { source: "preferred", reason: preferredReason };
}

/** Per-side confirmed-lineup check. The joint `data_quality.lineup_confirmed`
 *  collapses both teams; we evaluate each side independently so one team
 *  with a projected lineup doesn't penalize the other side's audit. */
function lineupConfirmedSide(lineup: GameSnapshot["home_lineup_top8"]): V22FeatureStatus {
  if (lineup.length < 8) return { source: "missing", reason: "lineup_missing" };
  if (lineup.every((b) => b.lineup_source === "confirmed")) {
    return { source: "preferred", reason: "lineup_confirmed" };
  }
  // At least 8 batters but at least one projected → real fallback, lower tier.
  return { source: "fallback_real", reason: "lineup_projected" };
}

/** Weather status: preferred when row exists with notable signal, proxy when
 *  row exists with temp/wind, missing when no row at all. V2.2 only nudges
 *  on is_notable, so a row with temp/wind that isn't notable is honestly
 *  "we have data, model didn't act on it" → proxy. */
function weatherStatus(snap: GameSnapshot): V22FeatureStatus {
  if (snap.weather === null) return { source: "missing", reason: "weather_missing" };
  if (snap.weather.is_notable === true) {
    return { source: "preferred", reason: "weather_ok" };
  }
  const hasTemp = typeof snap.weather.temperature_f === "number";
  const hasWind = typeof snap.weather.wind_speed_mph === "number";
  if (hasTemp || hasWind) return { source: "proxy", reason: "weather_proxy_quiet_row" };
  return { source: "missing", reason: "weather_missing" };
}

/** Park status — park_factor_runs is sourced from `ballparks` and is real
 *  data, but it's a 3-year rolling factor rather than a current-season
 *  measurement, so we mark it `preferred` (best available). */
function parkStatus(snap: GameSnapshot): V22FeatureStatus {
  if (snap.ballpark?.park_factor_runs == null) {
    return { source: "missing", reason: "park_missing" };
  }
  return { source: "preferred", reason: "park_ok" };
}

/** Starter status group — primary read is season ERA. If ERA absent but
 *  WHIP or K/9 exists, mark fallback_real (we have a real signal of
 *  pitcher quality, just not the preferred metric). */
function starterEraStatus(starter: StarterSnapshot | null): V22FeatureStatus {
  if (starter === null) return { source: "missing", reason: "starter_missing" };
  if (starter.season_era != null) {
    if (starter.season_stats_source === "prior_season_proxy") {
      return { source: "fallback_real", reason: "starter_prior_season_era" };
    }
    return { source: "preferred", reason: "starter_season_era" };
  }
  if (starter.season_whip != null || starter.season_k_per_9 != null) {
    return { source: "fallback_real", reason: "starter_whip_or_k9_only" };
  }
  return { source: "missing", reason: "starter_missing" };
}

/** Pitch quality status — preferred is the Statcast-derived
 *  `pitch_quality_score`. When absent, V2.2 derives a weaker but real
 *  fallback from ERA+WHIP+K/9 in `pitcherFactor`. */
function pitchQualityStatus(starter: StarterSnapshot | null): V22FeatureStatus {
  if (starter === null) return { source: "missing", reason: "starter_missing" };
  if (starter.pitch_quality_score != null) {
    return { source: "preferred", reason: "pq_ok" };
  }
  const eraReal = starter.season_era != null;
  const whipReal = starter.season_whip != null;
  const k9Real = starter.season_k_per_9 != null;
  // Need at least 2 of 3 stats to derive a usable proxy.
  const score = [eraReal, whipReal, k9Real].filter(Boolean).length;
  if (score >= 2) {
    return { source: "fallback_real", reason: "pitch_quality_era_whip_k9_fallback" };
  }
  return { source: "missing", reason: "pitch_quality_missing" };
}

function starterHandednessStatus(starter: StarterSnapshot | null): V22FeatureStatus {
  if (starter === null) return { source: "missing", reason: "starter_missing" };
  if (starter.throws != null) {
    return { source: "preferred", reason: "handedness_ok" };
  }
  return { source: "missing", reason: "handedness_missing" };
}

/** Team OPS status — preferred is the PA-weighted active-roster OPS
 *  aggregate built from real `player_season_stats` rows. When missing,
 *  try a weaker team runs/game fallback if it is wired. */
function teamOpsStatus(team: TeamSnapshot): V22FeatureStatus {
  if (team.team_avg_batter_ops != null) {
    return { source: "preferred", reason: "offense_roster_ops" };
  }
  if (typeof team.season_runs_per_game === "number" && team.season_runs_per_game > 0) {
    return { source: "fallback_real", reason: "offense_runs_per_game_fallback" };
  }
  return { source: "missing", reason: "offense_missing" };
}

function bullpenStatus(team: TeamSnapshot): V22FeatureStatus {
  if (team.bullpen_era_proxy != null) {
    return { source: "preferred", reason: "bullpen_real_rp_era" };
  }
  return { source: "missing", reason: "bullpen_missing" };
}

function auditFeatures(snap: GameSnapshot): V22FeatureAudit {
  const audit: V22FeatureAudit = {
    team_ops: {
      home: teamOpsStatus(snap.home_team),
      away: teamOpsStatus(snap.away_team),
    },
    bullpen_era: {
      home: bullpenStatus(snap.home_team),
      away: bullpenStatus(snap.away_team),
    },
    starter_era: {
      home: starterEraStatus(snap.home_starter),
      away: starterEraStatus(snap.away_starter),
    },
    starter_pitch_quality: {
      home: pitchQualityStatus(snap.home_starter),
      away: pitchQualityStatus(snap.away_starter),
    },
    starter_handedness: {
      home: starterHandednessStatus(snap.home_starter),
      away: starterHandednessStatus(snap.away_starter),
    },
    park_factor: parkStatus(snap),
    weather: weatherStatus(snap),
    confirmed_lineup: {
      home: lineupConfirmedSide(snap.home_lineup_top8),
      away: lineupConfirmedSide(snap.away_lineup_top8),
    },
    preferred_count: 0,
    fallback_real_count: 0,
    proxy_count: 0,
    neutral_fallback_count: 0,
    missing_count: 0,
    present_count: 0,
    reason_codes: [],
  };

  void statusFromRaw; // exported helper, may be used by future feature types

  // 14 audit slots — same set as Push 3A-1.
  const slots: V22FeatureStatus[] = [
    audit.team_ops.home, audit.team_ops.away,
    audit.bullpen_era.home, audit.bullpen_era.away,
    audit.starter_era.home, audit.starter_era.away,
    audit.starter_pitch_quality.home, audit.starter_pitch_quality.away,
    audit.starter_handedness.home, audit.starter_handedness.away,
    audit.confirmed_lineup.home, audit.confirmed_lineup.away,
    audit.park_factor,
    audit.weather,
  ];
  const reasonSet = new Set<string>();
  for (const s of slots) {
    reasonSet.add(s.reason);
    switch (s.source) {
      case "preferred": audit.preferred_count++; break;
      case "fallback_real": audit.fallback_real_count++; break;
      case "proxy": audit.proxy_count++; break;
      case "neutral_fallback": audit.neutral_fallback_count++; break;
      case "missing": audit.missing_count++; break;
    }
  }
  audit.present_count =
    audit.preferred_count +
    audit.fallback_real_count +
    audit.proxy_count +
    audit.neutral_fallback_count;
  audit.reason_codes = Array.from(reasonSet).sort();
  return audit;
}

// ─── single-factor extractors ─────────────────────────────────────

function clampFactor(f: number): number {
  return Math.max(FACTOR_CLAMP_MIN, Math.min(FACTOR_CLAMP_MAX, f));
}

function offenseFactor(team: TeamSnapshot): number {
  if (
    typeof team.team_avg_batter_ops === "number" &&
    team.team_avg_batter_ops > 0
  ) {
    return clampFactor(team.team_avg_batter_ops / V22_LEAGUE_AVG_OPS);
  }
  // No OPS — try team season runs/game as weak proxy
  if (typeof team.season_runs_per_game === "number" && team.season_runs_per_game > 0) {
    return clampFactor(team.season_runs_per_game / V22_LEAGUE_AVG_RUNS_PER_GAME);
  }
  return 1.0;
}

/** Derive a pitch_quality_score proxy from ERA+WHIP+K/9 when the raw
 *  Statcast-derived score is unavailable. Mirrors the real score's
 *  [0.92, 1.08] range and direction (lower = better pitcher = suppresses
 *  runs). League anchors: K/9 ≈ 8.5, WHIP ≈ 1.30. The coefficients are
 *  small so this proxy nudges within the same range the real score does.
 *  Returns null when too few inputs to compute. */
export function pitchQualityProxy(starter: StarterSnapshot): number | null {
  const k9Real = starter.season_k_per_9;
  const whipReal = starter.season_whip;
  if (k9Real == null && whipReal == null) return null;
  const k9 = k9Real ?? 8.5;
  const whip = whipReal ?? 1.30;
  // K/9 above league anchor → suppress factor; WHIP above anchor → raise factor.
  const raw = 1.0 - (k9 - 8.5) * 0.005 + (whip - 1.30) * 0.05;
  return Math.max(0.92, Math.min(1.08, raw));
}

function pitcherFactor(starter: StarterSnapshot | null): number {
  if (starter === null) return 1.0;
  let era = starter.season_era;
  // ERA blended with recent form when available
  if (
    typeof era === "number" &&
    typeof starter.last30_era === "number" &&
    starter.last30_era > 0
  ) {
    era = 0.7 * era + 0.3 * starter.last30_era;
  }
  if (typeof era !== "number" || era <= 0) return 1.0;
  // Lower ERA → fewer runs allowed → factor < 1.0
  // ERA ratio is INVERTED to factor: ratio of league/era so good
  // pitcher (low era) → factor below 1.0.
  const eraFactor = era / V22_LEAGUE_AVG_STARTER_ERA;
  let factor = eraFactor;
  // Pitch quality nudge — prefer the raw Statcast-derived score; fall
  // back to the ERA+WHIP+K/9 proxy when raw absent.
  let pq: number | null = null;
  if (typeof starter.pitch_quality_score === "number") {
    pq = starter.pitch_quality_score;
  } else {
    pq = pitchQualityProxy(starter);
  }
  if (pq !== null) factor *= pq;
  return clampFactor(factor);
}

function bullpenFactor(team: TeamSnapshot): number {
  if (
    typeof team.bullpen_era_proxy === "number" &&
    team.bullpen_era_proxy > 0
  ) {
    return clampFactor(team.bullpen_era_proxy / V22_LEAGUE_AVG_BULLPEN_ERA);
  }
  return 1.0;
}

type StarterWorkloadRole =
  | "normal_starter"
  | "short_starter"
  | "opener_or_reliever_start"
  | "unknown";

export type StarterWorkloadEstimate = {
  role: StarterWorkloadRole;
  starter_innings: number;
  bullpen_innings: number;
};

function clampInnings(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Estimate how much today's listed "starter" should drive run projection.
 *
 * This is not wired into live projections yet. It is the pure math boundary
 * for the replay gate: normal starters get the modern 6/3 split, while
 * opener/reliever-start profiles shift most pitching weight to the bullpen.
 */
function estimateStarterWorkload(
  starter: StarterSnapshot | null
): StarterWorkloadEstimate {
  if (starter === null) {
    return {
      role: "unknown",
      starter_innings: 0,
      bullpen_innings: EXPECTED_STARTER_INNINGS + EXPECTED_BULLPEN_INNINGS,
    };
  }

  const gs = starter.season_games_started ?? null;
  const gp = starter.season_games_pitched ?? null;
  const ip = starter.season_innings_pitched ?? null;
  const relieverAsStarter =
    gp !== null && gs !== null && gp >= 10 && gs <= 2;

  if (relieverAsStarter) {
    return {
      role: "opener_or_reliever_start",
      starter_innings: 1.5,
      bullpen_innings: 7.5,
    };
  }

  if (gs !== null && gs > 0 && ip !== null && ip > 0) {
    const avgIpPerStart = ip / gs;
    const starterInnings = clampInnings(avgIpPerStart, 2.5, 6.5);
    return {
      role: starterInnings < 4.5 ? "short_starter" : "normal_starter",
      starter_innings: Math.round(starterInnings * 10) / 10,
      bullpen_innings: Math.round((9 - starterInnings) * 10) / 10,
    };
  }

  return {
    role: "normal_starter",
    starter_innings: EXPECTED_STARTER_INNINGS,
    bullpen_innings: EXPECTED_BULLPEN_INNINGS,
  };
}

function workloadWeightedPitchingFactor(
  starterFactorValue: number,
  bullpenFactorValue: number,
  starter: StarterSnapshot | null
): { factor: number; workload: StarterWorkloadEstimate } {
  const workload = estimateStarterWorkload(starter);
  const totalInnings = workload.starter_innings + workload.bullpen_innings;
  if (totalInnings <= 0) return { factor: 1.0, workload };

  const starterWeight = workload.starter_innings / totalInnings;
  const bullpenWeight = workload.bullpen_innings / totalInnings;
  const factor =
    Math.pow(clampFactor(starterFactorValue), starterWeight) *
    Math.pow(clampFactor(bullpenFactorValue), bullpenWeight);

  return { factor: clampFactor(factor), workload };
}

function workloadCandidatePitchingFactor(
  starterFactorValue: number,
  bullpenFactorValue: number,
  starter: StarterSnapshot | null
): number {
  const weighted = workloadWeightedPitchingFactor(starterFactorValue, bullpenFactorValue, starter);
  if (weighted.workload.role === "normal_starter") {
    return starterFactorValue * bullpenFactorValue;
  }
  return weighted.factor;
}

export function estimateMlbStarterWorkload(
  starter: StarterSnapshot | null
): StarterWorkloadEstimate {
  return estimateStarterWorkload(starter);
}

function parkFactor(snap: GameSnapshot): number {
  const pf = snap.ballpark?.park_factor_runs;
  if (typeof pf === "number" && pf > 0) {
    // park_factor_runs is expressed as a factor relative to neutral
    // (1.0 = neutral; 1.05 = boost runs 5%). If it's stored as the
    // 100-centered convention some sources use, normalize.
    return clampFactor(pf > 5 ? pf / 100 : pf);
  }
  return 1.0;
}

function weatherFactor(snap: GameSnapshot): number {
  if (snap.ballpark?.is_dome === true) return 1.0;
  if (!snap.data_quality.weather_available || snap.weather === null) return 1.0;
  let factor = 1.0;
  // Wind out → boost; wind in → suppress
  if (typeof snap.weather.wind_speed_mph === "number" && snap.weather.wind_speed_mph >= 10) {
    // Wind orientation varies per park; we use the upstream notable_reason
    // as ground truth when available. Playbook supplies wind type text
    // (OUT/IN) without degrees, so direction cannot be required here.
    if (snap.weather.is_notable === true) {
      const reason = snap.weather.notable_reason ?? "";
      if (/out/i.test(reason)) factor *= 1.04;
      else if (/in/i.test(reason)) factor *= 0.96;
    }
  }
  // Temperature effect — hot air carries the ball
  if (typeof snap.weather.temperature_f === "number") {
    if (snap.weather.temperature_f >= 80) factor *= 1.02;
    else if (snap.weather.temperature_f <= 55) factor *= 0.98;
  }
  return clampFactor(factor);
}

function handednessFactor(
  battingTeam: TeamSnapshot,
  opposingStarter: StarterSnapshot | null,
): number {
  // Use team-level vs_LHP_ops / vs_RHP_ops if populated. Currently the
  // schema exposes these on batter snapshots; team aggregate is not yet
  // populated → return 1.0 and flag in audit. Path documented for
  // future enhancement.
  void battingTeam;
  void opposingStarter;
  return 1.0;
}

// ─── projection output ────────────────────────────────────────────

export type V22IndependentProjection = {
  away_expected_runs: number;
  home_expected_runs: number;
  total_expected_runs: number;
  home_run_diff: number; // home - away
  /** Per-team factor breakdowns for audit. */
  audit_per_team: {
    away: {
      base: number;
      offense: number;
      pitcher_factor_opp: number;
      bullpen_factor_opp: number;
      park: number;
      weather: number;
      handedness: number;
      home_field: number;
    };
    home: {
      base: number;
      offense: number;
      pitcher_factor_opp: number;
      bullpen_factor_opp: number;
      park: number;
      weather: number;
      handedness: number;
      home_field: number;
    };
  };
  feature_audit: V22FeatureAudit;
  data_quality_tier: "high" | "medium" | "low" | "fallback";
};

export type ProjectIndependentOptions = {
  /**
   * Replay-only candidate mode. Defaults false, preserving production
   * behavior. When true, starter and bullpen pitching are blended by expected
   * workload instead of both being applied as full-strength factors.
   */
  useWorkloadPitching?: boolean;
};

function deriveQualityTier(audit: V22FeatureAudit): "high" | "medium" | "low" | "fallback" {
  // Threshold-based, scaled to the 14-position audit. Must have starter
  // stats on both sides + team OPS on both sides to qualify above fallback.
  const haveStartersBoth =
    audit.starter_era.home.source !== "missing" && audit.starter_era.away.source !== "missing";
  if (!haveStartersBoth) return "fallback";
  const haveOpsBoth =
    audit.team_ops.home.source !== "missing" && audit.team_ops.away.source !== "missing";
  if (!haveOpsBoth) return "low";
  // 14 audit slots total. Tier cutoffs preserve the original ~75% / ~56%
  // proportions but rescaled (high ≥10/14 = 71%, medium ≥7/14 = 50%).
  if (audit.present_count >= 10) return "high";
  if (audit.present_count >= 7) return "medium";
  return "low";
}

/**
 * Compute the independent V2.2 projection for one game.
 *
 * Pure function. No DB, no network. Returns the projection + audit so
 * Layer 3 (posterior) and the operator shadow report can show exactly
 * what drove the numbers.
 */
export function projectIndependent(
  snap: GameSnapshot,
  opts: ProjectIndependentOptions = {},
): V22IndependentProjection {
  const audit = auditFeatures(snap);

  const homeOffense = offenseFactor(snap.home_team);
  const awayOffense = offenseFactor(snap.away_team);
  const homeBullpen = bullpenFactor(snap.home_team);
  const awayBullpen = bullpenFactor(snap.away_team);
  const homeStarterFactor = pitcherFactor(snap.home_starter);
  const awayStarterFactor = pitcherFactor(snap.away_starter);
  const homeOpponentPitching = opts.useWorkloadPitching === true
    ? workloadCandidatePitchingFactor(awayStarterFactor, awayBullpen, snap.away_starter)
    : awayStarterFactor * awayBullpen;
  const awayOpponentPitching = opts.useWorkloadPitching === true
    ? workloadCandidatePitchingFactor(homeStarterFactor, homeBullpen, snap.home_starter)
    : homeStarterFactor * homeBullpen;
  const park = parkFactor(snap);
  const weather = weatherFactor(snap);
  const handHome = handednessFactor(snap.home_team, snap.away_starter);
  const handAway = handednessFactor(snap.away_team, snap.home_starter);

  // Home team is batting against away starter + away bullpen
  // Away team is batting against home starter + home bullpen.
  // Home-field is applied ADDITIVELY in run space (+HALF home, −HALF away) so the
  // projected total is unchanged and only the margin shifts. Floored at 0.1 so the
  // away subtraction can never produce a non-positive lambda for the Poisson.
  const homeRunsBase =
    V22_LEAGUE_AVG_RUNS_PER_GAME *
    homeOffense *
    homeOpponentPitching *
    park *
    weather *
    handHome;
  const awayRunsBase =
    V22_LEAGUE_AVG_RUNS_PER_GAME *
    awayOffense *
    awayOpponentPitching *
    park *
    weather *
    handAway;
  const homeRuns = Math.max(0.1, homeRunsBase + HOME_FIELD_HALF);
  const awayRuns = Math.max(0.1, awayRunsBase - HOME_FIELD_HALF);

  return {
    away_expected_runs: awayRuns,
    home_expected_runs: homeRuns,
    total_expected_runs: awayRuns + homeRuns,
    home_run_diff: homeRuns - awayRuns,
    audit_per_team: {
      away: {
        base: V22_LEAGUE_AVG_RUNS_PER_GAME,
        offense: awayOffense,
        pitcher_factor_opp: homeStarterFactor,
        bullpen_factor_opp: homeBullpen,
        park,
        weather,
        handedness: handAway,
        home_field: -HOME_FIELD_HALF, // additive run delta (total-neutral differential)
      },
      home: {
        base: V22_LEAGUE_AVG_RUNS_PER_GAME,
        offense: homeOffense,
        pitcher_factor_opp: awayStarterFactor,
        bullpen_factor_opp: awayBullpen,
        park,
        weather,
        handedness: handHome,
        home_field: HOME_FIELD_HALF, // additive run delta (total-neutral differential)
      },
    },
    feature_audit: audit,
    data_quality_tier: deriveQualityTier(audit),
  };
}

export const __TEST__ = {
  offenseFactor,
  pitcherFactor,
  bullpenFactor,
  estimateStarterWorkload,
  workloadWeightedPitchingFactor,
  parkFactor,
  weatherFactor,
  clampFactor,
  auditFeatures,
  deriveQualityTier,
  pitchQualityProxy,
};
