import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DailyEdgeGameDto,
  DailyEdgePredictionDto,
  MarketEdgeDto,
  OddsTrailStopDto,
} from "@/app/lab/lib/labTypes";
import type { FootballPreviewFixture } from "@/app/dev/football-preview/footballPreviewFixture";
import type { PreviewAvailabilityByGame } from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardPlaybookSplit,
  type NflForwardStoredEvidence,
} from "./nflForwardEvidence";
import { readNflForwardEvidence } from "./nflForwardEvidenceStore";
import { NFL_T60_MAX_CAPTURE_LAG_MINUTES } from "./nflRegularDecisionEvidence";
import {
  getNflV1WeekOneOutcomeForecast,
  NFL_V1_OUTCOME_DISTRIBUTION_RELEASE,
  NFL_V1_OUTCOME_MODEL_RELEASE,
  NFL_V1_OUTCOME_PROBABILITY_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
} from "./nflV1WeekOneOutcome";

export const NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE =
  "nfl_week_one_held_member_fixture_2026_08_23_r2_outcome" as const;

const MODEL_RELEASE = NFL_V1_OUTCOME_MODEL_RELEASE;
const DECISION_RELEASE = "nfl_exact_price_decision_hold_2026_08_22_r1" as const;
const HOLD_REASON =
  "OddSphere's independent Week 1 score and winner forecast is available. Exact-price Bet grades remain Held; projected quarterbacks are context and do not create a wager.";

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
  const rows = await readNflForwardEvidence({ client: args.client, season, week });
  return buildNflWeekOneHeldMemberFixture(rows);
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
  const games = latest
    .map((row) => buildHeldGame(row))
    .sort((first, second) => Date.parse(first.gameStartAt ?? "") - Date.parse(second.gameStartAt ?? ""));
  const sourceChecksum = createHash("sha256")
    .update(latest.map((row) => `${row.providerGameId}:${row.payloadSha256}`).sort().join("|"))
    .digest("hex");
  const confirmedQuarterbacks = latest.reduce((count, row) => count +
    Number(row.payload.startersAndDepth.away.starterStatus === "confirmed") +
    Number(row.payload.startersAndDepth.home.starterStatus === "confirmed"), 0);
  const projectedQuarterbacks = latest.reduce((count, row) => count +
    Number(row.payload.startersAndDepth.away.starterStatus === "projected") +
    Number(row.payload.startersAndDepth.home.starterStatus === "projected"), 0);
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
      slate_status: "week_one_model_held",
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
      results: "No preseason results; regular-season tracking has not begun",
      modelRelease: MODEL_RELEASE,
      decisionRelease: DECISION_RELEASE,
      sourceChecksum,
      providerRequests: 0,
      openingCoverageGames: latest.length,
      firstObservedCoverageGames: latest.length,
      minimumStoredPriceObservations: 2,
      splitCoverageGames: latest.filter((row) => row.payload.market.playbookSplits !== null).length,
    },
    tracking: {
      seasonPhase: "regular",
      trackingEligible: false,
      reason: "Regular-season tracking remains disabled until the model is launch-approved and a prediction is locked.",
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
  if (values.some((row) => row.payload.decisions.publicationEnabled || row.payload.decisions.trackingEnabled)) {
    throw new Error("NFL Week 1 held fixture cannot consume evidence with publication or tracking enabled.");
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

function buildHeldGame(row: NflForwardStoredEvidence & { payload: NflForwardEvidencePayload }): DailyEdgeGameDto {
  const payload = row.payload;
  const game = payload.game;
  const current = payload.market.current;
  const opening = payload.market.operationalOpening;
  const away = game.away.abbreviation;
  const home = game.home.abbreviation;
  const outcome = getNflV1WeekOneOutcomeForecast({
    providerGameId: game.providerGameId,
    awayTeam: away,
    homeTeam: home,
  });
  const moneyline = buildHeldMarket({
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
  });
  const total = buildHeldMarket({
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
  });
  const spread = buildHeldMarket({
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
  });
  const locked = payload.stage === "t60" &&
    payload.t60LagMinutes !== null &&
    payload.t60LagMinutes <= NFL_T60_MAX_CAPTURE_LAG_MINUTES;
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
    holdReason: "nfl_week_one_model_validation_and_projected_qb_hold",
    dataCompleteness: null,
    homeStarter: null,
    awayStarter: null,
    predictions: {
      ml: prediction(moneyline),
      total: { ...prediction(total), line: total.line },
      nrfi: prediction(spread),
    },
    markets,
    decisionLine: "Independent score and winner forecasts are live in the reader. Exact-price Bet grades remain Held and are not inferred from the outcome forecast.",
    projected: {
      away: outcome.projectedAwayScore,
      home: outcome.projectedHomeScore,
    },
    footballProjection: {
      awayWinProbability: outcome.awayWinProbability,
      homeWinProbability: outcome.homeWinProbability,
      modelRelease: NFL_V1_OUTCOME_MODEL_RELEASE,
      distributionRelease: NFL_V1_OUTCOME_DISTRIBUTION_RELEASE,
      probabilityRelease: NFL_V1_OUTCOME_PROBABILITY_RELEASE,
      artifactRelease: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
    },
    sharpSignals: [],
    status: {
      lineupConfirmed: payload.startersAndDepth.away.starterStatus === "confirmed" && payload.startersAndDepth.home.starterStatus === "confirmed",
      linesLocked: locked,
      sharpSignalPending: payload.market.sharpApiSplits === null,
      marketDataLimited: false,
    },
    result: null,
    breakdown: {
      verdict: { key: "no_play", label: "Held" },
      sharpRead: {
        key: "no_data",
        sentence: "Playbook public splits are displayed as market context; SharpAPI splits are not available in this capture.",
      },
      modelBreakdown: "The independent football model supplies the displayed score and winner probability. Bet grades remain a separate exact-price decision and are Held.",
    },
  };
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
  const openingSource = input.opening.provenance === "provider_opening" ? "provider_opening" as const : "line_history" as const;
  const openingLabel = input.opening.provenance === "provider_opening" ? "open" as const : "first" as const;
  const primaryTrail: OddsTrailStopDto[] = [
    {
      american: input.opening.primaryPrice,
      line: input.opening.primaryLine,
      observedAt: input.opening.observedAt,
      sportsbook: input.opening.sportsbook,
      source: openingSource,
      label: openingLabel,
    },
    {
      american: input.current.primaryPrice,
      line: input.current.primaryLine,
      observedAt: input.current.observedAt,
      sportsbook: input.current.sportsbook,
      source: "current_line",
      label: "current",
    },
  ];
  const opposingTrail: OddsTrailStopDto[] = [
    {
      american: input.opening.opposingPrice,
      line: input.opening.opposingLine,
      observedAt: input.opening.observedAt,
      sportsbook: input.opening.sportsbook,
      source: openingSource,
      label: openingLabel,
    },
    {
      american: input.current.opposingPrice,
      line: input.current.opposingLine,
      observedAt: input.current.observedAt,
      sportsbook: input.current.sportsbook,
      source: "current_line",
      label: "current",
    },
  ];
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
    verdict: { key: "no_play", label: "Held" },
    rawGrade: null,
    rawRecScore: null,
    capReasons: [
      "nfl_model_writer_integration_pending",
      "expected_quarterbacks_projected_not_confirmed",
      "exact_price_decision_tuple_not_published",
    ],
    finalGrade: null,
    finalRecScore: null,
    actionabilityLabel: "Held",
    displayReason: HOLD_REASON,
    guidedGuide: `The real ${marketLabel} board is available, but OddSphere has not attached an authoritative model side or Bet grade to this exact price yet.`,
    guidedWatchOut: HOLD_REASON,
    whyLine: "The normal reader preserves verified market, split, quarterback, injury, and weather context while the model decision is held.",
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
    lineOpenAmerican: null,
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
      chipLabel: "Bet grade held",
      chipTone: "gray",
      flags: ["model_writer_pending", "projected_quarterbacks"],
      detail: ["Verified two-sided prices, Opening movement, and public consensus are visible. They are not being presented as a model prediction."],
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
    reviewFlags: [NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE, MODEL_RELEASE, DECISION_RELEASE],
    reviewActionSummary: "hold",
  };
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
