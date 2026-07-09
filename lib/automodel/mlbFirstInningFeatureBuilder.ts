/**
 * Push 3B — MLB First-Inning V2 feature builder (Layer 1).
 *
 * Estimates the independent first-inning scoring probability for each
 * half-inning by treating the top of the order vs the opposing starter
 * as an independent Poisson process for first-inning runs.
 *
 * Formula:
 *
 *   λ_team_FI =
 *     BASE_FI_LAMBDA
 *     × top_order_factor   (lineup top-3 OPS vs league baseline)
 *     × opp_starter_factor (opposing starter FI ERA — preferred; falls
 *                           back to season ERA proxy when FI absent)
 *     × park_factor        (full-game park factor used as a proxy; FI-
 *                           specific factors not ingested today)
 *     × weather_factor     (small nudge on notable wind/temp)
 *     × handedness_factor  (1.0 today — splits not consumed yet)
 *
 *   P(team scores ≥ 1 in their half) = 1 - exp(-λ)
 *
 * Then:
 *   P(NRFI) = P(away scores 0 in T1) × P(home scores 0 in B1)
 *   P(YRFI) = 1 - P(NRFI)
 *
 * Source/reason hierarchy mirrors Push 3A-2 V2.2:
 *   preferred / fallback_real / proxy / neutral_fallback / missing.
 *
 * Pure / no DB / no network.
 */

import type { GameSnapshot, StarterSnapshot, BatterSnapshot, TeamSnapshot } from "./types";
import { LEAGUE_CONSTANTS_V1, SHRINKAGE_K_TEAM_OPS } from "./types";

// ─── league anchors (post-pitch-clock-era MLB first-inning rates) ──
// Calibrated to match historical MLB NRFI rate ~55%.
//   P(NRFI) = (1 - p)² where p = P(team scores)
//   At league average: NRFI ≈ 0.55 → p ≈ 0.258 → λ ≈ 0.30
export const FI_BASE_LAMBDA_PER_TEAM = 0.30;
export const FI_LEAGUE_AVG_TOP3_OPS = 0.760;     // top-of-order slightly above league avg
export const FI_LEAGUE_AVG_STARTER_FI_ERA = 4.10; // shared with full-game V2.2 anchor
const FACTOR_CLAMP_MIN = 0.55;
const FACTOR_CLAMP_MAX = 1.55;

export type FiFeatureSource =
  | "preferred"
  | "fallback_real"
  | "proxy"
  | "neutral_fallback"
  | "missing";

export type FiFeatureStatus = { source: FiFeatureSource; reason: string };

export type FiFeatureAudit = {
  away_top_order: FiFeatureStatus;
  home_top_order: FiFeatureStatus;
  away_starter_fi: FiFeatureStatus; // the starter the AWAY team faces in B1
  home_starter_fi: FiFeatureStatus; // the starter the HOME team faces in T1 (i.e. away_starter)
  park: FiFeatureStatus;
  weather: FiFeatureStatus;
  away_lineup: FiFeatureStatus;
  home_lineup: FiFeatureStatus;
  preferred_count: number;
  fallback_real_count: number;
  proxy_count: number;
  neutral_fallback_count: number;
  missing_count: number;
  present_count: number;
  reason_codes: string[];
};

