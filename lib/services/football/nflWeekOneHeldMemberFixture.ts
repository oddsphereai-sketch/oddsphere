import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DailyEdgeGameDto,
  DailyEdgePredictionDto,
  MarketEdgeDto,
  OddsTrailStopDto,
} from "@/app/lab/lib/labTypes";
import { buildRecommendationDecision } from "@/lib/services/recommendationDecision";
import { withFirstTrackedSplitObservation } from "@/lib/services/splitDisplayMovement";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";
import type { FootballPreviewFixture } from "@/app/dev/football-preview/footballPreviewFixture";
import type { PreviewAvailabilityByGame } from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardPlaybookSplit,
  type NflForwardStoredEvidence,
} from "./nflForwardEvidence";
import {
  readLegacyNflForwardEvidence,
  readNflForwardEvidence,
  readPriorNflForwardEvidence,
  readPreviousNflForwardEvidence,
} from "./nflForwardEvidenceStore";
import { NFL_T60_MAX_CAPTURE_LAG_MINUTES } from "./nflRegularDecisionEvidence";
import type { NflRegularEvaluatedBetDecision } from "./nflRegularDecisionEvidence";
import {
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
  NFL_V1_OUTCOME_DISTRIBUTION_RELEASE,
  NFL_V1_OUTCOME_MODEL_RELEASE,
  NFL_V1_OUTCOME_PROBABILITY_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
} from "./nflV1WeekOneOutcome";
import {
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
} from "./nflV1ActionableGradeCandidate";
import { nflFootballEvidenceStats } from "./footballMemberEvidence";
import type { NflRegularSharpMarket, NflRegularSharpSplit } from "./sharpApiNflSplits";

export const NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE =
  "nfl_weekly_member_fixture_2026_09_04_r17_split_history_window" as const;

const MODEL_RELEASE = NFL_V1_OUTCOME_MODEL_RELEASE;
const DECISION_RELEASE = NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE;
const HOLD_REASON = "The prediction remains live. The Bet grade is No Play while the exact-price writer repairs incomplete sportsbook or data-health evidence.";

export type NflWeekOneHeldMemberFixture = FootballPreviewFixture & {
  heldMemberFixtureRelease: typeof NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE;
  capturedAt: string;
  coverage: {
    games: number;
    currentOddsGames: number;
    openingGames: number;
    playbookSplitGames: number;
    injuryGames: number;
    projectedQuarterbacks: number;
    confirmedQuarterbacks: number;
  };
};

export async function readCurrentNflWeekOneHeldMemberFixture(args: {
  client: SupabaseClient;
  season?: number;
  week?: number;
}): Promise<NflWeekOneHeldMemberFixture> {
  const season = args.season ?? 2026;
  const week = args.week ?? 1;
  const releases = await Promise.all([
    readLegacyNflForwardEvidence({ client: args.client, season, week }),
    readPriorNflForwardEvidence({ client: args.client, season, week }),
    readPreviousNflForwardEvidence({ client: args.client, season, week }),
    readNflForwardEvidence({ client: args.client, season, week }),
  ]);
  return buildNflWeekOneHeldMemberFixture(releases.flat());
}

export function buildNflWeekOneHeldMemberFixture(
  rows: NflForwardStoredEvidence[],
): NflWeekOneHeldMemberFixture {
  const latest = latestCompleteRows(rows);
  const firstPayload = latest[0]!.payload;
  const capturedAt = latest.reduce(
    (value, row) => Date.parse(row.capturedAt) > Date.parse(value) ? row.capturedAt : value,
    latest[0]!.capturedAt,
  );
  const availability: PreviewAvailabilityByGame = Object.fromEntries(
    latest.flatMap((row) => row.payload.injuries
      ? [[`nfl-${row.providerGameId}`, row.payload.injuries] as const]
      : []),
  );
  const movementRowsByGame = new Map(latest.map((row) => [
    row.providerGameId,
    movementRowsForGame(rows, row),
  ]));
  const games = latest
    .map((row) => buildHeldGame(row, movementRowsByGame.get(row.providerGameId)!))
    .sort((first, second) => Date.parse(first.gameStartAt ?? "") - Date.parse(second.gameStartAt ?? ""));
  const sourceChecksum = createHash("sha256")
    .update([...movementRowsByGame.values()].flat()
      .map((row) => `${row.providerGameId}:${row.capturedAt}:${row.payloadSha256}`)
      .sort()
      .join("|"))
    .digest("hex");
  const confirmedQuarterbacks = latest.reduce((count, row) => count +
    Number(row.payload.startersAndDepth.away.starterStatus === "confirmed") +
    Number(row.payload.startersAndDepth.home.starterStatus === "confirmed"), 0);
  const projectedQuarterbacks = latest.reduce((count, row) => count +
    Number(row.payload.startersAndDepth.away.starterStatus === "projected") +
    Number(row.payload.startersAndDepth.home.starterStatus === "projected"), 0);
  const trackingEligibleGames = latest.filter((row) => row.payload.decisions.trackingEnabled).length;
  const label = `Regular Season Week ${firstPayload.week}`;
  const slateDate = localDate(games[0]!.gameStartAt!);

  return {
    heldMemberFixtureRelease: NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE,
    capturedAt,
    sport: "nfl",
    snapshot: {
      as_of: capturedAt,
      sport: "nfl",
      date: slateDate,
      requested_date: slateDate,
      fallback_used: false,
      slateState: "today_draft_only",
      slate_status: "week_one_model_live",
      last_slate_update_at: capturedAt,
      games,
    },
    history: {},
    availability,
    week: {
      week: firstPayload.week,
      providerWeek: firstPayload.week,
      label,
      startDate: slateDate,
    },
    previousWeek: null,
    nextWeek: firstPayload.week < 18 ? firstPayload.week + 1 : null,
    provenance: {
      schedule: "BALLDONTLIE NFL games from the leased forward-evidence collector",
      odds: "BALLDONTLIE named-sportsbook two-sided current and operational Opening quotes",
      results: "Preseason is excluded; official regular-season results append automatically from each valid immutable T-60 tuple",
      modelRelease: MODEL_RELEASE,
      decisionRelease: DECISION_RELEASE,
      sourceChecksum,
      providerRequests: 0,
      openingCoverageGames: latest.length,
      firstObservedCoverageGames: latest.length,
      minimumStoredPriceObservations: Math.min(...games.flatMap((game) => [
        game.markets.moneyline.oddsTrail?.length ?? 0,
        game.markets.total.oddsTrail?.length ?? 0,
        game.markets.first_inning.oddsTrail?.length ?? 0,
      ])),
      splitCoverageGames: latest.filter((row) => row.payload.market.playbookSplits !== null).length,
    },
    tracking: {
      seasonPhase: "regular",
      trackingEligible: trackingEligibleGames > 0,
      reason: trackingEligibleGames > 0
        ? `${trackingEligibleGames} game${trackingEligibleGames === 1 ? " has" : "s have"} reached the valid T-60 tracking boundary; unlocked games remain excluded until their own lock.`
        : "Official NFL tracking begins separately for each game only after its valid immutable T-60 tuple; unlocked Week 1 decisions are not yet counted.",
    },
    coverage: {
      games: latest.length,
      currentOddsGames: latest.length,
      openingGames: latest.length,
      playbookSplitGames: latest.filter((row) => row.payload.market.playbookSplits !== null).length,
      injuryGames: latest.filter((row) => row.payload.injuries !== null).length,
      projectedQuarterbacks,
      confirmedQuarterbacks,
    },
  };
}

