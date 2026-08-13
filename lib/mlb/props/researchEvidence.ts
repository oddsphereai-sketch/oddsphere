import type { MlbPropMarketKey } from "./config";
import { resolveMlbStatsTeamId, resolveMlbTeamAlias } from "./mlbTeamAliases";
import type { BdlHitterPitchTypeStat, BdlPitchTypeStat, BdlResearchPlayer } from "./ballDontLieResearch";
import type { MlbHistoricalStatRow } from "./providers";
import type { BatterVsPitcherStatsRecord, MlbTeamHittingProfile } from "@/lib/providers/real_api/_mlbStatsApiClient";

export type PlayerPropRecentForm = {
  statLabel: string;
  sampleLabel: "games" | "starts";
  source: string;
  asOfTimestamp: string;
  coverage: "full_season" | "recent_only";
  samples?: {
    last5: PlayerPropRecentFormSample;
    last10: PlayerPropRecentFormSample;
    season: PlayerPropRecentFormSample;
  };
  doublesResidualFeatures?: {
    plateAppearancesLast5: number;
    rbisLast5: number;
    rbisSeason: number;
    runsLast10: number;
    walksLast20: number;
    walksSeason: number;
    doublesLast20: number[];
  };
  logs: Array<{
    gameId: string;
    date: string;
    opponent: string;
    homeAway: "home" | "away";
    value: number;
    plateAppearances?: number | null;
    secondaryLabel?: string | null;
  }>;
};

export type PlayerPropRecentFormSample = {
  count: number;
  average: number | null;
  values: number[];
};

export type RankedResearchMetric = {
  value: number | null;
  leagueAverage: number | null;
  rank: number | null;
  rankOutOf: number;
};

export type PlayerPropOpponentProfile = {
  teamId: number;
  teamName: string;
  teamAbbreviation: string;
  season: number;
  gamesPlayed: number | null;
  plateAppearances: number;
  strikeoutRate: RankedResearchMetric;
  walkRate: RankedResearchMetric;
  battingAverage: RankedResearchMetric;
  ops: RankedResearchMetric;
  homeRunRate: RankedResearchMetric;
  summary: string;
  source: "MLB Stats";
  asOfTimestamp: string;
  researchOnly: true;
};

export type PlayerPitchArsenalEvidence = {
  playerId: number;
  throws: "L" | "R" | null;
  season: number;
  pitchesTracked: number;
  gamesBackfilled: number | null;
  lastGameDate: string;
  pitches: Array<{
    code: string;
    name: string;
    pitchCount: number;
    usagePercent: number;
    whiffPercent: number | null;
    chasePercent: number | null;
    zonePercent: number | null;
    battingAverageAllowed: number | null;
    xwobaAllowed: number | null;
  }>;
  source: "Ball Don't Lie";
  asOfTimestamp: string;
  researchOnly: true;
};

export type PlayerPitchMixMatchupEvidence = {
  hitterId: number;
  hitterName: string;
  hitterBats: "L" | "R" | "S" | null;
  pitcherId: number;
  pitcherName: string;
  pitcherThrows: "L" | "R" | null;
  season: number;
  coverageStatus: "available" | "partial";
  pitchMixCoveragePercent: number;
  matchedPitchTypes: number;
  hitterPitchesSeen: number;
  weighted: {
    battingAverage: number | null;
    slugging: number | null;
    xwoba: number | null;
    whiffPercent: number | null;
  };
  pitches: Array<{
    code: string;
    name: string;
    pitcherUsagePercent: number;
    hitterPitchCount: number;
    hitterPlateAppearances: number | null;
    battingAverage: number | null;
    slugging: number | null;
    xwoba: number | null;
    whiffPercent: number | null;
  }>;
  summary: string;
  source: "Ball Don't Lie";
  lastGameDate: string;
  asOfTimestamp: string;
  researchOnly: true;
};

export type PlayerBatterPitcherHistoryEvidence = {
  status: "available" | "no_history";
  hitterMlbId: number;
  pitcherMlbId: number;
  hitterName: string;
  pitcherName: string;
  gamesPlayed: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  totalBases: number;
  rbis: number;
  battingAverage: number | null;
  onBasePercentage: number | null;
  sluggingPercentage: number | null;
  ops: number | null;
  pitchesSeen: number;
  source: "MLB Stats";
  asOfTimestamp: string;
  researchOnly: true;
};

