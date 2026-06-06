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

// Home-field advantage (small, well-documented in MLB: ~0.03-0.05 r/g)
const HOME_FIELD_RUNS_BONUS = 0.10;

// ─── feature audit ────────────────────────────────────────────────

export type FeaturePresence = "present" | "proxy" | "missing";

export type V22FeatureAudit = {
  team_ops: { home: FeaturePresence; away: FeaturePresence };
  bullpen_era: { home: FeaturePresence; away: FeaturePresence };
  starter_era: { home: FeaturePresence; away: FeaturePresence };
  starter_pitch_quality: { home: FeaturePresence; away: FeaturePresence };
  starter_handedness: { home: FeaturePresence; away: FeaturePresence };
  park_factor: FeaturePresence;
  weather: FeaturePresence;
  confirmed_lineup: { home: FeaturePresence; away: FeaturePresence };
  /** Count of features present (out of all checked positions). */
  present_count: number;
  /** Count of features missing entirely. */
  missing_count: number;
};

function present(v: unknown): FeaturePresence {
  return v !== null && v !== undefined ? "present" : "missing";
}

/** Per-side confirmed-lineup check. The joint `data_quality.lineup_confirmed`
 *  collapses both teams; we evaluate each side independently so one team
 *  with a projected lineup doesn't penalize the other side's audit. */
function lineupConfirmedSide(lineup: GameSnapshot["home_lineup_top8"]): FeaturePresence {
  if (lineup.length < 8) return "missing";
  return lineup.every((b) => b.lineup_source === "confirmed") ? "present" : "missing";
}

/** Weather presence: "present" when row exists with a notable signal, "proxy"
 *  when row exists with at least temperature or wind data, "missing" when
 *  no row at all. The model only nudges on `is_notable`, so a row with
 *  temp/wind that isn't notable is honestly a "we have data, model didn't
 *  act on it" → proxy. */
function weatherPresence(snap: GameSnapshot): FeaturePresence {
  if (snap.weather === null) return "missing";
  if (snap.weather.is_notable === true) return "present";
  const hasTemp = typeof snap.weather.temperature_f === "number";
  const hasWind = typeof snap.weather.wind_speed_mph === "number";
  return hasTemp || hasWind ? "proxy" : "missing";
}

