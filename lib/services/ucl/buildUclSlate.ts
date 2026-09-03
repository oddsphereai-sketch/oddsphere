import {
  BallDontLieUclProvider,
  UCL_HISTORY_PROVIDER_CONTRACT_DEVIATION,
  type BdlUclMatch,
  type BdlUclOdds,
  type BdlUclPlayerInjury,
  type BdlUclPregameForm,
  type BdlUclStanding,
  type BdlUclTeam,
  type BdlUclTeamMatchStats,
  type UclHistoryFetchTelemetry,
} from "@/lib/providers/real_api/BallDontLieUclProvider";
import type { EplShadowSlate, EplShadowSlateMatch, EplTeamEvidence } from "@/lib/services/epl/buildEplShadowSlate";
import { recentComparableEplMatches } from "@/lib/services/epl/eplEvidence";
import { buildUclCompetitionContexts, regulationScore, type UclCompetitionContext } from "./uclCompetitionContext";
import { fitAndPredictUcl, joinUclMatchStats, UCL_CALIBRATION_RELEASE, UCL_MODEL_RELEASE } from "./uclModel";
import { readUclHistoricalFoundation, writeUclHistoricalFoundation } from "./uclHistoricalFoundationStore";
import { resolveUclFeatureFlags } from "./uclFeatureFlags";
import { assertFrozenUclHistoricalInputs } from "./uclChronologicalManifest";
import { computeSlateDate } from "@/lib/dates/slateDate";

export const UCL_CURRENT_SEASON = 2026;
const UCL_TRAINING_SEASONS = [2024, 2025] as const;
const CURRENT_FOUNDATION_TTL_MS = 15 * 60_000;
const SLATE_TTL_MS = 5 * 60_000;

type Foundation = {
  teams: BdlUclTeam[];
  seasonMatches: BdlUclMatch[];
  historyMatches: BdlUclMatch[];
  trainingMatches: ReturnType<typeof joinUclMatchStats>;
  teamStats: BdlUclTeamMatchStats[];
  statsCoverage: number;
  providerHistory: UclHistoryProviderHealth;
};

export type UclHistoryProviderHealth = {
  status: "ready" | "degraded";
  strategy: UclHistoryFetchTelemetry["strategy"] | "validated_snapshot" | "unavailable";
  rows: number;
  error: string | null;
  contractDeviation: string | null;
};

export type UclSlate = EplShadowSlate & {
  boardDate: string;
  competitionContexts: Record<number, UclCompetitionContext>;
  providerHealth: EplShadowSlate["providerHealth"] & { uclHistory: UclHistoryProviderHealth };
};

let historicalPromise: Promise<Pick<Foundation, "historyMatches" | "trainingMatches" | "teamStats" | "providerHistory">> | null = null;
let foundationCache: { expiresAt: number; promise: Promise<Foundation> } | null = null;
const slateCache = new Map<string, { expiresAt: number; promise: Promise<UclSlate> }>();

async function historical(provider: BallDontLieUclProvider) {
  const stored = await readUclHistoricalFoundation().catch(() => null);
  if (stored?.schemaVersion === 6) {
    return {
      historyMatches: stored.historyMatches,
      trainingMatches: stored.trainingMatches,
      teamStats: stored.teamStats,
      providerHistory: { status: stored.providerHistory.status, strategy: "validated_snapshot" as const, rows: stored.historyMatches.length, error: null, contractDeviation: stored.providerHistory.providerContractDeviation },
    };
  }
  try {
    const fetched = await provider.listHistoricalMatches([...UCL_TRAINING_SEASONS]);
    const historyMatches = fetched.matches.filter((match) => match.status_state === "final");
    const teamStats = await provider.listTeamMatchStats(historyMatches.map((match) => match.id));
    assertFrozenUclHistoricalInputs({ matches: historyMatches, stats: teamStats, telemetry: fetched.telemetry });
    const trainingMatches = joinUclMatchStats(historyMatches, teamStats);
    if (resolveUclFeatureFlags().foundationWrites) {
      await writeUclHistoricalFoundation({ schemaVersion: 6, seasons: [...UCL_TRAINING_SEASONS], historyMatches, teamStats, providerHistory: fetched.telemetry }).catch(() => null);
    }
    return {
      historyMatches,
      trainingMatches,
      teamStats,
      providerHistory: { status: fetched.telemetry.status, strategy: fetched.telemetry.strategy, rows: historyMatches.length, error: null, contractDeviation: fetched.telemetry.providerContractDeviation },
    };
  } catch (error) {
    return {
      historyMatches: [],
      trainingMatches: [],
      teamStats: [],
      providerHistory: { status: "degraded" as const, strategy: "unavailable" as const, rows: 0, error: error instanceof Error ? error.message : String(error), contractDeviation: UCL_HISTORY_PROVIDER_CONTRACT_DEVIATION },
    };
  }
}