export type ResearchEvidenceStatus = "available" | "pending" | "unavailable";

export type PlayerPropEnvironmentEvidence = {
  venue: string | null;
  roofStatus: "outdoor" | "dome" | "retractable" | "unknown";
  source: string;
  asOfTimestamp: string;
  park: {
    status: ResearchEvidenceStatus;
    runFactor: number | null;
    homeRunFactor: number | null;
    strikeoutFactor: number | null;
    source: string | null;
  };
  weather: {
    status: ResearchEvidenceStatus;
    temperatureF: number | null;
    conditions: string | null;
    windSpeedMph: number | null;
    windDirection: string | null;
    precipitationProbability: number | null;
    source: string | null;
  };
  researchOnly: true;
};

type MarketLogDescriptor = {
  statKey: string;
  statLabel: string;
  sampleLabel: PlayerPropRecentForm["sampleLabel"];
};

const PITCHER_LOG_MARKETS: Partial<Record<MlbPropMarketKey, MarketLogDescriptor>> = {
  pitcher_strikeouts: { statKey: "strikeouts", statLabel: "Strikeouts", sampleLabel: "starts" },
  pitcher_outs: { statKey: "outs", statLabel: "Outs recorded", sampleLabel: "starts" },
  pitcher_hits_allowed: { statKey: "hits_allowed", statLabel: "Hits allowed", sampleLabel: "starts" },
  pitcher_walks: { statKey: "walks", statLabel: "Walks allowed", sampleLabel: "starts" },
  pitcher_earned_runs: { statKey: "earned_runs", statLabel: "Earned runs allowed", sampleLabel: "starts" },
  batter_strikeouts: { statKey: "strikeouts", statLabel: "Strikeouts", sampleLabel: "games" },
  batter_hits: { statKey: "hits", statLabel: "Hits", sampleLabel: "games" },
  batter_total_bases: { statKey: "total_bases", statLabel: "Total bases", sampleLabel: "games" },
  batter_home_runs: { statKey: "home_runs", statLabel: "Home runs", sampleLabel: "games" },
  batter_rbis: { statKey: "rbis", statLabel: "RBIs", sampleLabel: "games" },
  batter_runs_scored: { statKey: "runs", statLabel: "Runs", sampleLabel: "games" },
  batter_stolen_bases: { statKey: "stolen_bases", statLabel: "Stolen bases", sampleLabel: "games" },
  batter_walks: { statKey: "walks", statLabel: "Walks", sampleLabel: "games" },
  batter_hits_runs_rbis: { statKey: "hits_runs_rbis", statLabel: "Hits + runs + RBIs", sampleLabel: "games" },
  batter_singles: { statKey: "singles", statLabel: "Singles", sampleLabel: "games" },
  batter_doubles: { statKey: "doubles", statLabel: "Doubles", sampleLabel: "games" },
  batter_triples: { statKey: "triples", statLabel: "Triples", sampleLabel: "games" },
  first_home_run: { statKey: "home_runs", statLabel: "Home runs", sampleLabel: "games" },
};

// A defensive replacement or pinch runner can receive an official game-log
// row with zero plate appearances. That is a real appearance, but it is not a
// batting opportunity and must not count as a zero in batting-event form.
// Runs and stolen bases remain appearance-based because a pinch runner can
// record either without taking a plate appearance.
const BATTER_MARKETS_REQUIRING_PLATE_APPEARANCE = new Set<MlbPropMarketKey>([
  "batter_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_walks",
  "batter_singles",
  "batter_doubles",
  "batter_triples",
  "first_home_run",
]);

