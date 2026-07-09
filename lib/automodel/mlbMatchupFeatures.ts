import type { BatterSnapshot, GameSnapshot, StarterSnapshot } from "./types";

export const MLB_MATCHUP_FEATURE_LAYER_VERSION =
  "mlb_matchup_features_shadow_v1_2026_07_09" as const;

type MatchupFeatureSource = "preferred" | "fallback_real" | "missing";

type MatchupFeatureStatus = {
  source: MatchupFeatureSource;
  reason: string;
};

export type MlbLineupVsStarterMatchup = {
  team: string;
  opposing_starter_name: string | null;
  opposing_starter_throws: "L" | "R" | null;
  top3_ops_vs_throw: number | null;
  top8_ops_vs_throw: number | null;
  top3_sample: number;
  top8_sample: number;
  top3_factor_vs_league: number | null;
  top8_factor_vs_league: number | null;
  status: MatchupFeatureStatus;
};

export type MlbStarterRecentFormMatchup = {
  starter_name: string | null;
  throws: "L" | "R" | null;
  season_era: number | null;
  last30_era: number | null;
  last30_minus_season_era: number | null;
  recent_form: "better" | "worse" | "neutral" | "unknown";
  status: MatchupFeatureStatus;
};

export type MlbMatchupFeatureAudit = {
  schema_version: "mlb_matchup_features_v1";
  layer_version: typeof MLB_MATCHUP_FEATURE_LAYER_VERSION;
  mode: "shadow_only";
  applies_to_model: false;
  lineup_vs_starter: {
    away_batting_vs_home_starter: MlbLineupVsStarterMatchup;
    home_batting_vs_away_starter: MlbLineupVsStarterMatchup;
  };
  starter_recent_form: {
    home_starter: MlbStarterRecentFormMatchup;
    away_starter: MlbStarterRecentFormMatchup;
  };
  summary: {
    preferred_count: number;
    fallback_real_count: number;
    missing_count: number;
    reason_codes: string[];
  };
};