async function loadFoundation(provider: BallDontLieUclProvider): Promise<Foundation> {
  if (foundationCache && foundationCache.expiresAt > Date.now()) return foundationCache.promise;
  const promise = (async () => {
    historicalPromise ??= historical(provider).then((result) => {
      // A degraded foundation is deliberately not sticky: the current cycle
      // fails closed, then a later cache window may recover from the provider.
      if (result.providerHistory.status === "degraded") historicalPromise = null;
      return result;
    }).catch((error) => { historicalPromise = null; throw error; });
    const [prior, teams, seasonMatches] = await Promise.all([
      historicalPromise,
      provider.listTeams(UCL_CURRENT_SEASON),
      provider.listCurrentSeasonMatches(UCL_CURRENT_SEASON),
    ]);
    const completed = seasonMatches.filter((match) => match.status_state === "final");
    const currentStats = completed.length ? await provider.listTeamMatchStats(completed.map((match) => match.id)) : [];
    const trainingMatches = [...prior.trainingMatches, ...joinUclMatchStats(completed, currentStats)];
    const teamStats = [...prior.teamStats, ...currentStats];
    const xgMatches = trainingMatches.filter((match) => match.home_xg !== null && match.away_xg !== null).length;
    return {
      teams,
      seasonMatches,
      historyMatches: [...prior.historyMatches, ...completed],
      trainingMatches,
      teamStats,
      statsCoverage: trainingMatches.length ? xgMatches / trainingMatches.length : 0,
      providerHistory: prior.providerHistory,
    };
  })().catch((error) => { if (foundationCache?.promise === promise) foundationCache = null; throw error; });
  foundationCache = { expiresAt: Date.now() + CURRENT_FOUNDATION_TTL_MS, promise };
  return promise;
}

export function groupUclMatchweeks(matches: BdlUclMatch[]): BdlUclMatch[][] {
  const ordered = [...matches].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const groups: BdlUclMatch[][] = [];
  for (const match of ordered) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || Date.parse(match.date) - Date.parse(previous.date) > 3 * 86_400_000) groups.push([match]);
    else current.push(match);
  }
  return groups;
}

export function selectUclMatchweek(groups: BdlUclMatch[][], now = new Date()): number {
  const currentEtSlateDay = computeSlateDate("soccer", now);
  const currentOrUpcoming = groups.findIndex((group) => {
    // A round can span multiple calendar days. If any fixture belongs to the
    // current ET day, retain the complete round—including earlier completed
    // fixtures—through ET midnight. Between match days, upcoming fixtures in
    // that same round keep it selected.
    if (group.some((match) => computeSlateDate("soccer", match.date) === currentEtSlateDay)) return true;
    return group.some((match) => Date.parse(match.date) >= now.getTime());
  });
  return currentOrUpcoming >= 0 ? currentOrUpcoming + 1 : Math.max(1, groups.length);
}