export function buildPlayerPropRecentForm(args: {
  logs: MlbHistoricalStatRow[];
  marketKey: MlbPropMarketKey;
  asOfTimestamp: string;
  coverage?: PlayerPropRecentForm["coverage"];
}): PlayerPropRecentForm | null {
  const descriptor = PITCHER_LOG_MARKETS[args.marketKey];
  if (!descriptor) return null;
  const asOf = new Date(args.asOfTimestamp).getTime();
  const priorLogs = args.logs
    .filter((row) => new Date(row.asOfTimestamp ?? `${row.gameDate}T23:59:59.999Z`).getTime() < asOf)
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate));
  const sourceLogs = priorLogs
    .filter((row) => {
      if (!BATTER_MARKETS_REQUIRING_PLATE_APPEARANCE.has(args.marketKey)) return true;
      const plateAppearances = row.stats.plate_appearances;
      return typeof plateAppearances !== "number" || plateAppearances > 0;
    });
  const logs = sourceLogs
    .map((row) => {
      const value = row.stats[descriptor.statKey];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      const opponentName = typeof row.stats.opponent_name === "string" ? row.stats.opponent_name : null;
      const opponent = resolveMlbStatsTeamId(row.opponentTeamId)?.abbreviation
        ?? resolveMlbTeamAlias(opponentName)?.abbreviation
        ?? opponentName
        ?? row.opponentTeamId;
      const homeAway = row.stats.home_away === "home" ? "home" : "away";
      return {
        gameId: row.gameId,
        date: row.gameDate,
        opponent,
        homeAway,
        value,
        plateAppearances: typeof row.stats.plate_appearances === "number"
          ? row.stats.plate_appearances
          : null,
        secondaryLabel: buildSecondaryLabel(row, descriptor),
      } satisfies PlayerPropRecentForm["logs"][number];
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (!logs.length) return null;
  return {
    statLabel: descriptor.statLabel,
    sampleLabel: descriptor.sampleLabel,
    source: "MLB Stats",
    asOfTimestamp: args.asOfTimestamp,
    coverage: args.coverage ?? "recent_only",
    samples: {
      last5: recentFormSample(logs.slice(0, 5).map((row) => row.value)),
      last10: recentFormSample(logs.slice(0, 10).map((row) => row.value)),
      season: recentFormSample(logs.map((row) => row.value)),
    },
    doublesResidualFeatures: args.marketKey === "batter_doubles"
      ? buildDoublesResidualFeatures(priorLogs)
      : undefined,
    logs,
  };
}

function buildDoublesResidualFeatures(
  logs: MlbHistoricalStatRow[],
): NonNullable<PlayerPropRecentForm["doublesResidualFeatures"]> {
  return {
    plateAppearancesLast5: statAverage(logs.slice(0, 5), "plate_appearances"),
    rbisLast5: statAverage(logs.slice(0, 5), "rbis"),
    rbisSeason: statAverage(logs, "rbis"),
    runsLast10: statAverage(logs.slice(0, 10), "runs"),
    walksLast20: statAverage(logs.slice(0, 20), "walks"),
    walksSeason: statAverage(logs, "walks"),
    doublesLast20: logs.slice(0, 20)
      .map((row) => row.stats.doubles)
      .filter((value): value is number =>
        typeof value === "number" && Number.isFinite(value)),
  };
}

function statAverage(logs: MlbHistoricalStatRow[], key: string): number {
  const values = logs
    .map((row) => row.stats[key])
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value));
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function recentFormSample(values: number[]): PlayerPropRecentFormSample {
  const finite = values.filter((value) => Number.isFinite(value));
  return {
    count: finite.length,
    average: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null,
    values: finite,
  };
}

export function buildPlayerPropOpponentProfile(args: {
  profiles: MlbTeamHittingProfile[];
  opponentTeamId: string | number;
  marketKey: MlbPropMarketKey;
  asOfTimestamp: string;
}): PlayerPropOpponentProfile | null {
  const requestedAlias = resolveMlbStatsTeamId(args.opponentTeamId) ?? resolveMlbTeamAlias(String(args.opponentTeamId));
  const profile = args.profiles.find((candidate) => {
    if (String(candidate.team_id) === String(args.opponentTeamId).replace(/^mlbstats-team-/, "")) return true;
    return requestedAlias?.abbreviation === resolveMlbStatsTeamId(candidate.team_id)?.abbreviation;
  });
  if (!profile) return null;
  const alias = resolveMlbStatsTeamId(profile.team_id);
  const metric = (
    value: number | null,
    leagueAverage: number | null,
    rank: number | null
  ): RankedResearchMetric => ({ value, leagueAverage, rank, rankOutOf: profile.ranks.out_of });
  const evidence: PlayerPropOpponentProfile = {
    teamId: profile.team_id,
    teamName: profile.team_name,
    teamAbbreviation: alias?.abbreviation ?? profile.team_name,
    season: profile.season,
    gamesPlayed: profile.games_played,
    plateAppearances: profile.plate_appearances,
    strikeoutRate: metric(profile.strikeout_rate, profile.league_average.strikeout_rate, profile.ranks.strikeout_rate),
    walkRate: metric(profile.walk_rate, profile.league_average.walk_rate, profile.ranks.walk_rate),
    battingAverage: metric(profile.batting_average, profile.league_average.batting_average, profile.ranks.batting_average),
    ops: metric(profile.ops, profile.league_average.ops, profile.ranks.ops),
    homeRunRate: metric(profile.home_run_rate, profile.league_average.home_run_rate, profile.ranks.home_run_rate),
    summary: opponentProfileSummary(profile, args.marketKey),
    source: "MLB Stats",
    asOfTimestamp: args.asOfTimestamp,
    researchOnly: true,
  };
  return evidence;
}