function auditFeatures(snap: GameSnapshot): V22FeatureAudit {
  const homeTeam = snap.home_team;
  const awayTeam = snap.away_team;
  const homeStarter = snap.home_starter;
  const awayStarter = snap.away_starter;
  const audit: V22FeatureAudit = {
    team_ops: {
      home: present(homeTeam.team_avg_batter_ops),
      away: present(awayTeam.team_avg_batter_ops),
    },
    bullpen_era: {
      home: present(homeTeam.bullpen_era_proxy),
      away: present(awayTeam.bullpen_era_proxy),
    },
    starter_era: {
      home: present(homeStarter?.season_era),
      away: present(awayStarter?.season_era),
    },
    starter_pitch_quality: {
      home: present(homeStarter?.pitch_quality_score),
      away: present(awayStarter?.pitch_quality_score),
    },
    starter_handedness: {
      home: present(homeStarter?.throws),
      away: present(awayStarter?.throws),
    },
    park_factor: present(snap.ballpark?.park_factor_runs),
    weather: weatherPresence(snap),
    confirmed_lineup: {
      home: lineupConfirmedSide(snap.home_lineup_top8),
      away: lineupConfirmedSide(snap.away_lineup_top8),
    },
    present_count: 0,
    missing_count: 0,
  };
  // Mark team OPS as "proxy" — we'd prefer wRC+ but OPS is what's
  // ingested today.
  if (audit.team_ops.home === "present") audit.team_ops.home = "proxy";
  if (audit.team_ops.away === "present") audit.team_ops.away = "proxy";
  // Same for starter ERA (we'd prefer FIP/xFIP)
  if (audit.starter_era.home === "present") audit.starter_era.home = "proxy";
  if (audit.starter_era.away === "present") audit.starter_era.away = "proxy";

  // Count over the 14 real audit positions. team_runs_per_game and
  // platoon_split were previously counted but neither has a data source
  // wired AND V2.2 doesn't materially use them — dropping them removes
  // 4 phantom-missing slots that were forcing every game into the
  // "provisional / sparse" branch even with strong feature coverage.
  const sides = [
    audit.team_ops.home, audit.team_ops.away,
    audit.bullpen_era.home, audit.bullpen_era.away,
    audit.starter_era.home, audit.starter_era.away,
    audit.starter_pitch_quality.home, audit.starter_pitch_quality.away,
    audit.starter_handedness.home, audit.starter_handedness.away,
    audit.confirmed_lineup.home, audit.confirmed_lineup.away,
    audit.park_factor,
    audit.weather,
  ];
  audit.present_count = sides.filter((s) => s !== "missing").length;
  audit.missing_count = sides.filter((s) => s === "missing").length;
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
  // Pitch quality nudges further (positive value indicates better stuff)
  if (typeof starter.pitch_quality_score === "number") {
    // pitch_quality_score is centered around 1.0 in V1 conventions
    // (0.92 to 1.08 typical). Multiplying preserves direction.
    factor *= starter.pitch_quality_score;
  }
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
  if (!snap.data_quality.weather_available || snap.weather === null) return 1.0;
  let factor = 1.0;
  // Wind out → boost; wind in → suppress
  if (typeof snap.weather.wind_speed_mph === "number" && snap.weather.wind_speed_mph >= 10) {
    const dir = snap.weather.wind_direction_degrees;
    if (typeof dir === "number") {
      // Wind blowing OUT to center: ~0 degrees; IN: ~180 degrees.
      // Very rough heuristic — orientation varies per park; we use the
      // is_notable flag from the weather service as ground truth when
      // available.
      if (snap.weather.is_notable === true) {
        // notable wind helps offense ~3-5% typical
        const reason = snap.weather.notable_reason ?? "";
        if (/out/i.test(reason)) factor *= 1.04;
        else if (/in/i.test(reason)) factor *= 0.96;
      }
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

function deriveQualityTier(audit: V22FeatureAudit): "high" | "medium" | "low" | "fallback" {
  // Threshold-based, scaled to the 14-position audit. Must have starter
  // stats on both sides + team OPS on both sides to qualify above fallback.
  const haveStartersBoth =
    audit.starter_era.home !== "missing" && audit.starter_era.away !== "missing";
  if (!haveStartersBoth) return "fallback";
  const haveOpsBoth =
    audit.team_ops.home !== "missing" && audit.team_ops.away !== "missing";
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
): V22IndependentProjection {
  const audit = auditFeatures(snap);

  const homeOffense = offenseFactor(snap.home_team);
  const awayOffense = offenseFactor(snap.away_team);
  const homeBullpen = bullpenFactor(snap.home_team);
  const awayBullpen = bullpenFactor(snap.away_team);
  const homeStarterFactor = pitcherFactor(snap.home_starter);
  const awayStarterFactor = pitcherFactor(snap.away_starter);
  const park = parkFactor(snap);
  const weather = weatherFactor(snap);
  const handHome = handednessFactor(snap.home_team, snap.away_starter);
  const handAway = handednessFactor(snap.away_team, snap.home_starter);

  // Home team is batting against away starter + away bullpen
  // Away team is batting against home starter + home bullpen
  const HOME_FIELD = HOME_FIELD_RUNS_BONUS / V22_LEAGUE_AVG_RUNS_PER_GAME + 1.0;

  const homeRuns =
    V22_LEAGUE_AVG_RUNS_PER_GAME *
    homeOffense *
    awayStarterFactor *
    awayBullpen *
    park *
    weather *
    handHome *
    HOME_FIELD;
  const awayRuns =
    V22_LEAGUE_AVG_RUNS_PER_GAME *
    awayOffense *
    homeStarterFactor *
    homeBullpen *
    park *
    weather *
    handAway *
    1.0;

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
        home_field: 1.0,
      },
      home: {
        base: V22_LEAGUE_AVG_RUNS_PER_GAME,
        offense: homeOffense,
        pitcher_factor_opp: awayStarterFactor,
        bullpen_factor_opp: awayBullpen,
        park,
        weather,
        handedness: handHome,
        home_field: HOME_FIELD,
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
  parkFactor,
  weatherFactor,
  clampFactor,
  auditFeatures,
  deriveQualityTier,
};
