import {
  BallDontLieEplProvider,
  type BdlEplMatch,
  type BdlEplOdds,
  type BdlEplPregameForm,
  type BdlEplPlayerInjury,
  type BdlEplStanding,
  type BdlEplTeam,
  type BdlEplTeamMatchStats,
} from "@/lib/providers/real_api/BallDontLieEplProvider";
import {
  fitEplShadowModel,
  joinEplMatchStats,
  predictEplMatch,
  type EplShadowPrediction,
} from "./eplShadowModel";
import { readEplHistoricalFoundation, writeEplHistoricalFoundation } from "./eplHistoricalFoundationStore";
import { recentComparableEplMatches } from "./eplEvidence";
import { selectEplDefaultRound } from "./eplSlateLifecycle";

const CURRENT_SEASON = 2026;
const TRAINING_SEASONS = [2022, 2023, 2024, 2025] as const;

export type EplShadowSlateMatch = {
  id: number;
  round: number;
  kickoff: string;
  status: BdlEplMatch["status_state"];
  statusDetail: string | null;
  homeTeam: BdlEplTeam;
  awayTeam: BdlEplTeam;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  prediction: EplShadowPrediction;
  currentMoneylineOdds: BdlEplOdds[];
  openingOdds: BdlEplOdds[];
  modelUncertainty: { homeEffectiveMatches: number; awayEffectiveMatches: number };
  evidence: { home: EplTeamEvidence; away: EplTeamEvidence; lineupsPosted: boolean };
};

export type EplTeamEvidence = {
  priorSeasonRank: number | null;
  priorSeasonRecord: string | null;
  priorSeasonGoalDifference: number | null;
  providerPosition: number | null;
  providerRating: number | null;
  recentForm: Array<"W" | "D" | "L">;
  recentPoints: number;
  sampleMatches: number;
  statMatches: number;
  xgMatches: number;
  avgGoalsFor: number | null;
  avgGoalsAgainst: number | null;
  avgXgFor: number | null;
  avgXgAgainst: number | null;
  avgShots: number | null;
  avgShotsOnTarget: number | null;
  avgPossession: number | null;
  avgBigChances: number | null;
  injuryCount: number;
  injuries: Array<{ name: string; status: string | null; injury: string | null; updatedAt: string | null }>;
  startersPosted: number;
};

export type EplShadowSlate = {
  season: number;
  round: number;
  availableRounds: number[];
  matches: EplShadowSlateMatch[];
  generatedAt: string;
  trainedThrough: string;
  trainingMatches: number;
  modelRelease: string;
  calibrationRelease: string;
  recentHistory: Record<string, Array<{ date: string; opponent: string; goalsFor: number; goalsAgainst: number; won: boolean; drawn: boolean }>>;
  providerHealth: {
    fixtures: "ready";
    clubStats: "ready" | "partial";
    recentStatTeamCoverage: number;
    recentXgTeamCoverage: number;
    historicalXgCoverage: number;
    bdlCurrentMoneyline: "ready" | "pending";
    bdlOpeningMoneyline: "ready" | "unavailable";
    sharpMarkets: "read_only_preview";
    playbook: "unsupported";
  };
};

type Foundation = {
  teams: BdlEplTeam[];
  seasonMatches: BdlEplMatch[];
  trainingMatches: ReturnType<typeof joinEplMatchStats>;
  teamStats: BdlEplTeamMatchStats[];
  statsCoverage: number;
};

type HistoricalFoundation = Pick<Foundation, "trainingMatches" | "teamStats">;

// Historical training data is immutable during a running deployment. Keep it out of
// the frequent slate refresh path so a 15-minute odds refresh does not repeatedly
// purchase four seasons of match-stat calls.
let historicalFoundationPromise: Promise<HistoricalFoundation> | null = null;
let currentFoundationCache: { expiresAt: number; promise: Promise<Foundation> } | null = null;
const CURRENT_FOUNDATION_CACHE_TTL_MS = 15 * 60 * 1000;
const SLATE_CACHE_TTL_MS = 5 * 60 * 1000;
const slateCache = new Map<string, { expiresAt: number; promise: Promise<EplShadowSlate> }>();