export function buildPlayerPitchArsenalEvidence(args: {
  player: BdlResearchPlayer;
  pitchTypes: BdlPitchTypeStat[];
  asOfTimestamp: string;
}): PlayerPitchArsenalEvidence | null {
  const rows = args.pitchTypes
    .filter((row) => row.playerId === args.player.playerId)
    .filter((row) => new Date(`${row.lastGameDate}T23:59:59.999Z`).getTime() < new Date(args.asOfTimestamp).getTime())
    .sort((a, b) => b.usagePercent - a.usagePercent);
  if (!rows.length) return null;
  const latestDate = rows.reduce((latest, row) => row.lastGameDate > latest ? row.lastGameDate : latest, rows[0].lastGameDate);
  return {
    playerId: args.player.playerId,
    throws: args.player.throws,
    season: rows[0].season,
    pitchesTracked: Math.max(...rows.map((row) => row.seasonPitchCount ?? 0), rows.reduce((sum, row) => sum + row.pitchCount, 0)),
    gamesBackfilled: maxNullable(rows.map((row) => row.gamesBackfilled)),
    lastGameDate: latestDate,
    pitches: rows.map((row) => ({
      code: row.pitchType,
      name: row.pitchName,
      pitchCount: row.pitchCount,
      usagePercent: row.usagePercent,
      whiffPercent: row.whiffPercent,
      chasePercent: row.chasePercent,
      zonePercent: row.zonePercent,
      battingAverageAllowed: row.battingAverageAllowed,
      xwobaAllowed: row.xwobaAllowed,
    })),
    source: "Ball Don't Lie",
    asOfTimestamp: args.asOfTimestamp,
    researchOnly: true,
  };
}

export function buildPlayerPitchMixMatchupEvidence(args: {
  hitter: BdlResearchPlayer;
  pitcher: BdlResearchPlayer;
  hitterPitchTypes: BdlHitterPitchTypeStat[];
  pitcherPitchTypes: BdlPitchTypeStat[];
  asOfTimestamp: string;
  minimumFullCoveragePercent?: number;
}): PlayerPitchMixMatchupEvidence | null {
  const asOf = new Date(args.asOfTimestamp).getTime();
  const beforeAsOf = (lastGameDate: string) => new Date(`${lastGameDate}T23:59:59.999Z`).getTime() < asOf;
  const pitcherRows = args.pitcherPitchTypes
    .filter((row) => row.playerId === args.pitcher.playerId && beforeAsOf(row.lastGameDate))
    .sort((a, b) => b.usagePercent - a.usagePercent);
  const hitterRows = args.hitterPitchTypes
    .filter((row) => row.playerId === args.hitter.playerId && beforeAsOf(row.lastGameDate));
  if (!pitcherRows.length || !hitterRows.length) return null;

  const hitterByPitch = new Map(hitterRows.map((row) => [row.pitchType.toUpperCase(), row]));
  const pitches = pitcherRows.flatMap((pitcherRow) => {
    const hitterRow = hitterByPitch.get(pitcherRow.pitchType.toUpperCase());
    if (!hitterRow) return [];
    return [{
      code: pitcherRow.pitchType,
      name: pitcherRow.pitchName,
      pitcherUsagePercent: pitcherRow.usagePercent,
      hitterPitchCount: hitterRow.pitchCount,
      hitterPlateAppearances: hitterRow.plateAppearances,
      battingAverage: hitterRow.battingAverage,
      slugging: hitterRow.slugging,
      xwoba: hitterRow.xwoba,
      whiffPercent: hitterRow.whiffPercent,
    }];
  });
  if (!pitches.length) return null;

  const totalUsage = pitcherRows.reduce((sum, row) => sum + Math.max(0, row.usagePercent), 0);
  const matchedUsage = pitches.reduce((sum, row) => sum + Math.max(0, row.pitcherUsagePercent), 0);
  if (totalUsage <= 0 || matchedUsage <= 0) return null;
  const pitchMixCoveragePercent = Math.min(100, matchedUsage / totalUsage * 100);
  const weighted = {
    battingAverage: weightedPitchMetric(pitches, (row) => row.battingAverage),
    slugging: weightedPitchMetric(pitches, (row) => row.slugging),
    xwoba: weightedPitchMetric(pitches, (row) => row.xwoba),
    whiffPercent: weightedPitchMetric(pitches, (row) => row.whiffPercent),
  };
  const latestDate = [...pitcherRows, ...hitterRows]
    .reduce((latest, row) => row.lastGameDate > latest ? row.lastGameDate : latest, pitcherRows[0].lastGameDate);
  const fullCoverageThreshold = args.minimumFullCoveragePercent ?? 70;
  const coverageStatus = pitchMixCoveragePercent >= fullCoverageThreshold && pitches.length >= 2 ? "available" : "partial";
  return {
    hitterId: args.hitter.playerId,
    hitterName: args.hitter.fullName,
    hitterBats: args.hitter.bats,
    pitcherId: args.pitcher.playerId,
    pitcherName: args.pitcher.fullName,
    pitcherThrows: args.pitcher.throws,
    season: pitcherRows[0].season,
    coverageStatus,
    pitchMixCoveragePercent,
    matchedPitchTypes: pitches.length,
    hitterPitchesSeen: pitches.reduce((sum, row) => sum + row.hitterPitchCount, 0),
    weighted,
    pitches,
    summary: pitchMixSummary(args.hitter.fullName, args.pitcher.fullName, pitchMixCoveragePercent, weighted),
    source: "Ball Don't Lie",
    lastGameDate: latestDate,
    asOfTimestamp: args.asOfTimestamp,
    researchOnly: true,
  };
}