const LEAGUE_AVG_OPS = 0.720;
const RECENT_FORM_NEUTRAL_BAND_ERA = 0.35;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function opsForStarterThrow(batter: BatterSnapshot, throws: "L" | "R" | null): {
  ops: number | null;
  source: "split" | "season" | "missing";
} {
  if (throws === "L" && typeof batter.vs_lhp_ops === "number" && batter.vs_lhp_ops > 0) {
    return { ops: batter.vs_lhp_ops, source: "split" };
  }
  if (throws === "R" && typeof batter.vs_rhp_ops === "number" && batter.vs_rhp_ops > 0) {
    return { ops: batter.vs_rhp_ops, source: "split" };
  }
  if (typeof batter.season_ops === "number" && batter.season_ops > 0) {
    return { ops: batter.season_ops, source: "season" };
  }
  return { ops: null, source: "missing" };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function lineupMatchup(args: {
  team: string;
  lineup: BatterSnapshot[];
  opposingStarter: StarterSnapshot | null;
}): MlbLineupVsStarterMatchup {
  const throws = args.opposingStarter?.throws ?? null;
  const top8 = args.lineup.slice(0, 8);
  const top3 = top8.slice(0, 3);
  const top3Read = top3.map((batter) => opsForStarterThrow(batter, throws));
  const top8Read = top8.map((batter) => opsForStarterThrow(batter, throws));
  const top3SplitCount = top3Read.filter((r) => r.source === "split").length;
  const top8SplitCount = top8Read.filter((r) => r.source === "split").length;
  const top3OpsValues = top3Read.map((r) => r.ops).filter((v): v is number => v !== null);
  const top8OpsValues = top8Read.map((r) => r.ops).filter((v): v is number => v !== null);
  const top3Ops = mean(top3OpsValues);
  const top8Ops = mean(top8OpsValues);
  let status: MatchupFeatureStatus;
  if (throws === null) {
    status = { source: "missing", reason: "opposing_starter_handedness_missing" };
  } else if (top3SplitCount >= 2 || top8SplitCount >= 5) {
    status = { source: "preferred", reason: "lineup_handedness_splits_available" };
  } else if (top3OpsValues.length >= 2 || top8OpsValues.length >= 5) {
    status = { source: "fallback_real", reason: "lineup_season_ops_fallback" };
  } else {
    status = { source: "missing", reason: "lineup_ops_missing" };
  }

  return {
    team: args.team,
    opposing_starter_name: args.opposingStarter?.player_name ?? null,
    opposing_starter_throws: throws,
    top3_ops_vs_throw: top3Ops === null ? null : round3(top3Ops),
    top8_ops_vs_throw: top8Ops === null ? null : round3(top8Ops),
    top3_sample: top3OpsValues.length,
    top8_sample: top8OpsValues.length,
    top3_factor_vs_league: top3Ops === null ? null : round3(top3Ops / LEAGUE_AVG_OPS),
    top8_factor_vs_league: top8Ops === null ? null : round3(top8Ops / LEAGUE_AVG_OPS),
    status,
  };
}

function starterRecentForm(starter: StarterSnapshot | null): MlbStarterRecentFormMatchup {
  if (starter === null) {
    return {
      starter_name: null,
      throws: null,
      season_era: null,
      last30_era: null,
      last30_minus_season_era: null,
      recent_form: "unknown",
      status: { source: "missing", reason: "starter_missing" },
    };
  }
  const seasonEra = starter.season_era;
  const last30 = starter.last30_era;
  if (typeof seasonEra !== "number" || typeof last30 !== "number" || seasonEra <= 0 || last30 <= 0) {
    return {
      starter_name: starter.player_name,
      throws: starter.throws,
      season_era: seasonEra,
      last30_era: last30,
      last30_minus_season_era: null,
      recent_form: "unknown",
      status: { source: "fallback_real", reason: "starter_recent_form_incomplete" },
    };
  }
  const delta = last30 - seasonEra;
  return {
    starter_name: starter.player_name,
    throws: starter.throws,
    season_era: round2(seasonEra),
    last30_era: round2(last30),
    last30_minus_season_era: round2(delta),
    recent_form:
      delta <= -RECENT_FORM_NEUTRAL_BAND_ERA
        ? "better"
        : delta >= RECENT_FORM_NEUTRAL_BAND_ERA
          ? "worse"
          : "neutral",
    status: { source: "preferred", reason: "starter_recent_form_available" },
  };
}

function countStatuses(statuses: MatchupFeatureStatus[]): MlbMatchupFeatureAudit["summary"] {
  const reasonCodes = new Set<string>();
  let preferred = 0;
  let fallback = 0;
  let missing = 0;
  for (const status of statuses) {
    reasonCodes.add(status.reason);
    if (status.source === "preferred") preferred++;
    else if (status.source === "fallback_real") fallback++;
    else missing++;
  }
  return {
    preferred_count: preferred,
    fallback_real_count: fallback,
    missing_count: missing,
    reason_codes: [...reasonCodes].sort(),
  };
}

export function buildMlbMatchupFeatureAudit(snap: GameSnapshot): MlbMatchupFeatureAudit {
  const awayVsHomeStarter = lineupMatchup({
    team: snap.away_team.abbreviation,
    lineup: snap.away_lineup_top8,
    opposingStarter: snap.home_starter,
  });
  const homeVsAwayStarter = lineupMatchup({
    team: snap.home_team.abbreviation,
    lineup: snap.home_lineup_top8,
    opposingStarter: snap.away_starter,
  });
  const homeStarterForm = starterRecentForm(snap.home_starter);
  const awayStarterForm = starterRecentForm(snap.away_starter);
  return {
    schema_version: "mlb_matchup_features_v1",
    layer_version: MLB_MATCHUP_FEATURE_LAYER_VERSION,
    mode: "shadow_only",
    applies_to_model: false,
    lineup_vs_starter: {
      away_batting_vs_home_starter: awayVsHomeStarter,
      home_batting_vs_away_starter: homeVsAwayStarter,
    },
    starter_recent_form: {
      home_starter: homeStarterForm,
      away_starter: awayStarterForm,
    },
    summary: countStatuses([
      awayVsHomeStarter.status,
      homeVsAwayStarter.status,
      homeStarterForm.status,
      awayStarterForm.status,
    ]),
  };
}

export const __TEST__ = {
  lineupMatchup,
  starterRecentForm,
};