async function loadHistoricalFoundation(provider: BallDontLieEplProvider): Promise<HistoricalFoundation> {
  const stored = await readEplHistoricalFoundation().catch(() => null);
  if (stored) return { trainingMatches: stored.trainingMatches, teamStats: stored.teamStats };
  const historyBySeason = await Promise.all(TRAINING_SEASONS.map((season) => provider.listMatches({ season })));
  const history = historyBySeason.flat().filter((match) => match.status_state === "final");
  const stats = await provider.listTeamMatchStats(history.map((match) => match.id));
  const foundation = { trainingMatches: joinEplMatchStats(history, stats), teamStats: stats };
  if (process.env.EPL_FOUNDATION_CACHE_WRITES_ENABLED === "true") {
    await writeEplHistoricalFoundation({ schemaVersion: 1, ...foundation }).catch(() => null);
  }
  return foundation;
}

async function loadCurrentFoundation(provider: BallDontLieEplProvider): Promise<Foundation> {
  historicalFoundationPromise ??= loadHistoricalFoundation(provider).catch((error) => {
    historicalFoundationPromise = null;
    throw error;
  });
  const [historical, teams, seasonMatches] = await Promise.all([
    historicalFoundationPromise,
    provider.listTeams(CURRENT_SEASON),
    provider.listMatches({ season: CURRENT_SEASON }),
  ]);
  const completedCurrentMatches = seasonMatches.filter((match) => match.status_state === "final");
  const currentStats = completedCurrentMatches.length > 0
    ? await provider.listTeamMatchStats(completedCurrentMatches.map((match) => match.id))
    : [];
  const withStats = [
    ...historical.trainingMatches,
    ...joinEplMatchStats(completedCurrentMatches, currentStats),
  ];
  const stats = [...historical.teamStats, ...currentStats];
  const matchesWithBothXg = withStats.filter((match) => match.home_xg !== null && match.away_xg !== null).length;
  return {
    teams,
    seasonMatches,
    trainingMatches: withStats,
    teamStats: stats,
    statsCoverage: withStats.length > 0 ? matchesWithBothXg / withStats.length : 0,
  };
}