function latestCompleteRows(rows: NflForwardStoredEvidence[]): Array<NflForwardStoredEvidence & { payload: NflForwardEvidencePayload }> {
  if (rows.length === 0) throw new Error("NFL Week 1 forward evidence is empty.");
  const latest = new Map<string, NflForwardStoredEvidence & { payload: NflForwardEvidencePayload }>();
  for (const row of rows) {
    if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) continue;
    const current = latest.get(row.providerGameId);
    if (!current || Date.parse(row.capturedAt) > Date.parse(current.capturedAt)) {
      latest.set(row.providerGameId, row as NflForwardStoredEvidence & { payload: NflForwardEvidencePayload });
    }
  }
  const values = [...latest.values()];
  if (values.length === 0) throw new Error("NFL Week 1 has no current-schema forward evidence.");
  const expected = Math.max(...values.map((row) => row.payload.slateGameCount));
  if (values.length !== expected) {
    throw new Error(`NFL Week 1 held fixture coverage is ${values.length}/${expected} games.`);
  }
  const identity = `${values[0]!.payload.season}:${values[0]!.payload.week}`;
  if (values.some((row) => `${row.payload.season}:${row.payload.week}` !== identity)) {
    throw new Error("NFL Week 1 held fixture contains mixed season/week identities.");
  }
  if (values.some((row) => !row.payload.decisions.publicationEnabled)) {
    throw new Error("NFL Week 1 member fixture requires publication-enabled evidence.");
  }
  if (values.some((row) =>
    row.payload.decisions.modelPromotionStatus !== NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE ||
    row.payload.decisions.evaluatedBets.some((decision) =>
      decision.decisionRelease !== NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE))) {
    throw new Error("NFL Week 1 member fixture refuses a stale or mixed model/decision release.");
  }
  for (const row of values) {
    const { current, operationalOpening } = row.payload.market;
    if (!current.moneyline || !current.spread || !current.total) {
      throw new Error(`NFL Week 1 current quote is incomplete for ${row.providerGameId}.`);
    }
    if (!operationalOpening.quote.moneyline || !operationalOpening.quote.spread || !operationalOpening.quote.total) {
      throw new Error(`NFL Week 1 Opening quote is incomplete for ${row.providerGameId}.`);
    }
  }
  return values;
}

function movementRowsForGame(
  rows: NflForwardStoredEvidence[],
  latest: NflForwardStoredEvidence & { payload: NflForwardEvidencePayload },
): NflForwardStoredEvidence[] {
  return rows
    .filter((row) =>
      row.providerGameId === latest.providerGameId &&
      Date.parse(row.capturedAt) <= Date.parse(latest.capturedAt))
    .sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt));
}

