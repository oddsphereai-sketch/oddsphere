import type { SupabaseClient } from "@supabase/supabase-js";
import type { IWeatherProvider } from "@/lib/providers/interfaces/IWeatherProvider";
import { PlaybookClient } from "@/lib/providers/playbook/playbookClient";
import type { PlaybookLineGame, PlaybookSplitGame } from "@/lib/providers/playbook/types";
import { fetchBalldontlieNflSlateAvailability } from "./balldontlieNflAvailability";
import { fetchBalldontlieNflRegularSlate, type NflPreviewBookOdds, type NflPreviewGame } from "./balldontlieNflPreviewSlate";
import { fetchBalldontlieNflTeamDepthSnapshots } from "./balldontlieNflRoster";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  determineNflForwardCollectionNeed,
  planNflForwardEvidenceCaptures,
  type NflForwardEvidencePayload,
  type NflForwardOperationalOpening,
  type NflForwardPlaybookLine,
  type NflForwardPlaybookSplitSet,
  type NflForwardStoredEvidence,
  type NflForwardTeamDepthSnapshot,
} from "./nflForwardEvidence";
import {
  appendNflForwardEvidence,
  readLegacyNflForwardEvidence,
  readNflForwardEvidence,
} from "./nflForwardEvidenceStore";
import { collectNflForwardWeather } from "./nflVenueWeather";
import {
  completeSharpApiNflSplitSet,
  fetchSharpApiNflSplits,
  type NflRegularSharpSplitSet,
} from "./sharpApiNflSplits";
import { NFL_T60_MAX_CAPTURE_LAG_MINUTES } from "./nflRegularDecisionEvidence";
import { buildNflR6ShadowMoneylineDecision } from "./nflR6MoneylineShadow";

export const NFL_FORWARD_WRITER_RELEASE =
  "nfl_forward_evidence_writer_2026_08_22_r3_r6_shadow" as const;

export type NflForwardWriterResult = {
  writerRelease: typeof NFL_FORWARD_WRITER_RELEASE;
  collected: boolean;
  collectionReason: string;
  proposed: number;
  inserted: number;
  games: number;
  stages: Record<"opening" | "unlocked" | "t60", number>;
  shadowEvaluations: number;
  shadowLeans: number;
  shadowHeld: number;
  shadowBlockingReasons: string[];
  quarterbackHealthReasons: string[];
  apiCallsMaximum: number;
  healthHolds: string[];
  publicationAttempted: false;
  trackingAttempted: false;
};