function loadFoundation(provider: BallDontLieEplProvider): Promise<Foundation> {
  if (currentFoundationCache && currentFoundationCache.expiresAt > Date.now()) return currentFoundationCache.promise;
  const promise = loadCurrentFoundation(provider).catch((error) => {
    if (currentFoundationCache?.promise === promise) currentFoundationCache = null;
    throw error;
  });
  currentFoundationCache = { expiresAt: Date.now() + CURRENT_FOUNDATION_CACHE_TTL_MS, promise };
  return promise;
}

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function teamEvidence(input: {
  teamId: number;
  matches: Foundation["trainingMatches"];
  stats: BdlEplTeamMatchStats[];
  standing: BdlEplStanding | null;
  providerForm: BdlEplPregameForm | null;
  injuries: BdlEplPlayerInjury[];
  startersPosted: number;
}): EplTeamEvidence {
  const recentMatches = recentComparableEplMatches(input.matches, input.teamId);
  const statsByMatchTeam = new Map(input.stats.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  const ownStats = recentMatches.map((match) => statsByMatchTeam.get(`${match.id}:${input.teamId}`));
  const opponentStats = recentMatches.map((match) => {
    const opponentId = match.home_team_id === input.teamId ? match.away_team_id : match.home_team_id;
    return statsByMatchTeam.get(`${match.id}:${opponentId}`);
  });
  const derivedForm = recentMatches.slice(0, 5).map((match): "W" | "D" | "L" => {
    const home = match.home_team_id === input.teamId;
    const goalsFor = home ? match.home_score! : match.away_score!;
    const goalsAgainst = home ? match.away_score! : match.home_score!;
    return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
  });
  const recentForm = input.providerForm?.form?.length ? input.providerForm.form : derivedForm;
  return {
    priorSeasonRank: input.standing?.rank ?? null,
    priorSeasonRecord: input.standing ? `${input.standing.wins}-${input.standing.draws}-${input.standing.losses}` : null,
    priorSeasonGoalDifference: input.standing?.goal_differential ?? null,
    providerPosition: input.providerForm?.position ?? null,
    providerRating: input.providerForm?.avg_rating ?? null,
    recentForm,
    recentPoints: recentForm.reduce((points, result) => points + (result === "W" ? 3 : result === "D" ? 1 : 0), 0),
    sampleMatches: recentMatches.length,
    statMatches: ownStats.filter(Boolean).length,
    xgMatches: ownStats.filter((row) => row?.expected_goals !== null && row?.expected_goals !== undefined).length,
    avgGoalsFor: average(recentMatches.map((match) => match.home_team_id === input.teamId ? match.home_score : match.away_score)),
    avgGoalsAgainst: average(recentMatches.map((match) => match.home_team_id === input.teamId ? match.away_score : match.home_score)),
    avgXgFor: average(ownStats.map((row) => row?.expected_goals)),
    avgXgAgainst: average(opponentStats.map((row) => row?.expected_goals)),
    avgShots: average(ownStats.map((row) => row?.shots)),
    avgShotsOnTarget: average(ownStats.map((row) => row?.shots_on_target)),
    avgPossession: average(ownStats.map((row) => row?.possession_pct)),
    avgBigChances: average(ownStats.map((row) => row?.big_chances)),
    injuryCount: input.injuries.length,
    injuries: input.injuries.slice(0, 12).map((row) => ({ name: row.player.short_name || row.player.display_name, status: row.status, injury: row.injury_type, updatedAt: row.updated_at })),
    startersPosted: input.startersPosted,
  };
}

export function buildEplShadowSlate(requestedRound?: number): Promise<EplShadowSlate> {
  const cacheKey = requestedRound === undefined ? "default" : `round:${requestedRound}`;
  const cached = slateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = buildEplShadowSlateUncached(requestedRound).catch((error) => {
    slateCache.delete(cacheKey);
    throw error;
  });
  slateCache.set(cacheKey, { expiresAt: Date.now() + SLATE_CACHE_TTL_MS, promise });
  return promise;
}

async function buildEplShadowSlateUncached(requestedRound?: number): Promise<EplShadowSlate> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for the EPL production candidate");
  const provider = new BallDontLieEplProvider(apiKey);
  const foundation = await loadFoundation(provider);
  const rounds = [...new Set(foundation.seasonMatches.map((match) => match.round_number).filter((round): round is number => round !== null))].sort((a, b) => a - b);
  const fallbackRound = selectEplDefaultRound(foundation.seasonMatches);
  const round = requestedRound && rounds.includes(requestedRound) ? requestedRound : fallbackRound;
  const roundMatches = foundation.seasonMatches
    .filter((match) => match.round_number === round)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const teamById = new Map(foundation.teams.map((team) => [team.id, team]));
  const roundMatchIds = roundMatches.map((match) => match.id);
  const roundTeamIds = [...new Set(roundMatches.flatMap((match) => [match.home_team_id, match.away_team_id]))];
  const [currentMoneylineOdds, openingOdds, pregameForms, injuries, lineups, priorStandings] = await Promise.all([
    // BALLDONTLIE currently supplies a complete three-way board. Sharp remains
    // primary because it also carries Total, BTTS and Double Chance, but BDL is
    // an independent same-book fallback when Sharp's 1X2 bucket is incomplete.
    provider.listOdds({ matchIds: roundMatchIds }),
    // SharpAPI owns the current board below. Use BALLDONTLIE's distinct
    // opening endpoint here so one paid request has one clear job and the
    // reader never mistakes a first in-process observation for an opener.
    provider.listOdds({ matchIds: roundMatchIds, opening: true }),
    provider.listMatchPregameForms(roundMatchIds).catch(() => []),
    provider.listPlayerInjuries(roundTeamIds).catch(() => []),
    provider.listMatchLineups(roundMatchIds).catch(() => []),
    provider.listStandings(CURRENT_SEASON - 1).catch(() => []),
  ]);
  const openingOddsByMatch = new Map<number, BdlEplOdds[]>();
  for (const row of openingOdds) openingOddsByMatch.set(row.match_id, [...(openingOddsByMatch.get(row.match_id) ?? []), row]);
  const currentMoneylineOddsByMatch = new Map<number, BdlEplOdds[]>();
  for (const row of currentMoneylineOdds) currentMoneylineOddsByMatch.set(row.match_id, [...(currentMoneylineOddsByMatch.get(row.match_id) ?? []), row]);
  const firstKickoff = roundMatches[0]?.date ?? new Date().toISOString();
  const fit = fitEplShadowModel(foundation.trainingMatches, firstKickoff);
  const standingByTeam = new Map(priorStandings.map((row) => [row.team.id, row]));
  const formByMatchTeam = new Map(pregameForms.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  const injuriesByTeam = new Map<number, BdlEplPlayerInjury[]>();
  for (const injury of injuries) injuriesByTeam.set(injury.team.id, [...(injuriesByTeam.get(injury.team.id) ?? []), injury]);
  const startersByMatchTeam = new Map<string, number>();
  for (const row of lineups) if (row.is_starter) startersByMatchTeam.set(`${row.match_id}:${row.team_id}`, (startersByMatchTeam.get(`${row.match_id}:${row.team_id}`) ?? 0) + 1);
  const matches = roundMatches.flatMap<EplShadowSlateMatch>((match) => {
    const homeTeam = teamById.get(match.home_team_id);
    const awayTeam = teamById.get(match.away_team_id);
    if (!homeTeam || !awayTeam) return [];
    return [{
      id: match.id,
      round,
      kickoff: match.date,
      status: match.status_state,
      statusDetail: match.status_detail,
      homeTeam,
      awayTeam,
      homeScore: match.home_score,
      awayScore: match.away_score,
      venue: match.venue_name,
      prediction: predictEplMatch(fit, match.home_team_id, match.away_team_id),
      currentMoneylineOdds: currentMoneylineOddsByMatch.get(match.id) ?? [],
      openingOdds: openingOddsByMatch.get(match.id) ?? [],
      modelUncertainty: {
        homeEffectiveMatches: fit.strengths.get(match.home_team_id)?.effectiveMatches ?? 0,
        awayEffectiveMatches: fit.strengths.get(match.away_team_id)?.effectiveMatches ?? 0,
      },
      evidence: {
        home: teamEvidence({ teamId: match.home_team_id, matches: foundation.trainingMatches, stats: foundation.teamStats, standing: standingByTeam.get(match.home_team_id) ?? null, providerForm: formByMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? null, injuries: injuriesByTeam.get(match.home_team_id) ?? [], startersPosted: startersByMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? 0 }),
        away: teamEvidence({ teamId: match.away_team_id, matches: foundation.trainingMatches, stats: foundation.teamStats, standing: standingByTeam.get(match.away_team_id) ?? null, providerForm: formByMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? null, injuries: injuriesByTeam.get(match.away_team_id) ?? [], startersPosted: startersByMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? 0 }),
        lineupsPosted: (startersByMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? 0) > 0 || (startersByMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? 0) > 0,
      },
    }];
  });
  const abbreviationById = new Map(foundation.teams.map((team) => [team.id, team.abbreviation]));
  const recentHistory: EplShadowSlate["recentHistory"] = {};
  for (const abbreviation of abbreviationById.values()) recentHistory[abbreviation] = [];
  for (const match of [...foundation.trainingMatches].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))) {
    if (match.home_score === null || match.away_score === null) continue;
    const home = abbreviationById.get(match.home_team_id);
    const away = abbreviationById.get(match.away_team_id);
    if (home && recentHistory[home].length < 10) recentHistory[home].push({ date: match.date, opponent: away ?? "OPP", goalsFor: match.home_score, goalsAgainst: match.away_score, won: match.home_score > match.away_score, drawn: match.home_score === match.away_score });
    if (away && recentHistory[away].length < 10) recentHistory[away].push({ date: match.date, opponent: home ?? "OPP", goalsFor: match.away_score, goalsAgainst: match.home_score, won: match.away_score > match.home_score, drawn: match.away_score === match.home_score });
  }
  const slateEvidence = matches.flatMap((match) => [match.evidence.home, match.evidence.away]);
  const recentStatTeamCoverage = slateEvidence.length > 0
    ? slateEvidence.filter((evidence) => evidence.statMatches > 0).length / slateEvidence.length
    : 0;
  const recentXgTeamCoverage = slateEvidence.length > 0
    ? slateEvidence.filter((evidence) => evidence.xgMatches > 0).length / slateEvidence.length
    : 0;
  return {
    season: CURRENT_SEASON,
    round,
    availableRounds: rounds,
    matches,
    generatedAt: new Date().toISOString(),
    trainedThrough: fit.trainedThrough,
    trainingMatches: fit.trainingMatches,
    modelRelease: fit.release,
    calibrationRelease: fit.calibrationRelease,
    recentHistory,
    providerHealth: {
      fixtures: "ready",
      clubStats: recentStatTeamCoverage >= 0.8 ? "ready" : "partial",
      recentStatTeamCoverage,
      recentXgTeamCoverage,
      historicalXgCoverage: foundation.statsCoverage,
      bdlCurrentMoneyline: currentMoneylineOdds.length > 0 ? "ready" : "pending",
      bdlOpeningMoneyline: openingOdds.length > 0 ? "ready" : "unavailable",
      sharpMarkets: "read_only_preview",
      playbook: "unsupported",
    },
  };
}