export function visibleUclMatchweekFixtures(group: BdlUclMatch[], now = new Date()): BdlUclMatch[] {
  const currentEtSlateDay = computeSlateDate("soccer", now);
  return group.filter((match) => (
    match.status_state !== "final"
    || computeSlateDate("soccer", match.date) >= currentEtSlateDay
  ));
}

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function evidence(input: {
  teamId: number;
  matches: Foundation["trainingMatches"];
  stats: BdlUclTeamMatchStats[];
  standing: BdlUclStanding | null;
  providerForm: BdlUclPregameForm | null;
  injuries: BdlUclPlayerInjury[];
  startersPosted: number;
}): EplTeamEvidence {
  const recent = recentComparableEplMatches(input.matches, input.teamId);
  const statsByMatchTeam = new Map(input.stats.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  const own = recent.map((match) => statsByMatchTeam.get(`${match.id}:${input.teamId}`));
  const opponent = recent.map((match) => statsByMatchTeam.get(`${match.id}:${match.home_team_id === input.teamId ? match.away_team_id : match.home_team_id}`));
  const derived = recent.slice(0, 5).map((match): "W" | "D" | "L" => {
    const home = match.home_team_id === input.teamId;
    const ownGoals = home ? match.home_score! : match.away_score!;
    const conceded = home ? match.away_score! : match.home_score!;
    return ownGoals > conceded ? "W" : ownGoals < conceded ? "L" : "D";
  });
  const form = input.providerForm?.form?.length ? input.providerForm.form : derived;
  return {
    priorSeasonRank: input.standing?.rank ?? null,
    priorSeasonRecord: input.standing ? `${input.standing.wins}-${input.standing.draws}-${input.standing.losses}` : null,
    priorSeasonGoalDifference: input.standing?.goal_differential ?? null,
    providerPosition: input.providerForm?.position ?? null,
    providerRating: input.providerForm?.avg_rating ?? null,
    recentForm: form,
    recentPoints: form.reduce((points, result) => points + (result === "W" ? 3 : result === "D" ? 1 : 0), 0),
    sampleMatches: recent.length,
    statMatches: own.filter(Boolean).length,
    xgMatches: own.filter((row) => row?.expected_goals !== null && row?.expected_goals !== undefined).length,
    avgGoalsFor: average(recent.map((match) => match.home_team_id === input.teamId ? match.home_score : match.away_score)),
    avgGoalsAgainst: average(recent.map((match) => match.home_team_id === input.teamId ? match.away_score : match.home_score)),
    avgXgFor: average(own.map((row) => row?.expected_goals)),
    avgXgAgainst: average(opponent.map((row) => row?.expected_goals)),
    avgShots: average(own.map((row) => row?.shots)),
    avgShotsOnTarget: average(own.map((row) => row?.shots_on_target)),
    avgPossession: average(own.map((row) => row?.possession_pct)),
    avgBigChances: average(own.map((row) => row?.big_chances)),
    injuryCount: input.injuries.length,
    injuries: input.injuries.slice(0, 12).map((row) => ({ name: row.player.short_name || row.player.display_name, status: row.status, injury: row.injury_type, updatedAt: row.updated_at })),
    startersPosted: input.startersPosted,
  };
}

export function buildUclSlate(requestedMatchweek?: number): Promise<UclSlate> {
  const selectionNow = new Date();
  const cacheKey = requestedMatchweek
    ? `week:${requestedMatchweek}`
    : `default:${computeSlateDate("soccer", selectionNow)}`;
  const cached = slateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = buildUclSlateUncached(requestedMatchweek, selectionNow).catch((error) => { slateCache.delete(cacheKey); throw error; });
  slateCache.set(cacheKey, { expiresAt: Date.now() + SLATE_TTL_MS, promise });
  return promise;
}

async function buildUclSlateUncached(requestedMatchweek?: number, selectionNow = new Date()): Promise<UclSlate> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for UCL production");
  const provider = new BallDontLieUclProvider(apiKey);
  const foundation = await loadFoundation(provider);
  const groups = groupUclMatchweeks(foundation.seasonMatches);
  const selected = requestedMatchweek && groups[requestedMatchweek - 1]
    ? requestedMatchweek
    : selectUclMatchweek(groups, selectionNow);
  const selectedRound = groups[selected - 1] ?? [];
  // Explicit round navigation is historical/manual and remains complete.
  // The default member board removes only completed prior-ET-day fixtures;
  // today's finals and every scheduled/in-progress fixture remain visible.
  const weekMatches = requestedMatchweek
    ? selectedRound
    : visibleUclMatchweekFixtures(selectedRound, selectionNow);
  const contextById = buildUclCompetitionContexts(foundation.seasonMatches);
  const teamById = new Map(foundation.teams.map((team) => [team.id, team]));
  const matchIds = weekMatches.map((match) => match.id);
  const teamIds = [...new Set(weekMatches.flatMap((match) => [match.home_team_id, match.away_team_id]))];
  const [currentOdds, openingOdds, forms, injuries, lineups, standings] = await Promise.all([
    provider.listOdds({ matchIds }),
    provider.listOdds({ matchIds, opening: true }),
    provider.listMatchPregameForms(matchIds).catch(() => []),
    provider.listPlayerInjuries(teamIds).catch(() => []),
    provider.listMatchLineups(matchIds).catch(() => []),
    provider.listStandings(UCL_CURRENT_SEASON).catch(() => []),
  ]);
  const rowsByMatch = (rows: BdlUclOdds[]) => {
    const map = new Map<number, BdlUclOdds[]>();
    for (const row of rows) map.set(row.match_id, [...(map.get(row.match_id) ?? []), row]);
    return map;
  };
  const currentByMatch = rowsByMatch(currentOdds);
  const openingByMatch = rowsByMatch(openingOdds);
  const standingsByTeam = new Map(standings.map((row) => [row.team.id, row]));
  const formsByMatchTeam = new Map(forms.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  const injuriesByTeam = new Map<number, BdlUclPlayerInjury[]>();
  for (const row of injuries) injuriesByTeam.set(row.team.id, [...(injuriesByTeam.get(row.team.id) ?? []), row]);
  const startersByMatchTeam = new Map<string, number>();
  for (const row of lineups) if (row.is_starter) startersByMatchTeam.set(`${row.match_id}:${row.team_id}`, (startersByMatchTeam.get(`${row.match_id}:${row.team_id}`) ?? 0) + 1);
  const matches = weekMatches.flatMap<EplShadowSlateMatch>((match) => {
    const homeTeam = teamById.get(match.home_team_id);
    const awayTeam = teamById.get(match.away_team_id);
    const context = contextById.get(match.id);
    if (!homeTeam || !awayTeam || !context) return [];
    const score = regulationScore(match).score;
    return [{
      id: match.id,
      round: selected,
      kickoff: match.date,
      status: match.status_state,
      statusDetail: match.status_detail,
      homeTeam,
      awayTeam,
      homeScore: score?.home ?? null,
      awayScore: score?.away ?? null,
      venue: match.venue_name,
      prediction: fitAndPredictUcl({ training: foundation.trainingMatches, match, history: foundation.historyMatches, context }),
      currentMoneylineOdds: currentByMatch.get(match.id) ?? [],
      openingOdds: openingByMatch.get(match.id) ?? [],
      modelUncertainty: { homeEffectiveMatches: 0, awayEffectiveMatches: 0 },
      evidence: {
        home: evidence({ teamId: match.home_team_id, matches: foundation.trainingMatches, stats: foundation.teamStats, standing: standingsByTeam.get(match.home_team_id) ?? null, providerForm: formsByMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? null, injuries: injuriesByTeam.get(match.home_team_id) ?? [], startersPosted: startersByMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? 0 }),
        away: evidence({ teamId: match.away_team_id, matches: foundation.trainingMatches, stats: foundation.teamStats, standing: standingsByTeam.get(match.away_team_id) ?? null, providerForm: formsByMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? null, injuries: injuriesByTeam.get(match.away_team_id) ?? [], startersPosted: startersByMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? 0 }),
        lineupsPosted: (startersByMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? 0) > 0 || (startersByMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? 0) > 0,
      },
    }];
  });
  const abbreviationById = new Map(foundation.teams.map((team) => [team.id, team.abbreviation]));
  const recentHistory: UclSlate["recentHistory"] = {};
  for (const abbreviation of abbreviationById.values()) recentHistory[abbreviation] = [];
  for (const match of [...foundation.trainingMatches].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))) {
    if (match.home_score === null || match.away_score === null) continue;
    const home = abbreviationById.get(match.home_team_id);
    const away = abbreviationById.get(match.away_team_id);
    if (home && recentHistory[home]!.length < 10) recentHistory[home]!.push({ date: match.date, opponent: away ?? "OPP", goalsFor: match.home_score, goalsAgainst: match.away_score, won: match.home_score > match.away_score, drawn: match.home_score === match.away_score });
    if (away && recentHistory[away]!.length < 10) recentHistory[away]!.push({ date: match.date, opponent: home ?? "OPP", goalsFor: match.away_score, goalsAgainst: match.home_score, won: match.away_score > match.home_score, drawn: match.home_score === match.away_score });
  }
  const sample = matches.flatMap((match) => [match.evidence.home, match.evidence.away]);
  const recentStatTeamCoverage = sample.length ? sample.filter((row) => row.statMatches > 0).length / sample.length : 0;
  const recentXgTeamCoverage = sample.length ? sample.filter((row) => row.xgMatches > 0).length / sample.length : 0;
  return {
    boardDate: computeSlateDate("soccer", selectionNow),
    season: UCL_CURRENT_SEASON,
    round: selected,
    availableRounds: groups.map((_, index) => index + 1),
    matches,
    generatedAt: new Date().toISOString(),
    trainedThrough: foundation.trainingMatches.reduce((latest, match) => match.date > latest ? match.date : latest, ""),
    trainingMatches: foundation.trainingMatches.length,
    modelRelease: UCL_MODEL_RELEASE,
    calibrationRelease: UCL_CALIBRATION_RELEASE,
    recentHistory,
    competitionContexts: Object.fromEntries(matches.map((match) => [match.id, contextById.get(match.id)!])),
    providerHealth: {
      fixtures: "ready",
      clubStats: recentStatTeamCoverage >= 0.8 ? "ready" : "partial",
      recentStatTeamCoverage,
      recentXgTeamCoverage,
      historicalXgCoverage: foundation.statsCoverage,
      bdlCurrentMoneyline: currentOdds.length ? "ready" : "pending",
      bdlOpeningMoneyline: openingOdds.length ? "ready" : "unavailable",
      sharpMarkets: "read_only_preview",
      playbook: "unsupported",
      uclHistory: foundation.providerHistory,
    },
  };
}