export async function runNflForwardEvidenceWriter(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  runId: string;
  now: string;
  apply: boolean;
  balldontlieApiKey: string;
  playbookApiKey: string;
  sharpApiKey: string;
  weatherProvider: IWeatherProvider | null;
}): Promise<NflForwardWriterResult> {
  const [existing, legacyExisting] = await Promise.all([
    readNflForwardEvidence({ client: args.client, season: args.season, week: args.week }),
    readLegacyNflForwardEvidence({ client: args.client, season: args.season, week: args.week }),
  ]);
  const historicalExisting = [...legacyExisting, ...existing];
  const need = determineNflForwardCollectionNeed({ existing, now: args.now });
  if (!need.collect) return emptyResult(need.reason);

  const slate = await fetchBalldontlieNflRegularSlate({
    season: args.season,
    week: args.week,
    apiKey: args.balldontlieApiKey,
  });
  const plans = planNflForwardEvidenceCaptures({
    games: slate.games,
    existing,
    capturedAt: args.now,
    unlockedCadenceMinutes: need.cadenceMinutes ?? 60,
  });
  if (plans.length === 0) return emptyResult("provider_slate_has_no_due_capture");

  const criticalTeamIds = new Set(plans
    .filter((plan) => plan.stage === "opening" || plan.stage === "t60")
    .flatMap((plan) => [plan.game.away.id, plan.game.home.id]));
  const criticalTeams = slate.games.flatMap((game) => [game.away, game.home])
    .filter((team, index, rows) => criticalTeamIds.has(team.id) && rows.findIndex((row) => row.id === team.id) === index);

  const playbook = new PlaybookClient(args.playbookApiKey);
  const [rosters, availability, linesResult, splitsResult, sharpResult] = await Promise.all([
    fetchBalldontlieNflTeamDepthSnapshots({
      teams: criticalTeams,
      season: args.season,
      capturedAt: args.now,
      apiKey: args.balldontlieApiKey,
    }),
    fetchBalldontlieNflSlateAvailability(slate.games.map((game) => ({
      id: game.providerGameId,
      awayTeam: game.away.abbreviation,
      homeTeam: game.home.abbreviation,
      awayTeamId: game.away.id,
      homeTeamId: game.home.id,
    })), { apiKey: args.balldontlieApiKey }),
    playbook.lines("nfl").then((result) => result.body.data ?? []).catch(() => null),
    playbook.splits("nfl").then((result) => result.body.data ?? []).catch(() => null),
    fetchSharpApiNflSplits({ apiKey: args.sharpApiKey, games: slate.games, capturedAt: args.now })
      .catch(() => ({
        splitsByGame: {} as Record<string, NflRegularSharpSplitSet>,
        requests: 1,
        rows: 0,
        dates: [],
      })),
  ]);

  const availabilityByGame = new Map((availability ?? []).map((row) => [row.eventId, row]));
  const linesByGame = matchPlaybookRowsOptional(slate.games, linesResult ?? []);
  const splitsByGame = matchPlaybookRowsOptional(slate.games, splitsResult ?? []);
  const weatherByGame = new Map<string, Awaited<ReturnType<typeof collectNflForwardWeather>>>();
  for (const game of uniquePlannedGames(plans.map((plan) => plan.game))) {
    const stages = plans.filter((plan) => plan.game.providerGameId === game.providerGameId).map((plan) => plan.stage);
    const stage = stages.includes("t60") ? "t60" : stages.includes("opening") ? "opening" : "unlocked";
    weatherByGame.set(game.providerGameId, await collectNflForwardWeather({
      homeTeam: game.home.abbreviation,
      gameStartsAt: game.scheduledStart,
      stage,
      capturedAt: args.now,
      provider: args.weatherProvider,
    }));
  }
  const weatherRequests = [...weatherByGame.values()].reduce((sum, value) => sum + value.requests, 0);
  const apiCallsMaximum = slate.providerRequests + rosters.requests + 4 + 2 + sharpResult.requests + weatherRequests;

  const payloads = plans.map((plan): NflForwardEvidencePayload => {
    const current = requiredCurrentOdds(slate.currentOddsByGame[plan.game.providerGameId], plan.game.providerGameId);
    const currentBooks = requiredCurrentBooks(
      slate.currentOddsAllBooksByGame[plan.game.providerGameId],
      plan.game.providerGameId,
      "all-book",
      true,
    );
    const comparableCurrentBooks = requiredCurrentBooks(
      slate.currentOddsComparableBooksByGame[plan.game.providerGameId],
      plan.game.providerGameId,
      "comparable-book",
      false,
    );
    const providerOpeningBooks = slate.openingOddsAllBooksByGame[plan.game.providerGameId] ?? [];
    const comparableProviderOpeningBooks = slate.openingOddsComparableBooksByGame[plan.game.providerGameId] ?? [];
    const previous = latestEvidenceForGame(historicalExisting, plan.game.providerGameId);
    const opening = operationalOpening({
      previous,
      providerOpening: slate.openingOddsByGame[plan.game.providerGameId] ?? null,
      current,
      capturedAt: args.now,
    });
    const awayDepth = depthForTeam(plan.game.away.abbreviation, rosters.byTeam, previous, "away");
    const homeDepth = depthForTeam(plan.game.home.abbreviation, rosters.byTeam, previous, "home");
    const playbookLine = linesByGame[plan.game.providerGameId]
      ? normalizePlaybookLine(args.now, linesByGame[plan.game.providerGameId]!) : null;
    const playbookSplits = splitsByGame[plan.game.providerGameId]
      ? normalizePlaybookSplits(args.now, splitsByGame[plan.game.providerGameId]!) : null;
    const sharpSplits = sharpResult.splitsByGame[plan.game.providerGameId] ?? null;
    const injuries = availabilityByGame.get(plan.game.providerGameId) ?? null;
    const weather = weatherByGame.get(plan.game.providerGameId)!.snapshot;
    const rosterAndDepth = awayDepth.roster.length > 0 && homeDepth.roster.length > 0;
    const expectedQuarterbacks = awayDepth.expectedStartingQuarterback !== null && homeDepth.expectedStartingQuarterback !== null;
    const playbookCoverage = completePlaybookSplits(playbookSplits);
    const sharpCoverage = completeSharpApiNflSplitSet(sharpSplits ?? undefined);
    const weatherCoverage = plan.stage === "unlocked" || weather.status !== "provider_unavailable";
    const holds = [
      !rosterAndDepth ? "roster_depth_unavailable" : null,
      !expectedQuarterbacks ? "expected_quarterback_unavailable" : null,
      injuries === null ? "injury_report_unavailable" : null,
      !playbookCoverage ? "playbook_splits_unavailable" : null,
      !sharpCoverage ? "sharpapi_splits_unavailable" : null,
      comparableCurrentBooks.length < 2 ? "multibook_consensus_unavailable" : null,
      comparableCurrentBooks.length < 3 ? "r6_leave_one_out_consensus_unavailable" : null,
      !weatherCoverage ? "weather_unavailable" : null,
      plan.stage === "t60" && (plan.t60LagMinutes ?? 0) > NFL_T60_MAX_CAPTURE_LAG_MINUTES
        ? "t60_capture_late"
        : null,
    ].filter((value): value is string => value !== null);
    const shadowMoneyline = buildNflR6ShadowMoneylineDecision({
      game: plan.game,
      opening,
      comparableCurrentBooks,
      startersAndDepth: { away: awayDepth, home: homeDepth },
      injuries,
      stage: plan.stage,
      capturedAt: args.now,
      t60LagMinutes: plan.t60LagMinutes,
      coverageHealthHolds: holds,
    });
    return {
      schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
      collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
      runId: args.runId,
      season: args.season,
      week: args.week,
      slateGameCount: slate.games.length,
      stage: plan.stage,
      captureTiming: plan.captureTiming,
      capturedAt: new Date(args.now).toISOString(),
      cutoffAt: plan.cutoffAt,
      t60LagMinutes: plan.t60LagMinutes,
      game: plan.game,
      market: {
        current,
        currentBooks,
        comparableCurrentBooks,
        providerOpening: slate.openingOddsByGame[plan.game.providerGameId] ?? null,
        providerOpeningBooks,
        comparableProviderOpeningBooks,
        operationalOpening: opening,
        playbookLine,
        playbookSplits,
        sharpApiSplits: sharpSplits,
      },
      startersAndDepth: { away: awayDepth, home: homeDepth },
      injuries,
      weather,
      decisions: {
        evaluatedBets: [], outcomeConfidence: [],
        shadowEvaluatedBets: [shadowMoneyline],
        modelPromotionStatus: "blocked_pending_independent_validation",
        publicationEnabled: false, trackingEnabled: false,
      },
      coverage: {
        currentOdds: true,
        currentBookCount: currentBooks.length,
        comparableCurrentBookCount: comparableCurrentBooks.length,
        multibookConsensusReady: comparableCurrentBooks.length >= 2,
        operationalOpening: true, rosterAndDepth, expectedQuarterbacks,
        injuries: injuries !== null, playbookSplits: playbookCoverage,
        sharpApiSplits: sharpCoverage, weather: weatherCoverage, healthHolds: holds,
      },
      requestBudget: {
        balldontlieSlate: slate.providerRequests, balldontlieRoster: rosters.requests,
        balldontlieInjuriesMaximum: 4, playbook: 2, sharpApi: sharpResult.requests,
        weather: weatherRequests, totalMaximum: apiCallsMaximum,
      },
    };
  });

  const write = await appendNflForwardEvidence({ client: args.client, runId: args.runId, payloads, apply: args.apply });
  const shadowEvaluations = payloads.flatMap((payload) => payload.decisions.shadowEvaluatedBets ?? []);
  return {
    writerRelease: NFL_FORWARD_WRITER_RELEASE,
    collected: true,
    collectionReason: need.reason,
    proposed: write.proposed,
    inserted: write.inserted,
    games: new Set(payloads.map((payload) => payload.game.providerGameId)).size,
    stages: stageCounts(payloads),
    shadowEvaluations: shadowEvaluations.length,
    shadowLeans: shadowEvaluations.filter((decision) => decision.grade === "Lean").length,
    shadowHeld: shadowEvaluations.filter((decision) => decision.grade === "Held").length,
    shadowBlockingReasons: [...new Set(shadowEvaluations.flatMap((decision) => decision.health.blockingReasons))].sort(),
    quarterbackHealthReasons: [...new Set(shadowEvaluations.flatMap((decision) => decision.health.quarterbackReasons))].sort(),
    apiCallsMaximum,
    healthHolds: [...new Set(payloads.flatMap((payload) => payload.coverage.healthHolds))].sort(),
    publicationAttempted: false,
    trackingAttempted: false,
  };
}