function buildHeldGame(
  row: NflForwardStoredEvidence & { payload: NflForwardEvidencePayload },
  movementRows: NflForwardStoredEvidence[],
): DailyEdgeGameDto {
  const payload = row.payload;
  const game = payload.game;
  const current = payload.market.current;
  const opening = payload.market.operationalOpening;
  const away = game.away.abbreviation;
  const home = game.home.abbreviation;
  const outcome = payload.outcomeForecast;
  const moneylineBase = buildHeldMarket({
    slot: "moneyline",
    away,
    home,
    current: {
      sportsbook: current.sportsbook,
      observedAt: current.observedAt,
      primaryPrice: current.moneyline!.homePrice,
      opposingPrice: current.moneyline!.awayPrice,
      primaryLine: null,
      opposingLine: null,
    },
    opening: {
      sportsbook: opening.quote.sportsbook,
      observedAt: opening.capturedAt,
      primaryPrice: opening.quote.moneyline!.homePrice,
      opposingPrice: opening.quote.moneyline!.awayPrice,
      primaryLine: null,
      opposingLine: null,
      provenance: opening.provenance,
    },
    split: payload.market.playbookSplits?.moneyline ?? null,
    primaryLabel: home,
    opposingLabel: away,
    primarySide: "home",
    opposingSide: "away",
    payload,
    movementRows,
  });
  const totalBase = buildHeldMarket({
    slot: "total",
    away,
    home,
    current: {
      sportsbook: current.sportsbook,
      observedAt: current.observedAt,
      primaryPrice: current.total!.overPrice,
      opposingPrice: current.total!.underPrice,
      primaryLine: current.total!.line,
      opposingLine: current.total!.line,
    },
    opening: {
      sportsbook: opening.quote.sportsbook,
      observedAt: opening.capturedAt,
      primaryPrice: opening.quote.total!.overPrice,
      opposingPrice: opening.quote.total!.underPrice,
      primaryLine: opening.quote.total!.line,
      opposingLine: opening.quote.total!.line,
      provenance: opening.provenance,
    },
    split: payload.market.playbookSplits?.total ?? null,
    primaryLabel: `Over ${marketNumber(current.total!.line)}`,
    opposingLabel: `Under ${marketNumber(current.total!.line)}`,
    primarySide: "over",
    opposingSide: "under",
    payload,
    movementRows,
  });
  const spreadBase = buildHeldMarket({
    slot: "spread",
    away,
    home,
    current: {
      sportsbook: current.sportsbook,
      observedAt: current.observedAt,
      primaryPrice: current.spread!.homePrice,
      opposingPrice: current.spread!.awayPrice,
      primaryLine: current.spread!.homeLine,
      opposingLine: current.spread!.awayLine,
    },
    opening: {
      sportsbook: opening.quote.sportsbook,
      observedAt: opening.capturedAt,
      primaryPrice: opening.quote.spread!.homePrice,
      opposingPrice: opening.quote.spread!.awayPrice,
      primaryLine: opening.quote.spread!.homeLine,
      opposingLine: opening.quote.spread!.awayLine,
      provenance: opening.provenance,
    },
    split: payload.market.playbookSplits?.spread ?? null,
    primaryLabel: `${home} ${signed(current.spread!.homeLine)}`,
    opposingLabel: `${away} ${signed(current.spread!.awayLine)}`,
    primarySide: "home",
    opposingSide: "away",
    payload,
    movementRows,
  });
  const decisions = payload.decisions.evaluatedBets;
  const moneylineDecision = decisionFor(decisions, "moneyline");
  const totalDecision = decisionFor(decisions, "total");
  const spreadDecision = decisionFor(decisions, "spread");
  const moneyline = withPrimaryPrediction(applyPublishedDecision(moneylineBase, moneylineDecision, {
    slot: "moneyline", payload, movementRows, primaryLabel: home, opposingLabel: away, primarySide: "home", opposingSide: "away",
  }), { slot: "moneyline", away, home, outcome, decision: moneylineDecision, current });
  const total = withPrimaryPrediction(applyPublishedDecision(totalBase, totalDecision, {
    slot: "total", payload, movementRows, primaryLabel: `Over ${marketNumber(current.total!.line)}`,
    opposingLabel: `Under ${marketNumber(current.total!.line)}`, primarySide: "over", opposingSide: "under",
    expectedTotal: outcome.expectedAwayScore + outcome.expectedHomeScore,
  }), { slot: "total", away, home, outcome, decision: totalDecision, current });
  const spread = withPrimaryPrediction(applyPublishedDecision(spreadBase, spreadDecision, {
    slot: "spread", payload, movementRows, primaryLabel: `${home} ${signed(current.spread!.homeLine)}`,
    opposingLabel: `${away} ${signed(current.spread!.awayLine)}`, primarySide: "home", opposingSide: "away",
  }), { slot: "spread", away, home, outcome, decision: spreadDecision, current });
  moneyline.keyStats = nflFootballEvidenceStats({
    awayTeam: away,
    homeTeam: home,
    market: "moneyline",
    awayQuarterback: quarterbackContext(payload, "away"),
    homeQuarterback: quarterbackContext(payload, "home"),
    weather: payload.weather,
  });
  total.keyStats = nflFootballEvidenceStats({
    awayTeam: away,
    homeTeam: home,
    market: "total",
    awayQuarterback: quarterbackContext(payload, "away"),
    homeQuarterback: quarterbackContext(payload, "home"),
    weather: payload.weather,
  });
  spread.keyStats = nflFootballEvidenceStats({
    awayTeam: away,
    homeTeam: home,
    market: "spread",
    awayQuarterback: quarterbackContext(payload, "away"),
    homeQuarterback: quarterbackContext(payload, "home"),
    weather: payload.weather,
  });
  const sourceSplits = {
    moneyline: nflSourceSplitEvidence(payload, "moneyline", movementRows),
    total: nflSourceSplitEvidence(payload, "total", movementRows),
    spread: nflSourceSplitEvidence(payload, "spread", movementRows),
  };
  const recommendationDecision = buildNflRecommendationDecision({
    payload,
    projected: { away: outcome.representativeAwayScore, home: outcome.representativeHomeScore },
    moneyline: { market: moneyline, decision: moneylineDecision, split: sourceSplits.moneyline },
    total: { market: total, decision: totalDecision, split: sourceSplits.total },
    spread: { market: spread, decision: spreadDecision, split: sourceSplits.spread },
  });
  moneyline.recommendationDecision = recommendationDecision.markets.moneyline;
  total.recommendationDecision = recommendationDecision.markets.total;
  spread.recommendationDecision = recommendationDecision.markets.firstInning;
  moneyline.sportsbookSplits = sourceSplits.moneyline.sportsbook;
  total.sportsbookSplits = sourceSplits.total.sportsbook;
  spread.sportsbookSplits = sourceSplits.spread.sportsbook;
  moneyline.sharpBookAvailability = sourceSplits.moneyline.availability;
  total.sharpBookAvailability = sourceSplits.total.availability;
  spread.sharpBookAvailability = sourceSplits.spread.availability;
  const locked = payload.stage === "t60" &&
    payload.t60LagMinutes !== null &&
    payload.t60LagMinutes <= NFL_T60_MAX_CAPTURE_LAG_MINUTES &&
    decisions.length === 3 && decisions.every((decision) => decision.stage === "t60_locked");
  const markets = { moneyline, total, first_inning: spread };
  const prediction = (market: MarketEdgeDto): DailyEdgePredictionDto => ({
    pick: market.pick,
    confidence: market.confidence,
    sharpStatus: market.sharpStatus,
    grade: market.grade,
    signalType: market.signalType,
    marketSignal: market.marketSignal,
  });
  const externalId = Number(game.providerGameId);
  if (!Number.isFinite(externalId)) throw new Error(`NFL provider game id ${game.providerGameId} is not numeric.`);
  return {
    id: `nfl-${game.providerGameId}`,
    sport: "nfl",
    external_id: externalId,
    awayTeam: away,
    awayTeamLogo: nflLogo(away),
    homeTeam: home,
    homeTeamLogo: nflLogo(home),
    gameTime: formatKickoff(game.scheduledStart),
    gameStartAt: game.scheduledStart,
    gameStartMinutes: kickoffMinutes(game.scheduledStart),
    scheduledLockAt: new Date(Date.parse(game.scheduledStart) - 60 * 60_000).toISOString(),
    lockState: locked ? "locked" : "open",
    lockedAt: locked ? payload.capturedAt : null,
    updatedAt: payload.capturedAt,
    generatedAt: payload.capturedAt,
    holdReason: decisions.length === 3 ? null : "nfl_week_one_exact_price_tuple_health_hold",
    dataCompleteness: null,
    homeStarter: null,
    awayStarter: null,
    predictions: {
      ml: prediction(moneyline),
      total: { ...prediction(total), line: total.line },
      nrfi: prediction(spread),
    },
    markets,
    decisionLine: "The discrete football forecast supplies the score and winner probability. The active Spread and Total decision heads apply separate line-specific calibration before each exact-price Bet grade.",
    projected: {
      away: outcome.representativeAwayScore,
      home: outcome.representativeHomeScore,
    },
    footballProjection: {
      awayWinProbability: outcome.awayWinProbability,
      homeWinProbability: outcome.homeWinProbability,
      expectedAwayPoints: outcome.expectedAwayScore,
      expectedHomePoints: outcome.expectedHomeScore,
      modelRelease: NFL_V1_OUTCOME_MODEL_RELEASE,
      distributionRelease: NFL_V1_OUTCOME_DISTRIBUTION_RELEASE,
      probabilityRelease: NFL_V1_OUTCOME_PROBABILITY_RELEASE,
      artifactRelease: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
    },
    sharpSignals: [],
    status: {
      lineupConfirmed: payload.startersAndDepth.away.starterStatus === "confirmed" && payload.startersAndDepth.home.starterStatus === "confirmed",
      linesLocked: locked,
      sharpSignalPending: !Object.values(sourceSplits).some((value) => value.sharp !== null),
      marketDataLimited: false,
    },
    result: null,
    breakdown: {
      verdict: moneyline.verdict,
      sharpRead: {
        key: "no_data",
        sentence: Object.values(sourceSplits).some((value) => value.sharp !== null)
          ? "Strictly matched Circa sportsbook splits are available beside separate Playbook public consensus."
          : Object.values(sourceSplits).some((value) => value.sportsbook !== null)
            ? "Strictly matched sportsbook splits are available beside separate Playbook public consensus."
            : "Playbook public splits are displayed as market context; no exact named-book split row is available in this capture.",
      },
      modelBreakdown: "The discrete drive/scoring-event distribution supplies the displayed score and winner probability. The active Spread and Total decision heads apply separate line-specific calibration; exact-price Bet grades remain separate.",
    },
    recommendationDecision,
  };
}