export type FiIndependentProjection = {
  /** P(away team scores ≥ 1 in top 1st). */
  away_p_score: number;
  /** P(home team scores ≥ 1 in bottom 1st). */
  home_p_score: number;
  /** λ_away (expected runs in T1). */
  away_lambda: number;
  /** λ_home (expected runs in B1). */
  home_lambda: number;
  /** P(NRFI) = P(away=0) × P(home=0). */
  p_nrfi: number;
  /** P(YRFI) = 1 - P(NRFI). */
  p_yrfi: number;
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  feature_audit: FiFeatureAudit;
  per_team_factors: {
    away: { lambda_base: number; top_order: number; opp_starter: number; park: number; weather: number; handedness: number };
    home: { lambda_base: number; top_order: number; opp_starter: number; park: number; weather: number; handedness: number };
  };
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function shrinkRate(raw: number, n: number | null | undefined, k: number, prior: number): number {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return prior;
  return (n * raw + k * prior) / (n + k);
}

/** Top-3 OPS factor with shrinkage when lineup is partial / projected. */
function topOrderFactor(
  lineup_top8: BatterSnapshot[],
  team: TeamSnapshot,
): { factor: number; status: FiFeatureStatus; lineupStatus: FiFeatureStatus } {
  const top3 = lineup_top8.slice(0, 3);
  const top3WithOps = top3.filter((b) => b.season_ops != null && b.season_ops > 0);
  if (top3.length === 0) {
    if (
      typeof team.team_avg_batter_ops === "number" &&
      Number.isFinite(team.team_avg_batter_ops) &&
      team.team_avg_batter_ops > 0
    ) {
      const effectiveOps = shrinkRate(
        team.team_avg_batter_ops,
        team.team_avg_batter_ops_sample,
        SHRINKAGE_K_TEAM_OPS,
        LEAGUE_CONSTANTS_V1.AVG_OPS,
      );
      return {
        factor: clamp(effectiveOps / FI_LEAGUE_AVG_TOP3_OPS, FACTOR_CLAMP_MIN, FACTOR_CLAMP_MAX),
        status: { source: "proxy", reason: "fi_top_order_team_ops_proxy" },
        lineupStatus: { source: "fallback_real", reason: "fi_lineup_team_offense_proxy" },
      };
    }
    return {
      factor: 1.0,
      status: { source: "neutral_fallback", reason: "fi_top_order_league_average" },
      lineupStatus: { source: "neutral_fallback", reason: "fi_lineup_no_team_offense_proxy" },
    };
  }
  const allConfirmed = top3.every((b) => b.lineup_source === "confirmed");
  const lineupStatus: FiFeatureStatus = top3.length >= 3
    ? allConfirmed
      ? { source: "preferred", reason: "fi_lineup_confirmed" }
      : { source: "fallback_real", reason: "fi_lineup_projected" }
    : { source: "missing", reason: "fi_lineup_partial" };

  if (top3WithOps.length === 0) {
    return {
      factor: 1.0,
      status: { source: "missing", reason: "fi_top_order_no_ops" },
      lineupStatus,
    };
  }
  const meanOps = top3WithOps.reduce((s, b) => s + (b.season_ops ?? 0), 0) / top3WithOps.length;
  const factor = clamp(meanOps / FI_LEAGUE_AVG_TOP3_OPS, FACTOR_CLAMP_MIN, FACTOR_CLAMP_MAX);
  return {
    factor,
    status: { source: "proxy", reason: "fi_top_order_proxy_ops" },
    lineupStatus,
  };
}

/** First-inning starter factor — prefer FI-specific ERA, fall back to season ERA. */
function starterFiFactor(starter: StarterSnapshot | null): { factor: number; status: FiFeatureStatus } {
  if (starter === null) {
    return { factor: 1.0, status: { source: "missing", reason: "fi_starter_missing" } };
  }
  const fiEra = starter.first_inning_era;
  const fiStarts = starter.first_inning_starts;
  // Require ≥5 starts for FI-ERA to be meaningful; below that, treat as proxy.
  if (typeof fiEra === "number" && fiEra > 0 && typeof fiStarts === "number" && fiStarts >= 5) {
    const factor = clamp(fiEra / FI_LEAGUE_AVG_STARTER_FI_ERA, FACTOR_CLAMP_MIN, FACTOR_CLAMP_MAX);
    return { factor, status: { source: "preferred", reason: "fi_starter_first_inning_ok" } };
  }
  if (typeof starter.season_era === "number" && starter.season_era > 0) {
    // Season ERA × 0.7 (FI runs slightly lower historically) is the V1
    // documented proxy convention. Keep direction: high season ERA → still
    // higher FI scoring expectation.
    const proxyEra = starter.season_era * 0.7 + (FI_LEAGUE_AVG_STARTER_FI_ERA * 0.3);
    const factor = clamp(proxyEra / FI_LEAGUE_AVG_STARTER_FI_ERA, FACTOR_CLAMP_MIN, FACTOR_CLAMP_MAX);
    return { factor, status: { source: "proxy", reason: "fi_starter_proxy_season_stats" } };
  }
  return { factor: 1.0, status: { source: "missing", reason: "fi_starter_missing" } };
}

function parkFactor(snap: GameSnapshot): { factor: number; status: FiFeatureStatus } {
  const pf = snap.ballpark?.park_factor_runs;
  if (typeof pf === "number" && pf > 0) {
    // Same normalization as V2.2 full-game (100 → 1.00 OR factor stored as 1.05).
    const normalized = pf > 5 ? pf / 100 : pf;
    return {
      factor: clamp(normalized, FACTOR_CLAMP_MIN, FACTOR_CLAMP_MAX),
      status: { source: "preferred", reason: "fi_park_ok" },
    };
  }
  return { factor: 1.0, status: { source: "missing", reason: "fi_park_missing" } };
}

function weatherFactor(snap: GameSnapshot): { factor: number; status: FiFeatureStatus } {
  if (snap.weather === null) {
    return { factor: 1.0, status: { source: "missing", reason: "fi_weather_missing" } };
  }
  let factor = 1.0;
  let status: FiFeatureStatus = { source: "proxy", reason: "fi_weather_proxy" };
  if (snap.weather.is_notable === true) {
    const reason = snap.weather.notable_reason ?? "";
    if (/out/i.test(reason)) factor *= 1.04;
    else if (/in/i.test(reason)) factor *= 0.96;
    if (typeof snap.weather.temperature_f === "number") {
      if (snap.weather.temperature_f >= 85) factor *= 1.02;
      else if (snap.weather.temperature_f <= 55) factor *= 0.98;
    }
    status = { source: "preferred", reason: "fi_weather_ok" };
  }
  return { factor: clamp(factor, FACTOR_CLAMP_MIN, FACTOR_CLAMP_MAX), status };
}

function deriveTier(audit: FiFeatureAudit): "high" | "medium" | "low" | "fallback" {
  // Both starters must produce a non-missing factor to qualify above
  // fallback (one missing starter → fallback tier, regardless of other data).
  const startersOk =
    audit.away_starter_fi.source !== "missing" &&
    audit.home_starter_fi.source !== "missing";
  if (!startersOk) return "fallback";
  // Need both top-order sides for medium+.
  const topOrderBoth =
    audit.away_top_order.source !== "missing" &&
    audit.home_top_order.source !== "missing";
  if (!topOrderBoth) return "low";
  if (audit.present_count >= 7) return "high";
  if (audit.present_count >= 5) return "medium";
  return "low";
}

/**
 * Compute the independent FI projection. Pure function — no DB, no network.
 */
export function projectFiIndependent(snap: GameSnapshot): FiIndependentProjection {
  // Top-of-order factor + lineup status per team
  const awayTo = topOrderFactor(snap.away_lineup_top8, snap.away_team);
  const homeTo = topOrderFactor(snap.home_lineup_top8, snap.home_team);
  // Opposing starter factor
  // Away team bats in T1 vs HOME starter; so away λ uses home_starter's FI factor.
  const homeStarterFi = starterFiFactor(snap.home_starter);
  // Home team bats in B1 vs AWAY starter; so home λ uses away_starter's FI factor.
  const awayStarterFi = starterFiFactor(snap.away_starter);
  const park = parkFactor(snap);
  const weather = weatherFactor(snap);
  const handednessFactor = 1.0; // splits not yet wired; documented for V3
  const lambdaBase = FI_BASE_LAMBDA_PER_TEAM;

  const awayLambda = clamp(
    lambdaBase * awayTo.factor * homeStarterFi.factor * park.factor * weather.factor * handednessFactor,
    0.05,
    3.0,
  );
  const homeLambda = clamp(
    lambdaBase * homeTo.factor * awayStarterFi.factor * park.factor * weather.factor * handednessFactor,
    0.05,
    3.0,
  );

  const awayPScore = 1 - Math.exp(-awayLambda);
  const homePScore = 1 - Math.exp(-homeLambda);
  const pNrfi = (1 - awayPScore) * (1 - homePScore);
  const pYrfi = 1 - pNrfi;

  const audit: FiFeatureAudit = {
    away_top_order: awayTo.status,
    home_top_order: homeTo.status,
    away_starter_fi: homeStarterFi.status, // the SP that AWAY faces
    home_starter_fi: awayStarterFi.status, // the SP that HOME faces
    park: park.status,
    weather: weather.status,
    away_lineup: awayTo.lineupStatus,
    home_lineup: homeTo.lineupStatus,
    preferred_count: 0,
    fallback_real_count: 0,
    proxy_count: 0,
    neutral_fallback_count: 0,
    missing_count: 0,
    present_count: 0,
    reason_codes: [],
  };

  const slots: FiFeatureStatus[] = [
    audit.away_top_order,
    audit.home_top_order,
    audit.away_starter_fi,
    audit.home_starter_fi,
    audit.park,
    audit.weather,
    audit.away_lineup,
    audit.home_lineup,
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
    audit.preferred_count + audit.fallback_real_count + audit.proxy_count + audit.neutral_fallback_count;
  audit.reason_codes = Array.from(reasonSet).sort();

  return {
    away_p_score: awayPScore,
    home_p_score: homePScore,
    away_lambda: awayLambda,
    home_lambda: homeLambda,
    p_nrfi: pNrfi,
    p_yrfi: pYrfi,
    data_quality_tier: deriveTier(audit),
    feature_audit: audit,
    per_team_factors: {
      away: {
        lambda_base: lambdaBase,
        top_order: awayTo.factor,
        opp_starter: homeStarterFi.factor,
        park: park.factor,
        weather: weather.factor,
        handedness: handednessFactor,
      },
      home: {
        lambda_base: lambdaBase,
        top_order: homeTo.factor,
        opp_starter: awayStarterFi.factor,
        park: park.factor,
        weather: weather.factor,
        handedness: handednessFactor,
      },
    },
  };
}

export const __TEST__ = {
  topOrderFactor,
  starterFiFactor,
  parkFactor,
  weatherFactor,
  deriveTier,
  clamp,
};