export function buildPlayerBatterPitcherHistoryEvidence(args: {
  record: BatterVsPitcherStatsRecord;
  hitterName: string;
  pitcherName: string;
  asOfTimestamp: string;
}): PlayerBatterPitcherHistoryEvidence {
  return {
    status: args.record.plate_appearances > 0 ? "available" : "no_history",
    hitterMlbId: args.record.batter_id,
    pitcherMlbId: args.record.pitcher_id,
    hitterName: args.record.batter_name ?? args.hitterName,
    pitcherName: args.record.pitcher_name ?? args.pitcherName,
    gamesPlayed: args.record.games_played,
    plateAppearances: args.record.plate_appearances,
    atBats: args.record.at_bats,
    hits: args.record.hits,
    doubles: args.record.doubles,
    triples: args.record.triples,
    homeRuns: args.record.home_runs,
    walks: args.record.walks,
    strikeouts: args.record.strikeouts,
    totalBases: args.record.total_bases,
    rbis: args.record.rbis,
    battingAverage: args.record.batting_average,
    onBasePercentage: args.record.on_base_percentage,
    sluggingPercentage: args.record.slugging_percentage,
    ops: args.record.ops,
    pitchesSeen: args.record.pitches_seen,
    source: "MLB Stats",
    asOfTimestamp: args.asOfTimestamp,
    researchOnly: true,
  };
}

export function buildPlayerPropEnvironmentEvidence(args: {
  venue?: string | null;
  roofStatus?: PlayerPropEnvironmentEvidence["roofStatus"];
  asOfTimestamp: string;
  park?: Partial<PlayerPropEnvironmentEvidence["park"]>;
  weather?: Partial<PlayerPropEnvironmentEvidence["weather"]>;
}): PlayerPropEnvironmentEvidence {
  return {
    venue: args.venue ?? null,
    roofStatus: args.roofStatus ?? "unknown",
    source: "MLB Stats schedule",
    asOfTimestamp: args.asOfTimestamp,
    park: {
      status: args.park?.status ?? "pending",
      runFactor: args.park?.runFactor ?? null,
      homeRunFactor: args.park?.homeRunFactor ?? null,
      strikeoutFactor: args.park?.strikeoutFactor ?? null,
      source: args.park?.source ?? null,
    },
    weather: {
      status: args.weather?.status ?? (args.roofStatus === "dome" ? "available" : "pending"),
      temperatureF: args.weather?.temperatureF ?? (args.roofStatus === "dome" ? 72 : null),
      conditions: args.weather?.conditions ?? (args.roofStatus === "dome" ? "Controlled indoors" : null),
      windSpeedMph: args.weather?.windSpeedMph ?? (args.roofStatus === "dome" ? 0 : null),
      windDirection: args.weather?.windDirection ?? null,
      precipitationProbability: args.weather?.precipitationProbability ?? (args.roofStatus === "dome" ? 0 : null),
      source: args.weather?.source ?? (args.roofStatus === "dome" ? "Ballpark metadata" : null),
    },
    researchOnly: true,
  };
}