type NflSourceSplitEvidence = {
  sharp: MarketSplitDisplaySection | null;
  sportsbook: MarketSplitDisplaySection | null;
  availability: MarketEdgeDto["sharpBookAvailability"];
};

function buildNflRecommendationDecision(args: {
  payload: NflForwardEvidencePayload;
  projected: { away: number; home: number };
  moneyline: { market: MarketEdgeDto; decision: NflRegularEvaluatedBetDecision | null; split: NflSourceSplitEvidence };
  total: { market: MarketEdgeDto; decision: NflRegularEvaluatedBetDecision | null; split: NflSourceSplitEvidence };
  spread: { market: MarketEdgeDto; decision: NflRegularEvaluatedBetDecision | null; split: NflSourceSplitEvidence };
}) {
  const marketInput = (
    key: "moneyline" | "total" | "firstInning",
    value: { market: MarketEdgeDto; decision: NflRegularEvaluatedBetDecision | null; split: NflSourceSplitEvidence },
  ) => ({
    key,
    pick: value.market.pick,
    selectedSide: selectedDecisionSide(args.payload, value.decision),
    modelProbability: value.market.modelProb,
    marketImplied: value.market.marketFairProb,
    edgePp: value.decision ? (value.decision.modelProbability - value.decision.marketFairProbability) * 100 : null,
    price: value.market.priceAmerican,
    playGrade: value.decision?.grade ?? "No Play",
    quickRead: value.market.displayReason ?? "The outcome forecast and exact-price Bet grade remain separate.",
    riskNote: "Outcome forecast, public consensus, source-specific sportsbook splits, and exact-price Bet grade are separate evidence layers.",
    publicSplits: value.market.publicSplits,
    marketReadV2: null,
    marketReadV2Enabled: false,
    sharpBookSplitsOverride: value.split.sharp,
    lineMovementOverride: null,
    allowBestAngleMarketConflict: value.decision !== null,
  });
  return buildRecommendationDecision({
    sport: "nfl",
    slateDate: localDate(args.payload.game.scheduledStart),
    gameId: `nfl-${args.payload.game.providerGameId}`,
    homeTeam: args.payload.game.home.abbreviation,
    awayTeam: args.payload.game.away.abbreviation,
    projectedScore: args.projected,
    markets: [
      marketInput("moneyline", args.moneyline),
      marketInput("total", args.total),
      marketInput("firstInning", args.spread),
    ],
  });
}

function selectedDecisionSide(
  payload: NflForwardEvidencePayload,
  decision: NflRegularEvaluatedBetDecision | null,
): "home" | "away" | "over" | "under" | null {
  if (!decision) return null;
  if (decision.market === "total") return decision.side.startsWith("Over ") ? "over" : "under";
  return decision.side === payload.game.home.abbreviation ? "home" : "away";
}

function nflSourceSplitEvidence(
  payload: NflForwardEvidencePayload,
  market: NflRegularSharpMarket,
  movementRows: NflForwardStoredEvidence[] = [],
): NflSourceSplitEvidence {
  const split = payload.market.sharpApiSplits?.[market] ?? null;
  if (!split || !completeNflMarketSplit(split, market)) {
    return {
      sharp: null,
      sportsbook: null,
      availability: {
        status: "pending",
        message: "No complete exact-match named-book split row is available for this market yet.",
        lastUpdated: split?.providerFetchedAt ?? split?.capturedAt ?? null,
      },
    };
  }
  const book = normalizeBookName(split.sourceSportsbook ?? "");
  if (book !== "circa" && book !== "draftkings" && book !== "betmgm") {
    return {
      sharp: null,
      sportsbook: null,
      availability: {
        status: "provider_limited",
        message: "The matched split row is not from an approved source-specific sportsbook.",
        lastUpdated: split.providerFetchedAt ?? split.capturedAt,
      },
    };
  }
  const observedAt = split.providerFetchedAt ?? split.capturedAt;
  const previous = movementRows
    .map((row) => row.payload.market.sharpApiSplits?.[market] ?? null)
    .filter((candidate): candidate is NflRegularSharpSplit =>
      candidate !== null &&
      normalizeBookName(candidate.sourceSportsbook ?? "") === book &&
      Date.parse(candidate.providerFetchedAt ?? candidate.capturedAt) < Date.parse(observedAt)
    )
    .sort((first, second) =>
      Date.parse(first.providerFetchedAt ?? first.capturedAt) -
      Date.parse(second.providerFetchedAt ?? second.capturedAt)
    )[0] ?? null;
  const firstTrackedObservedAt = previous?.providerFetchedAt ?? previous?.capturedAt ?? null;
  const staleAfterMinutes = 390;
  const isStale = Date.parse(payload.capturedAt) - Date.parse(observedAt) > staleAfterMinutes * 60_000;
  const stamp = { observedAt, freshnessCheckedAt: split.capturedAt, staleAfterMinutes, isStale };
  const rows = market === "total"
    ? [
        withFirstTrackedSplitObservation({ side: "over" as const, label: "Over", moneyPct: split.overMoneyPct, betsPct: split.overBetsPct, ...stamp }, previous ? { moneyPct: previous.overMoneyPct, betsPct: previous.overBetsPct, observedAt: firstTrackedObservedAt } : null),
        withFirstTrackedSplitObservation({ side: "under" as const, label: "Under", moneyPct: split.underMoneyPct, betsPct: split.underBetsPct, ...stamp }, previous ? { moneyPct: previous.underMoneyPct, betsPct: previous.underBetsPct, observedAt: firstTrackedObservedAt } : null),
      ]
    : [
        withFirstTrackedSplitObservation({ side: "home" as const, label: payload.game.home.abbreviation, moneyPct: split.homeMoneyPct, betsPct: split.homeBetsPct, ...stamp }, previous ? { moneyPct: previous.homeMoneyPct, betsPct: previous.homeBetsPct, observedAt: firstTrackedObservedAt } : null),
        withFirstTrackedSplitObservation({ side: "away" as const, label: payload.game.away.abbreviation, moneyPct: split.awayMoneyPct, betsPct: split.awayBetsPct, ...stamp }, previous ? { moneyPct: previous.awayMoneyPct, betsPct: previous.awayBetsPct, observedAt: firstTrackedObservedAt } : null),
      ];
  const section: MarketSplitDisplaySection = {
    label: book === "circa" ? "Sharp Book Splits" : book === "draftkings" ? "DraftKings Splits" : "BetMGM Splits",
    rows,
    signal: null,
    lastUpdated: observedAt,
  };
  if (book === "circa") {
    return {
      sharp: section,
      sportsbook: null,
      availability: {
        status: isStale ? "stale" : "complete",
        message: "Strictly matched Circa split evidence is available for this game and market.",
        lastUpdated: observedAt,
      },
    };
  }
  return { sharp: null, sportsbook: section, availability: null };
}