function depthForTeam(
  team: string,
  current: Record<string, NflForwardTeamDepthSnapshot>,
  previous: NflForwardStoredEvidence | null,
  side: "away" | "home",
): NflForwardTeamDepthSnapshot {
  const fresh = current[team];
  if (fresh) return fresh;
  const stored = previous?.payload.startersAndDepth[side];
  if (!stored || stored.team !== team) throw new Error(`NFL depth snapshot is unavailable for ${team}.`);
  return { ...stored, sourceSnapshotId: previous.id };
}

function operationalOpening(args: {
  previous: NflForwardStoredEvidence | null;
  providerOpening: NflPreviewBookOdds | null;
  current: NflPreviewBookOdds;
  capturedAt: string;
}): NflForwardOperationalOpening {
  if (args.previous) return args.previous.payload.market.operationalOpening;
  return args.providerOpening
    ? { provenance: "provider_opening", capturedAt: args.providerOpening.observedAt, quote: args.providerOpening }
    : { provenance: "first_observed", capturedAt: new Date(args.capturedAt).toISOString(), quote: args.current };
}

function matchPlaybookRowsOptional<T extends PlaybookLineGame | PlaybookSplitGame>(
  games: NflPreviewGame[],
  rows: T[],
): Record<string, T> {
  const matched: Record<string, T> = {};
  for (const game of games) {
    const candidates = rows.filter((row) =>
      normalizeTeam(row.homeTeamName) === normalizeTeam(game.home.name) &&
      normalizeTeam(row.awayTeamName) === normalizeTeam(game.away.name) &&
      startsNear(row.startTime ?? row.startTimeEst, game.scheduledStart)
    );
    if (candidates.length === 1) matched[game.providerGameId] = candidates[0]!;
  }
  return matched;
}