function buildSecondaryLabel(row: MlbHistoricalStatRow, descriptor: MarketLogDescriptor): string | null {
  const details: string[] = [];
  if (descriptor.sampleLabel === "games") {
    const atBats = row.stats.at_bats;
    const hits = row.stats.hits;
    const totalBases = row.stats.total_bases;
    if (typeof atBats === "number") details.push(`${atBats} AB`);
    if (descriptor.statKey !== "hits" && typeof hits === "number") details.push(`${hits} H`);
    if (descriptor.statKey !== "total_bases" && typeof totalBases === "number") details.push(`${totalBases} TB`);
    return details.slice(0, 2).join(" | ") || null;
  }
  const strikeouts = row.stats.strikeouts;
  const outs = row.stats.outs;
  const pitchCount = row.stats.pitch_count;
  if (descriptor.statKey !== "strikeouts" && typeof strikeouts === "number") details.push(`${strikeouts} K`);
  if (descriptor.statKey !== "outs" && typeof outs === "number") details.push(`${outs} outs`);
  if (typeof pitchCount === "number") details.push(`${pitchCount} pitches`);
  return details.slice(0, 2).join(" | ") || null;
}

function opponentProfileSummary(profile: MlbTeamHittingProfile, marketKey: MlbPropMarketKey): string {
  if (marketKey === "pitcher_strikeouts" && profile.strikeout_rate !== null) {
    return `${profile.team_name} strike out in ${percent(profile.strikeout_rate)} of plate appearances, ${ordinalRank(profile.ranks.strikeout_rate)}-highest in MLB.`;
  }
  if (marketKey === "pitcher_walks" && profile.walk_rate !== null) {
    return `${profile.team_name} walk in ${percent(profile.walk_rate)} of plate appearances, ${ordinalRank(profile.ranks.walk_rate)}-highest in MLB.`;
  }
  if (profile.ops !== null) {
    return `${profile.team_name} carry a ${profile.ops.toFixed(3)} OPS, ${ordinalRank(profile.ranks.ops)}-highest in MLB.`;
  }
  return `${profile.team_name}'s season batting profile is available across ${profile.plate_appearances.toLocaleString()} plate appearances.`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ordinalRank(rank: number | null): string {
  if (rank === null) return "unranked";
  const mod100 = rank % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th";
  return `${rank}${suffix}`;
}

function maxNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length ? Math.max(...present) : null;
}

function weightedPitchMetric(
  rows: PlayerPitchMixMatchupEvidence["pitches"],
  read: (row: PlayerPitchMixMatchupEvidence["pitches"][number]) => number | null
): number | null {
  const present = rows.filter((row) => read(row) !== null && row.pitcherUsagePercent > 0);
  const weight = present.reduce((sum, row) => sum + row.pitcherUsagePercent, 0);
  if (weight <= 0) return null;
  return present.reduce((sum, row) => sum + (read(row) ?? 0) * row.pitcherUsagePercent, 0) / weight;
}

function pitchMixSummary(
  hitterName: string,
  pitcherName: string,
  coveragePercent: number,
  weighted: PlayerPitchMixMatchupEvidence["weighted"]
): string {
  const outcomes: string[] = [];
  if (weighted.xwoba !== null) outcomes.push(`${weighted.xwoba.toFixed(3)} xwOBA`);
  if (weighted.whiffPercent !== null) outcomes.push(`${weighted.whiffPercent.toFixed(1)}% whiff`);
  const result = outcomes.length ? `; the matched profile is ${outcomes.join(" with ")}` : "";
  return `${hitterName}'s pitch-type results cover ${coveragePercent.toFixed(0)}% of ${pitcherName}'s season pitch mix${result}.`;
}