function completeNflMarketSplit(split: NflRegularSharpSplit, market: NflRegularSharpMarket): boolean {
  return market === "total"
    ? complementarySplit(split.overMoneyPct, split.underMoneyPct) && complementarySplit(split.overBetsPct, split.underBetsPct)
    : complementarySplit(split.homeMoneyPct, split.awayMoneyPct) && complementarySplit(split.homeBetsPct, split.awayBetsPct);
}

function complementarySplit(first: number | null, second: number | null): boolean {
  return first !== null && second !== null && Math.abs(first + second - 100) <= 1;
}

function withPrimaryPrediction(
  market: MarketEdgeDto,
  input: {
    slot: "moneyline" | "spread" | "total";
    away: string;
    home: string;
    outcome: ReturnType<typeof getNflV1WeekOneOutcomeForecast>;
    decision: NflRegularEvaluatedBetDecision | null;
    current: NflForwardEvidencePayload["market"]["current"];
  },
): MarketEdgeDto {
  if (input.slot === "moneyline") {
    const home = input.outcome.homeWinProbability >= input.outcome.awayWinProbability;
    return {
      ...market,
      marketPrediction: {
        status: "available",
        label: home ? input.home : input.away,
        line: null,
        probability: home ? input.outcome.homeWinProbability : input.outcome.awayWinProbability,
        source: "model_outcome",
        sportsbook: null,
        observedAt: null,
        freshnessCheckedAt: input.current.observedAt,
        reason: "The joint score distribution owns the winner prediction; the exact-price Moneyline selection and Bet grade remain separate.",
      },
    };
  }
  const decisionLine = input.decision?.evaluatedQuote.line;
  const line = decisionLine ?? (input.slot === "spread" ? input.current.spread?.homeLine : input.current.total?.line) ?? null;
  if (line === null) return market;
  const homeSpread = input.slot === "spread"
    ? input.decision
      ? input.decision.side.startsWith(input.home) ? line : -line
      : input.current.spread!.homeLine
    : 0;
  const probabilities = nflV1WeekOneLineProbabilities({
    forecast: input.outcome,
    homeSpread,
    totalLine: input.slot === "total" ? line : 0,
  });
  const primary = input.slot === "spread"
    ? probabilities.spread.homeCoverProbability >= probabilities.spread.awayCoverProbability
    : probabilities.total.overProbability >= probabilities.total.underProbability;
  const label = input.slot === "spread"
    ? primary ? `${input.home} ${signed(homeSpread)}` : `${input.away} ${signed(-homeSpread)}`
    : `${primary ? "Over" : "Under"} ${marketNumber(line)}`;
  const probability = input.slot === "spread"
    ? primary ? probabilities.spread.homeCoverProbability : probabilities.spread.awayCoverProbability
    : primary ? probabilities.total.overProbability : probabilities.total.underProbability;
  return {
    ...market,
    marketPrediction: {
      status: "available",
      label,
      line: input.slot === "spread" ? primary ? homeSpread : -homeSpread : line,
      probability,
      source: "model_at_exact_book_line",
      sportsbook: input.decision?.evaluatedQuote.sportsbook ?? input.current.sportsbook,
      observedAt: input.decision?.evaluatedQuote.observedAt ?? input.current.observedAt,
      freshnessCheckedAt: input.current.observedAt,
      reason: "The joint score distribution owns this line-specific prediction; the separately calibrated exact-price selection and Bet grade remain separate.",
    },
  };
}

function quarterbackContext(payload: NflForwardEvidencePayload, side: "away" | "home") {
  const depth = payload.startersAndDepth[side];
  return { name: depth.expectedStartingQuarterback?.name ?? null, status: depth.starterStatus };
}

type HeldMarketInput = {
  slot: "moneyline" | "total" | "spread";
  away: string;
  home: string;
  current: MarketQuoteSide;
  opening: MarketQuoteSide & { provenance: "provider_opening" | "first_observed" };
  split: NflForwardPlaybookSplit | null;
  primaryLabel: string;
  opposingLabel: string;
  primarySide: "home" | "over";
  opposingSide: "away" | "under";
  payload: NflForwardEvidencePayload;
  movementRows: NflForwardStoredEvidence[];
};

type MarketQuoteSide = {
  sportsbook: string;
  observedAt: string;
  primaryPrice: number;
  opposingPrice: number;
  primaryLine: number | null;
  opposingLine: number | null;
};