function normalizePlaybookLine(capturedAt: string, row: PlaybookLineGame): NflForwardPlaybookLine {
  return {
    provider: "playbook",
    capturedAt,
    sourceTier: text(row.lineSourceTier),
    homeMoneyline: finite(row.lines?.moneyline?.home),
    awayMoneyline: finite(row.lines?.moneyline?.away),
    homeSpread: finite(row.lines?.spread?.home),
    awaySpread: finite(row.lines?.spread?.away),
    total: finite(row.lines?.total),
  };
}

function normalizePlaybookSplits(capturedAt: string, row: PlaybookSplitGame): NflForwardPlaybookSplitSet {
  const base = { provider: "playbook" as const, capturedAt };
  return {
    moneyline: {
      ...base,
      booksUsed: finite(row.splits?.moneyline?.source?.booksUsed),
      homeMoneyPct: finite(row.splits?.moneyline?.money?.homePercent),
      awayMoneyPct: finite(row.splits?.moneyline?.money?.awayPercent),
      homeBetsPct: finite(row.splits?.moneyline?.bets?.homePercent),
      awayBetsPct: finite(row.splits?.moneyline?.bets?.awayPercent),
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
    },
    spread: {
      ...base,
      booksUsed: finite(row.splits?.spread?.source?.booksUsed),
      homeMoneyPct: finite(row.splits?.spread?.money?.homePercent),
      awayMoneyPct: finite(row.splits?.spread?.money?.awayPercent),
      homeBetsPct: finite(row.splits?.spread?.bets?.homePercent),
      awayBetsPct: finite(row.splits?.spread?.bets?.awayPercent),
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
    },
    total: {
      ...base,
      booksUsed: finite(row.splits?.total?.source?.booksUsed),
      homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
      overMoneyPct: finite(row.splits?.total?.money?.overPercent),
      underMoneyPct: finite(row.splits?.total?.money?.underPercent),
      overBetsPct: finite(row.splits?.total?.bets?.overPercent),
      underBetsPct: finite(row.splits?.total?.bets?.underPercent),
    },
  };
}