function buildHeldMarket(input: HeldMarketInput): MarketEdgeDto {
  const primaryTrail = buildSameBookTrail({
    rows: input.movementRows,
    sportsbook: input.current.sportsbook,
    slot: input.slot,
    selectedPrimary: true,
    terminal: {
      american: input.current.primaryPrice,
      line: input.current.primaryLine,
      observedAt: input.current.observedAt,
    },
  });
  const opposingTrail = buildSameBookTrail({
    rows: input.movementRows,
    sportsbook: input.current.sportsbook,
    slot: input.slot,
    selectedPrimary: false,
    terminal: {
      american: input.current.opposingPrice,
      line: input.current.opposingLine,
      observedAt: input.current.observedAt,
    },
  });
  const publicSplits = splitRows(input);
  const expectedAwayQuarterback = input.payload.startersAndDepth.away.expectedStartingQuarterback?.name ?? "Quarterback TBD";
  const expectedHomeQuarterback = input.payload.startersAndDepth.home.expectedStartingQuarterback?.name ?? "Quarterback TBD";
  const injuryCounts = input.payload.injuries?.teams ?? [];
  const awayInjuries = injuryCounts.find((team) => team.abbreviation === input.away)?.players.length ?? null;
  const homeInjuries = injuryCounts.find((team) => team.abbreviation === input.home)?.players.length ?? null;
  const marketLabel = input.slot === "moneyline" ? "moneyline" : input.slot === "total" ? "total" : "spread";
  return {
    pick: null,
    confidence: null,
    grade: null,
    signalType: null,
    marketSignal: "market_neutral",
    sharpStatus: "mixed",
    held: true,
    verdict: { key: "no_play", label: "No Play" },
    rawGrade: null,
    rawRecScore: null,
    capReasons: [
      "nfl_exact_price_decision_health_hold",
      ...input.payload.coverage.healthHolds,
    ],
    finalGrade: null,
    finalRecScore: null,
    actionabilityLabel: "No Play",
    displayReason: HOLD_REASON,
    guidedGuide: `The ${marketLabel} prediction remains live. The exact-price Bet grade is No Play while required sportsbook or data-health evidence is repaired.`,
    guidedWatchOut: HOLD_REASON,
    whyLine: "The reader preserves the live model prediction plus verified market, split, quarterback, injury, and weather context while the price defect is repaired.",
    riskLine: HOLD_REASON,
    modelProb: null,
    marketFairProb: null,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits,
    priceAmerican: null,
    currentPriceAmerican: null,
    currentPriceSportsbook: input.current.sportsbook,
    currentPriceObservedAt: input.current.observedAt,
    bestAvailablePriceAmerican: null,
    bestAvailableSportsbook: null,
    bestAvailableObservedAt: null,
    gradePriceAmerican: null,
    fiMarketBoard: null,
    lineOpenAmerican: input.opening.primaryPrice,
    priceUnavailableAtLock: false,
    priceObservedAt: input.current.observedAt,
    priceIsStale: false,
    lineOpenObservedAt: input.opening.observedAt,
    lineOpenIsStale: false,
    moneyPctObservedAt: input.split?.capturedAt ?? null,
    moneyPctIsStale: false,
    betsPctObservedAt: input.split?.capturedAt ?? null,
    betsPctIsStale: false,
    oddspherePostedAmerican: null,
    oddspherePostedAt: null,
    oddspherePostedMatchesPick: false,
    lockedLineAmerican: null,
    lockedLineAt: null,
    oddsTrail: primaryTrail,
    lineTrail: input.current.primaryLine === null ? [] : primaryTrail,
    opposingOddsTrail: {
      side: input.opposingSide,
      label: input.opposingLabel,
      stops: opposingTrail,
    },
    marketInterpretation: {
      chipLabel: "Bet grade No Play",
      chipTone: "gray",
      flags: ["decision_health_hold"],
      detail: ["Verified two-sided prices, Opening movement, and public consensus remain visible while the affected exact-price decision fails closed."],
    },
    marketReadV2: null,
    marketReadV2Enabled: false,
    lastMovePrevAmerican: input.opening.primaryPrice,
    lastMoveNextAmerican: input.current.primaryPrice,
    lastMoveAtIso: input.current.observedAt,
    lastMoveLinePrev: input.opening.primaryLine,
    lastMoveLineNext: input.current.primaryLine,
    modelTotal: null,
    marketTotal: input.slot === "total" ? input.current.primaryLine : null,
    line: input.current.primaryLine,
    keyStats: [
      {
        label: `Current two-sided ${marketLabel}`,
        awayValue: input.opposingLabel + ` ${formatAmerican(input.current.opposingPrice)}`,
        homeValue: input.primaryLabel + ` ${formatAmerican(input.current.primaryPrice)}`,
        source: "computed",
      },
      {
        label: "Expected quarterbacks · provider depth chart",
        awayValue: `${expectedAwayQuarterback} · ${titleCase(input.payload.startersAndDepth.away.starterStatus)}`,
        homeValue: `${expectedHomeQuarterback} · ${titleCase(input.payload.startersAndDepth.home.starterStatus)}`,
        source: "feature_snapshot",
      },
      {
        label: "Provider-listed injuries",
        awayValue: awayInjuries === null ? "Report unavailable" : `${awayInjuries} listed`,
        homeValue: homeInjuries === null ? "Report unavailable" : `${homeInjuries} listed`,
        source: "feature_snapshot",
      },
    ],
    modelTrustPct: null,
    marketImpliedPct: null,
    modelMarketGapPct: null,
    recommendationConfidence: null,
    marketSource: input.current.sportsbook,
    marketDataQuality: "two_sided_consensus",
    reviewFlags: [...new Set(["nfl_exact_price_decision_health_hold", ...input.payload.coverage.healthHolds])],
    reviewActionSummary: "repair_price_coverage",
  };
}

function decisionFor(
  decisions: NflRegularEvaluatedBetDecision[],
  market: "moneyline" | "spread" | "total",
): NflRegularEvaluatedBetDecision | null {
  const matches = decisions.filter((decision) => decision.market === market);
  if (matches.length > 1) throw new Error(`NFL member fixture has duplicate ${market} decisions.`);
  return matches[0] ?? null;
}

function applyPublishedDecision(
  base: MarketEdgeDto,
  decision: NflRegularEvaluatedBetDecision | null,
  input: {
    slot: "moneyline" | "spread" | "total";
    payload: NflForwardEvidencePayload;
    movementRows: NflForwardStoredEvidence[];
    primaryLabel: string;
    opposingLabel: string;
    primarySide: "home" | "over";
    opposingSide: "away" | "under";
    expectedTotal?: number;
  },
): MarketEdgeDto {
  if (!decision) return base;
  const selectedPrimary = input.slot === "total"
    ? decision.side.startsWith("Over ")
    : decision.side === input.payload.game.home.abbreviation;
  const selectedSide = selectedPrimary ? input.primarySide : input.opposingSide;
  const opposingSide = selectedPrimary ? input.opposingSide : input.primarySide;
  const selectedLabel = selectedPrimary ? input.primaryLabel : input.opposingLabel;
  const opposingLabel = selectedPrimary ? input.opposingLabel : input.primaryLabel;
  const oddsTrail = buildSameBookTrail({
    rows: input.movementRows,
    sportsbook: decision.evaluatedQuote.sportsbook,
    slot: input.slot,
    selectedPrimary,
    terminal: {
      american: decision.evaluatedQuote.price,
      line: decision.evaluatedQuote.line,
      observedAt: decision.evaluatedQuote.observedAt,
      locked: decision.stage === "t60_locked",
    },
  });
  const exactBook = input.payload.market.currentBooks.find((quote) =>
    normalizeBookName(quote.sportsbook) === normalizeBookName(decision.evaluatedQuote.sportsbook));
  const opposingQuote = exactBook ? oppositeQuote(exactBook, input.slot, selectedPrimary) : null;
  const opposingStops = opposingQuote ? buildSameBookTrail({
    rows: input.movementRows,
    sportsbook: decision.evaluatedQuote.sportsbook,
    slot: input.slot,
    selectedPrimary: !selectedPrimary,
    terminal: {
      american: opposingQuote.price,
      line: opposingQuote.line,
      observedAt: exactBook!.observedAt,
      locked: decision.stage === "t60_locked",
    },
  }) : [];
  const selectedSplit = base.publicSplits.find((row) => row.side === selectedSide) ?? null;
  const isBestAngle = decision.grade === "Best Angle";
  const isLean = decision.grade === "Lean";
  const isWatchlist = decision.grade === "Watchlist";
  const actionability = isBestAngle ? 82 : isLean ? 62 : isWatchlist ? 45 : 32;
  const marketName = input.slot === "moneyline" ? "moneyline" : input.slot;
  const copy = isBestAngle
    ? `${selectedLabel} clears the validated NFL Best Angle policy at ${formatAmerican(decision.evaluatedQuote.price)} from ${decision.evaluatedQuote.sportsbook}: the exact-price value lane and independent football forecast agree at the strongest qualified tier.`
    : isLean
    ? `${selectedLabel} clears the validated NFL market-led value policy at ${formatAmerican(decision.evaluatedQuote.price)} from ${decision.evaluatedQuote.sportsbook}, with positive expected value at the displayed value-model probability.`
    : isWatchlist
      ? `${selectedLabel} is inside the validated NFL monitoring lane at ${formatAmerican(decision.evaluatedQuote.price)} from ${decision.evaluatedQuote.sportsbook}, but it does not clear the exact-price Lean policy. Monitor only.`
    : marketName === "moneyline"
      ? `${selectedLabel} is the football outcome forecast side, but this probability is not authorized as an exact-price moneyline betting edge.`
      : `${selectedLabel} is the separately calibrated ${marketName} forecast side, but this probability is not authorized as an exact-price betting edge.`;
  return {
    ...base,
    pick: selectedLabel,
    confidence: decision.modelProbability,
    grade: isBestAngle ? "best_signal" : isLean ? "model_only" : isWatchlist ? "market_watch" : null,
    signalType: isBestAngle ? "balanced" : isLean ? "model_only" : null,
    held: false,
    verdict: isBestAngle
      ? { key: "best_angle", label: "Best Angle" }
      : isLean
      ? { key: "lean", label: "Lean" }
      : isWatchlist
        ? { key: "watchlist", label: "Watchlist" }
        : { key: "no_play", label: "No Play" },
    rawGrade: isBestAngle ? "best_signal" : isLean ? "model_only" : isWatchlist ? "market_watch" : null,
    rawRecScore: actionability,
    capReasons: [
      isBestAngle
        ? "nfl_r9_exact_price_moneyline_best_angle"
        : isLean
        ? `nfl_r9_exact_price_${marketName}_lean`
        : isWatchlist
          ? "nfl_moneyline_monitoring_lane"
          : "nfl_exact_price_policy_not_cleared",
      ...(input.payload.startersAndDepth.away.starterStatus !== "confirmed" ? ["away_expected_quarterback_projected"] : []),
      ...(input.payload.startersAndDepth.home.starterStatus !== "confirmed" ? ["home_expected_quarterback_projected"] : []),
    ],
    finalGrade: isBestAngle ? "best_signal" : isLean ? "model_only" : isWatchlist ? "market_watch" : null,
    finalRecScore: actionability,
    actionabilityLabel: isBestAngle ? "Best Angle" : isLean ? "Lean" : isWatchlist ? "Watchlist" : "No Play",
    displayReason: copy,
    guidedGuide: copy,
    guidedWatchOut: "Early-week prices and expected starters continue to refresh until the immutable T-60 decision.",
    whyLine: copy,
    riskLine: "The outcome forecast and exact-price Bet grade are separate; projected quarterback status is visible uncertainty, not an automatic Hold.",
    modelProb: decision.modelProbability,
    marketFairProb: decision.marketFairProbability,
    pinnacleEvPct: isBestAngle || isLean ? decision.expectedValue * 100 : null,
    moneyPct: selectedSplit?.moneyPct ?? null,
    betsPct: selectedSplit?.betsPct ?? null,
    priceAmerican: decision.evaluatedQuote.price,
    currentPriceAmerican: decision.evaluatedQuote.price,
    currentPriceSportsbook: decision.evaluatedQuote.sportsbook,
    currentPriceObservedAt: decision.evaluatedQuote.observedAt,
    gradePriceAmerican: decision.evaluatedQuote.price,
    lineOpenAmerican: oddsTrail.length > 1 ? oddsTrail[0]!.american : null,
    priceObservedAt: decision.evaluatedQuote.observedAt,
    lineOpenObservedAt: oddsTrail.length > 1 ? oddsTrail[0]!.observedAt : null,
    oddspherePostedAmerican: decision.evaluatedQuote.price,
    oddspherePostedAt: decision.evaluatedAt,
    oddspherePostedMatchesPick: true,
    lockedLineAmerican: decision.stage === "t60_locked" ? decision.evaluatedQuote.price : null,
    lockedLineAt: decision.lockedAt,
    oddsTrail,
    lineTrail: input.slot === "moneyline" ? [] : oddsTrail,
    opposingOddsTrail: {
      side: opposingSide,
      label: opposingLabel,
      stops: opposingStops,
    },
    marketInterpretation: null,
    lastMovePrevAmerican: oddsTrail.length > 1 ? oddsTrail[oddsTrail.length - 2]!.american : null,
    lastMoveNextAmerican: oddsTrail.length > 1 ? oddsTrail[oddsTrail.length - 1]!.american : null,
    lastMoveAtIso: oddsTrail.length > 1 ? oddsTrail[oddsTrail.length - 1]!.observedAt : null,
    lastMoveLinePrev: oddsTrail.length > 1 ? oddsTrail[oddsTrail.length - 2]!.line : null,
    lastMoveLineNext: oddsTrail.length > 1 ? oddsTrail[oddsTrail.length - 1]!.line : null,
    modelTotal: input.slot === "total" ? input.expectedTotal ?? null : null,
    line: decision.evaluatedQuote.line,
    modelTrustPct: decision.modelProbability * 100,
    marketImpliedPct: decision.marketFairProbability * 100,
    modelMarketGapPct: (decision.modelProbability - decision.marketFairProbability) * 100,
    recommendationConfidence: actionability,
    marketSource: decision.evaluatedQuote.sportsbook,
    reviewFlags: [...new Set([
      ...input.payload.coverage.healthHolds,
      ...(input.payload.startersAndDepth.away.starterStatus !== "confirmed" ? ["away_expected_quarterback_projected"] : []),
      ...(input.payload.startersAndDepth.home.starterStatus !== "confirmed" ? ["home_expected_quarterback_projected"] : []),
    ])],
    reviewActionSummary: "keep",
  };
}