function completePlaybookSplits(value: NflForwardPlaybookSplitSet | null): boolean {
  if (!value) return false;
  return complementary(value.moneyline.homeMoneyPct, value.moneyline.awayMoneyPct) &&
    complementary(value.moneyline.homeBetsPct, value.moneyline.awayBetsPct) &&
    complementary(value.spread.homeMoneyPct, value.spread.awayMoneyPct) &&
    complementary(value.spread.homeBetsPct, value.spread.awayBetsPct) &&
    complementary(value.total.overMoneyPct, value.total.underMoneyPct) &&
    complementary(value.total.overBetsPct, value.total.underBetsPct);
}

function latestEvidenceForGame(rows: NflForwardStoredEvidence[], providerGameId: string): NflForwardStoredEvidence | null {
  return rows.filter((row) => row.providerGameId === providerGameId)
    .sort((first, second) => Date.parse(second.capturedAt) - Date.parse(first.capturedAt))[0] ?? null;
}

function requiredCurrentOdds(value: NflPreviewBookOdds | undefined, gameId: string): NflPreviewBookOdds {
  if (!value?.moneyline || !value.spread || !value.total) throw new Error(`NFL current named-book quote is incomplete for ${gameId}.`);
  return value;
}

function requiredCurrentBooks(
  value: NflPreviewBookOdds[] | undefined,
  gameId: string,
  label: string,
  requireAtLeastOne: boolean,
): NflPreviewBookOdds[] {
  const books = value?.filter((row) => row.moneyline && row.spread && row.total) ?? [];
  if (requireAtLeastOne && books.length === 0) {
    throw new Error(`NFL current ${label} quotes are incomplete for ${gameId}.`);
  }
  const vendors = new Set(books.map((row) => row.sportsbook.toLowerCase()));
  if (vendors.size !== books.length) throw new Error(`NFL current ${label} quotes contain duplicate books for ${gameId}.`);
  return books;
}

function uniquePlannedGames(games: NflPreviewGame[]): NflPreviewGame[] {
  return games.filter((game, index) => games.findIndex((candidate) => candidate.providerGameId === game.providerGameId) === index);
}

function stageCounts(payloads: NflForwardEvidencePayload[]): Record<"opening" | "unlocked" | "t60", number> {
  return {
    opening: payloads.filter((payload) => payload.stage === "opening").length,
    unlocked: payloads.filter((payload) => payload.stage === "unlocked").length,
    t60: payloads.filter((payload) => payload.stage === "t60").length,
  };
}

function emptyResult(reason: string): NflForwardWriterResult {
  return {
    writerRelease: NFL_FORWARD_WRITER_RELEASE,
    collected: false,
    collectionReason: reason,
    proposed: 0,
    inserted: 0,
    games: 0,
    stages: { opening: 0, unlocked: 0, t60: 0 },
    shadowEvaluations: 0,
    shadowLeans: 0,
    shadowHeld: 0,
    shadowBlockingReasons: [],
    quarterbackHealthReasons: [],
    apiCallsMaximum: 0,
    healthHolds: [],
    publicationAttempted: false,
    trackingAttempted: false,
  };
}

function normalizeTeam(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}

function startsNear(first: unknown, second: string): boolean {
  const firstTime = typeof first === "string" ? Date.parse(first) : NaN;
  const secondTime = Date.parse(second);
  return Number.isFinite(firstTime) && Number.isFinite(secondTime) && Math.abs(firstTime - secondTime) <= 12 * 60 * 60_000;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function complementary(first: number | null, second: number | null): boolean {
  return first !== null && second !== null && Math.abs(first + second - 100) <= 1;
}