function oppositeQuote(
  quote: NflForwardEvidencePayload["market"]["current"],
  slot: "moneyline" | "spread" | "total",
  selectedPrimary: boolean,
): { price: number; line: number | null } | null {
  if (slot === "moneyline" && quote.moneyline) {
    return selectedPrimary
      ? { price: quote.moneyline.awayPrice, line: null }
      : { price: quote.moneyline.homePrice, line: null };
  }
  if (slot === "spread" && quote.spread) {
    return selectedPrimary
      ? { price: quote.spread.awayPrice, line: quote.spread.awayLine }
      : { price: quote.spread.homePrice, line: quote.spread.homeLine };
  }
  if (slot === "total" && quote.total) {
    return selectedPrimary
      ? { price: quote.total.underPrice, line: quote.total.line }
      : { price: quote.total.overPrice, line: quote.total.line };
  }
  return null;
}

function buildSameBookTrail(args: {
  rows: NflForwardStoredEvidence[];
  sportsbook: string;
  slot: "moneyline" | "spread" | "total";
  selectedPrimary: boolean;
  terminal: {
    american: number;
    line: number | null;
    observedAt: string;
    locked?: boolean;
  };
}): OddsTrailStopDto[] {
  const book = normalizeBookName(args.sportsbook);
  const candidates: OddsTrailStopDto[] = [];
  const append = (stop: OddsTrailStopDto, replaceDuplicate = false) => {
    const key = `${normalizeBookName(stop.sportsbook ?? "")}:${stop.observedAt}:${stop.american}:${stop.line ?? "null"}`;
    const duplicateIndex = candidates.findIndex((candidate) =>
      `${normalizeBookName(candidate.sportsbook ?? "")}:${candidate.observedAt}:${candidate.american}:${candidate.line ?? "null"}` === key);
    if (duplicateIndex >= 0) {
      if (replaceDuplicate) candidates.splice(duplicateIndex, 1);
      else return;
    }
    candidates.push(stop);
  };

  for (const row of args.rows) {
    const market = row.payload.market;
    const openingBooks = [
      ...market.providerOpeningBooks,
      ...(market.providerOpening ? [market.providerOpening] : []),
    ];
    for (const quote of openingBooks) {
      if (normalizeBookName(quote.sportsbook) !== book) continue;
      const side = quoteSide(quote, args.slot, args.selectedPrimary);
      if (!side) continue;
      append({
        american: side.american,
        line: side.line,
        observedAt: quote.observedAt,
        sportsbook: quote.sportsbook,
        source: "provider_opening",
        label: "open",
      });
    }
  }

  const operationalOpening = args.rows[0]?.payload.market.operationalOpening ?? null;
  if (operationalOpening && normalizeBookName(operationalOpening.quote.sportsbook) === book) {
    const side = quoteSide(operationalOpening.quote, args.slot, args.selectedPrimary);
    if (side) {
      append({
        american: side.american,
        line: side.line,
        observedAt: operationalOpening.capturedAt,
        sportsbook: operationalOpening.quote.sportsbook,
        source: operationalOpening.provenance === "provider_opening" ? "provider_opening" : "line_history",
        label: operationalOpening.provenance === "provider_opening" ? "open" : "first",
      });
    }
  }

  for (const row of args.rows.slice(0, -1)) {
    const market = row.payload.market;
    const currentBooks = market.currentBooks;
    const quote = currentBooks.find((candidate) =>
      normalizeBookName(candidate.sportsbook) === book) ??
      (normalizeBookName(market.current.sportsbook) === book
        ? market.current
        : null);
    if (!quote) continue;
    const side = quoteSide(quote, args.slot, args.selectedPrimary);
    if (!side) continue;
    append({
      american: side.american,
      line: side.line,
      observedAt: quote.observedAt,
      sportsbook: quote.sportsbook,
      source: "line_history",
      label: "move",
    });
  }

  append({
    american: args.terminal.american,
    line: args.terminal.line,
    observedAt: args.terminal.observedAt,
    sportsbook: args.sportsbook,
    source: args.terminal.locked ? "locked_snapshot" : "current_line",
    label: args.terminal.locked ? "locked" : "current",
  }, true);

  const materialStops = candidates.reduce<OddsTrailStopDto[]>((stops, stop, index) => {
    if (index === 0) return [stop];
    const previous = stops[stops.length - 1]!;
    const changed = previous.american !== stop.american || previous.line !== stop.line;
    const terminal = index === candidates.length - 1;
    if (changed || terminal) stops.push(stop);
    return stops;
  }, []);

  return materialStops.map((stop, index, stops) => ({
    ...stop,
    source: index === stops.length - 1
      ? args.terminal.locked ? "locked_snapshot" : "current_line"
      : stop.source === "provider_opening" ? "provider_opening" : "line_history",
    label: index === stops.length - 1
      ? args.terminal.locked ? "locked" : "current"
      : index === 0
        ? stop.source === "provider_opening" ? "open" : "first"
        : "move",
  }));
}

function quoteSide(
  quote: NflForwardEvidencePayload["market"]["current"],
  slot: "moneyline" | "spread" | "total",
  selectedPrimary: boolean,
): { american: number; line: number | null } | null {
  if (slot === "moneyline" && quote.moneyline) {
    return selectedPrimary
      ? { american: quote.moneyline.homePrice, line: null }
      : { american: quote.moneyline.awayPrice, line: null };
  }
  if (slot === "spread" && quote.spread) {
    return selectedPrimary
      ? { american: quote.spread.homePrice, line: quote.spread.homeLine }
      : { american: quote.spread.awayPrice, line: quote.spread.awayLine };
  }
  if (slot === "total" && quote.total) {
    return selectedPrimary
      ? { american: quote.total.overPrice, line: quote.total.line }
      : { american: quote.total.underPrice, line: quote.total.line };
  }
  return null;
}

function normalizeBookName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function splitRows(input: HeldMarketInput): MarketEdgeDto["publicSplits"] {
  if (!input.split) return [];
  const stamp = {
    observedAt: input.split.capturedAt,
    freshnessCheckedAt: input.split.capturedAt,
    staleAfterMinutes: 360,
    isStale: false,
  };
  if (input.slot === "total") {
    return [
      { side: "over", label: "Over", moneyPct: input.split.overMoneyPct, betsPct: input.split.overBetsPct, ...stamp },
      { side: "under", label: "Under", moneyPct: input.split.underMoneyPct, betsPct: input.split.underBetsPct, ...stamp },
    ];
  }
  return [
    { side: "away", label: input.away, moneyPct: input.split.awayMoneyPct, betsPct: input.split.awayBetsPct, ...stamp },
    { side: "home", label: input.home, moneyPct: input.split.homeMoneyPct, betsPct: input.split.homeBetsPct, ...stamp },
  ];
}

function nflLogo(abbreviation: string): string {
  const normalized = abbreviation.toUpperCase() === "WAS" ? "wsh" : abbreviation.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${normalized}.png`;
}

function formatKickoff(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function kickoffMinutes(timestamp: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function localDate(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error(`Unable to derive NFL slate date from ${timestamp}.`);
  return `${year}-${month}-${day}`;
}

function marketNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${marketNumber(value)}`;
}

function formatAmerican(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
