import type {
  DailyEdgeGameDto,
  DailyEdgePredictionDto,
  DailyEdgeResponse,
  MarketEdgeDto,
  OddsTrailStopDto,
} from "@/app/lab/lib/labTypes";
import type { PreviewAvailabilityByGame, PreviewHistoryByTeam } from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import { americanToImpliedProbability } from "@/lib/services/football/footballMarketMath";
import type {
  NflPreviewBookOdds,
  NflPreviewGame,
  NflPreviewProviderSlate,
  NflRegularProviderSlate,
} from "@/lib/services/football/balldontlieNflPreviewSlate";
import type {
  NflLocalShadowProjection,
  NflLocalShadowSlate,
} from "@/lib/services/football/nflLocalShadowSlate";
import type {
  NflRegularLocalProjection,
  NflRegularLocalSlate,
  NflStoredPriceHistoryByGame,
} from "@/lib/services/football/nflRegularLocalSlate";
import {
  deriveNflPreseasonShadowGrade,
  NFL_PRESEASON_SHADOW_GRADE_RELEASE,
} from "@/lib/services/football/nflPreseasonShadowGrade";
import {
  deriveNflPreseasonDryRunDecision,
  NFL_PRESEASON_DRY_RUN_DECISION_RELEASE,
  selectNflPreseasonDryRunActions,
  type NflPreseasonDryRunMarket,
} from "@/lib/services/football/nflPreseasonDryRunDecision";
import type { NflRegularConsensusSplit } from "@/lib/services/football/nflRegularMarketEvidence";
import {
  deriveNflRegularDecision,
  NFL_REGULAR_DECISION_RELEASE,
} from "@/lib/services/football/nflRegularDecision";

export type FootballPreviewSport = "nfl" | "cfb";
type MarketSlot = "moneyline" | "total" | "first_inning";
type MarketSide = "home" | "away" | "over" | "under";

export type PreviewWeek = {
  week: number;
  providerWeek: number;
  label: string;
  startDate: string;
};

export type FootballPreviewFixture = {
  sport: "nfl";
  snapshot: DailyEdgeResponse;
  history: PreviewHistoryByTeam;
  availability: PreviewAvailabilityByGame;
  week: PreviewWeek;
  previousWeek: number | null;
  nextWeek: number | null;
  provenance: {
    schedule: string;
    odds: string;
    results: string;
    modelRelease: string;
    decisionRelease: string;
    sourceChecksum: string;
    providerRequests: number;
    openingCoverageGames: number;
    firstObservedCoverageGames: number;
    minimumStoredPriceObservations: number;
    splitCoverageGames: number;
  };
  tracking: {
    seasonPhase: "preseason" | "regular";
    trackingEligible: false;
    reason:
      | "NFL preseason is excluded from official and lifetime tracking."
      | "Regular-season tracking remains disabled until the model is launch-approved and a prediction is locked.";
  };
};

export const NFL_PREVIEW_WEEKS: PreviewWeek[] = [
  { week: 1, providerWeek: 2, label: "Preseason Week 1", startDate: "2026-08-13" },
  { week: 2, providerWeek: 3, label: "Preseason Week 2", startDate: "2026-08-20" },
  { week: 3, providerWeek: 4, label: "Preseason Week 3", startDate: "2026-08-27" },
];

type MarketBuildInput = {
  seasonPhase: "preseason" | "regular";
  modelFamily: "preseason_candidate" | "regular_candidate";
  slot: MarketSlot;
  pick: string;
  opposingSide: MarketSide;
  opposingLabel: string;
  selectedSide: MarketSide;
  modelProbability: number;
  marketProbability: number;
  currentPrice: number;
  opposingCurrentPrice: number;
  currentLine: number | null;
  opposingCurrentLine: number | null;
  sportsbook: string;
  observedAt: string;
  openingPrice: number | null;
  opposingOpeningPrice: number | null;
  openingLine: number | null;
  opposingOpeningLine: number | null;
  openingObservedAt: string | null;
  priceHistory: TrackedPricePoint[];
  opposingPriceHistory: TrackedPricePoint[];
  quickRead: string;
  why: string;
  risk: string;
  keyStats: MarketEdgeDto["keyStats"];
  projectedTotal?: number;
  phaseComparisonProbability?: number;
  verifiedPriceObservations: number;
  availabilitySnapshotPresent: boolean;
  weatherSnapshotPresent: boolean;
  consensusSplit: NflRegularConsensusSplit | null;
};

type TrackedPricePoint = {
  american: number;
  line: number | null;
  observedAt: string;
  sportsbook: string;
};

export function resolveNflPreviewWeek(requestedWeek?: number): PreviewWeek {
  return NFL_PREVIEW_WEEKS.find((week) => week.week === requestedWeek) ??
    NFL_PREVIEW_WEEKS.find((week) => week.week === 2)!;
}

export function buildFootballPreviewFixture(args: {
  providerSlate: NflPreviewProviderSlate | NflRegularProviderSlate;
  shadowSlate: NflLocalShadowSlate | NflRegularLocalSlate;
  availability?: PreviewAvailabilityByGame;
  priceHistoryByGame?: NflStoredPriceHistoryByGame;
  consensusSplitsByGame?: Record<string, Record<"moneyline" | "spread" | "total", NflRegularConsensusSplit>>;
  weatherSnapshotsByGame?: Record<string, { observedAt: string }>;
  phaseComparisonSlate?: NflLocalShadowSlate;
  weekOverride?: PreviewWeek;
  seasonPhase?: "preseason" | "regular";
  previousWeek?: number | null;
  nextWeek?: number | null;
}): FootballPreviewFixture {
  const { providerSlate, shadowSlate } = args;
  const seasonPhase = args.seasonPhase ?? "preseason";
  const regularPipeline = "historicalHoldoutSeason" in shadowSlate.validation;
  if (
    args.phaseComparisonSlate &&
    Object.keys(args.phaseComparisonSlate.projectionsByGame).length !== providerSlate.games.length
  ) {
    throw new Error("NFL preseason phase-comparison projection count does not match the provider slate.");
  }
  const week = args.weekOverride ?? resolveNflPreviewWeek(providerSlate.productWeek);
  if (providerSlate.providerWeek !== week.providerWeek) {
    throw new Error("NFL product/provider week mapping mismatch.");
  }
  if (providerSlate.games.length !== Object.keys(shadowSlate.projectionsByGame).length) {
    throw new Error("NFL provider slate and shadow projection counts do not match.");
  }
  const builtGames = providerSlate.games.map((game) => {
    const current = providerSlate.currentOddsByGame[game.providerGameId];
    const opening = providerSlate.openingOddsByGame[game.providerGameId] ?? null;
    const projection = shadowSlate.projectionsByGame[game.providerGameId];
    if (!current || !projection) throw new Error(`NFL preview evidence is incomplete for provider game ${game.providerGameId}.`);
    return buildGame({
      game,
      current,
      opening,
      priceHistory: args.priceHistoryByGame?.[game.providerGameId] ?? [],
      projection,
      phaseComparisonProjection: args.phaseComparisonSlate?.projectionsByGame[game.providerGameId] ?? null,
      availabilitySnapshotPresent: Boolean(args.availability?.[`nfl-${game.providerGameId}`]),
      weatherSnapshotPresent: Boolean(args.weatherSnapshotsByGame?.[game.providerGameId]),
      consensusSplits: args.consensusSplitsByGame?.[game.providerGameId] ?? null,
      seasonPhase,
    });
  });
  const games = seasonPhase === "preseason" && regularPipeline && args.phaseComparisonSlate
    ? applyPreseasonDryRunPortfolio(builtGames)
    : builtGames;
  const weekIndex = NFL_PREVIEW_WEEKS.findIndex((candidate) => candidate.week === week.week);
  const slateDate = localDate(games[0]?.gameStartAt ?? week.startDate);
  return {
    sport: "nfl",
    snapshot: {
      as_of: providerSlate.fetchedAt,
      sport: "nfl",
      date: slateDate,
      requested_date: slateDate,
      fallback_used: false,
      slateState: "today_draft_only",
      slate_status: "local_shadow",
      last_slate_update_at: providerSlate.fetchedAt,
      games,
    },
    history: shadowSlate.history,
    availability: args.availability ?? {},
    week,
    previousWeek: args.previousWeek !== undefined ? args.previousWeek : seasonPhase === "preseason" ? NFL_PREVIEW_WEEKS[weekIndex - 1]?.week ?? null : null,
    nextWeek: args.nextWeek !== undefined ? args.nextWeek : seasonPhase === "preseason" ? NFL_PREVIEW_WEEKS[weekIndex + 1]?.week ?? null : null,
    provenance: {
      schedule: "BALLDONTLIE NFL games",
      odds: "BALLDONTLIE named-sportsbook current odds",
      results: shadowSlate.source,
      modelRelease: shadowSlate.modelRelease,
      decisionRelease: seasonPhase === "preseason"
        ? regularPipeline
          ? NFL_PRESEASON_DRY_RUN_DECISION_RELEASE
          : NFL_PRESEASON_SHADOW_GRADE_RELEASE
        : NFL_REGULAR_DECISION_RELEASE,
      sourceChecksum: shadowSlate.sourceChecksum,
      providerRequests: providerSlate.providerRequests,
      openingCoverageGames: Object.keys(providerSlate.openingOddsByGame).length,
      firstObservedCoverageGames: Object.values(args.priceHistoryByGame ?? {}).filter((observations) => observations.length > 0).length,
      minimumStoredPriceObservations: Object.values(args.priceHistoryByGame ?? {}).length > 0
        ? Math.min(...Object.values(args.priceHistoryByGame ?? {}).map((observations) => observations.length))
        : 0,
      splitCoverageGames: Object.values(args.consensusSplitsByGame ?? {}).filter((markets) =>
        markets.moneyline && markets.spread && markets.total
      ).length,
    },
    tracking: {
      seasonPhase,
      trackingEligible: false,
      reason: seasonPhase === "preseason"
        ? "NFL preseason is excluded from official and lifetime tracking."
        : "Regular-season tracking remains disabled until the model is launch-approved and a prediction is locked.",
    },
  };
}

function buildGame(args: {
  game: NflPreviewGame;
  current: NflPreviewBookOdds;
  opening: NflPreviewBookOdds | null;
  priceHistory: NflPreviewBookOdds[];
  projection: NflLocalShadowProjection | NflRegularLocalProjection;
  phaseComparisonProjection: NflLocalShadowProjection | null;
  availabilitySnapshotPresent: boolean;
  weatherSnapshotPresent: boolean;
  consensusSplits: Record<"moneyline" | "spread" | "total", NflRegularConsensusSplit> | null;
  seasonPhase: "preseason" | "regular";
}): DailyEdgeGameDto {
  const {
    game,
    current,
    opening,
    priceHistory,
    projection,
    phaseComparisonProjection,
    availabilitySnapshotPresent,
    weatherSnapshotPresent,
    consensusSplits,
    seasonPhase,
  } = args;
  if (!current.moneyline || !current.spread || !current.total) {
    throw new Error(`Selected sportsbook is missing a complete paired market for NFL game ${game.providerGameId}.`);
  }
  const moneylineFair = fairPair(current.moneyline.homePrice, current.moneyline.awayPrice);
  const spreadFair = fairPair(current.spread.homePrice, current.spread.awayPrice);
  const totalFair = fairPair(current.total.overPrice, current.total.underPrice);
  const homeCoverProbability = projection.homeCoverProbability;
  const overProbability = projection.overProbability;
  const moneylineHome = projection.homeWinProbability - moneylineFair.first >= (1 - projection.homeWinProbability) - moneylineFair.second;
  const spreadHome = homeCoverProbability - spreadFair.first >= (1 - homeCoverProbability) - spreadFair.second;
  const totalOver = overProbability - totalFair.first >= (1 - overProbability) - totalFair.second;
  const openingSameBook = opening?.sportsbook.toLowerCase() === current.sportsbook.toLowerCase() ? opening : null;
  const sameBookHistory = priceHistory
    .filter((observation) => observation.sportsbook.toLowerCase() === current.sportsbook.toLowerCase())
    .sort((first, second) => Date.parse(first.observedAt) - Date.parse(second.observedAt));
  const regular = "homeTeamContext" in projection ? projection : null;
  const marketReferenceRuntime = regular?.referenceProjectedHomeMargin !== undefined;
  const modelFamily = regular ? "regular_candidate" as const : "preseason_candidate" as const;

  const moneyline = buildMarket({
    seasonPhase,
    modelFamily,
    slot: "moneyline",
    pick: moneylineHome ? game.home.abbreviation : game.away.abbreviation,
    opposingSide: moneylineHome ? "away" : "home",
    opposingLabel: moneylineHome ? game.away.abbreviation : game.home.abbreviation,
    selectedSide: moneylineHome ? "home" : "away",
    modelProbability: moneylineHome ? projection.homeWinProbability : 1 - projection.homeWinProbability,
    marketProbability: moneylineHome ? moneylineFair.first : moneylineFair.second,
    currentPrice: moneylineHome ? current.moneyline.homePrice : current.moneyline.awayPrice,
    opposingCurrentPrice: moneylineHome ? current.moneyline.awayPrice : current.moneyline.homePrice,
    currentLine: null,
    opposingCurrentLine: null,
    sportsbook: current.sportsbook,
    observedAt: current.observedAt,
    openingPrice: openingSameBook?.moneyline ? moneylineHome ? openingSameBook.moneyline.homePrice : openingSameBook.moneyline.awayPrice : null,
    opposingOpeningPrice: openingSameBook?.moneyline ? moneylineHome ? openingSameBook.moneyline.awayPrice : openingSameBook.moneyline.homePrice : null,
    openingLine: null,
    opposingOpeningLine: null,
    openingObservedAt: openingSameBook?.moneyline ? openingSameBook.observedAt : null,
    priceHistory: sameBookHistory.flatMap((observation) => observation.moneyline ? [{
      american: moneylineHome ? observation.moneyline.homePrice : observation.moneyline.awayPrice,
      line: null,
      observedAt: observation.observedAt,
      sportsbook: observation.sportsbook,
    }] : []),
    opposingPriceHistory: sameBookHistory.flatMap((observation) => observation.moneyline ? [{
      american: moneylineHome ? observation.moneyline.awayPrice : observation.moneyline.homePrice,
      line: null,
      observedAt: observation.observedAt,
      sportsbook: observation.sportsbook,
    }] : []),
    quickRead: regular
      ? seasonPhase === "preseason"
        ? `The Week 1 ensemble is rehearsing on this preseason matchup and projects ${projectedResultLabel(game, projection.projectedHomeMargin)} after combining its independent forecast with the current ${formatBook(current.sportsbook)} market. The sharp brain separately risk-adjusts this into a dry-run grade.`
        : `The regular-season ensemble projects ${projectedResultLabel(game, projection.projectedHomeMargin)} after combining its independent matchup forecast with the current ${formatBook(current.sportsbook)} market. This 2026 forecast is locked to shadow evaluation, not a play.`
      : `The fitted preseason model projects ${projectedResultLabel(game, projection.projectedHomeMargin)} and compares ${moneylineHome ? game.home.abbreviation : game.away.abbreviation} with the current ${formatBook(current.sportsbook)} price. It is a real forecast, but not an approved play.`,
    why: regular
      ? marketReferenceRuntime
        ? "Moneyline probability is the no-vig two-sided sportsbook reference. The verified depth-chart quarterback and snap-weighted availability layer is shown separately and may adjust the total only under the accepted capped correction."
        : "The frozen ensemble uses 143 pregame features from real play-by-play, opponent-adjusted team state, depth-chart quarterbacks, injuries, roster/coach continuity, rest and venue context, then anchors conservatively to the current market."
      : "The projection was fitted on 260 actual 2019–2024 preseason games using each team’s prior regular-season opponent-adjusted efficiency and team-specific preseason history.",
    risk: regular
      ? marketReferenceRuntime
        ? "The side remains at the market reference because independent margin challengers did not beat the market gate. It cannot become an official play until the 2026 timestamped lock stream validates a decision release."
        : seasonPhase === "preseason"
        ? "This is the regular-season candidate pipeline, but preseason quarterback rotations and snap plans are not modeled. A qualified Lean is a local rehearsal grade and is never tracked."
        : "The 2025 historical holdout improved substantially over the independent model but did not beat the closing market (9.76 vs 9.72 margin MAE). Week 1 injuries and final rosters are not lock-ready yet, so the release remains No Play."
      : "Historical quarterback rotations and coach snap plans are unavailable. The 2025 side holdout was not predictive (12.7-point margin MAE; 0.272 win Brier), so preseason sides can surface only as Caution or No Play.",
    keyStats: regular ? [
      { label: marketReferenceRuntime ? "Market-reference scoring margin" : "Model margin · market-aware", awayValue: null, homeValue: `${game.home.abbreviation} ${signed(projection.projectedHomeMargin)}`, source: "computed" },
      { label: "Starting QB · current depth chart", awayValue: regular.awayStartingQuarterback ?? "Unconfirmed", homeValue: regular.homeStartingQuarterback ?? "Unconfirmed", source: "feature_snapshot" },
      { label: "Opponent-adjusted offense EPA/play", awayValue: signed3(regular.awayTeamContext.opponentAdjustedOffenseEpaPerPlay), homeValue: signed3(regular.homeTeamContext.opponentAdjustedOffenseEpaPerPlay), source: "feature_snapshot" },
    ] : [
      { label: "Shadow projected margin", awayValue: null, homeValue: `${game.home.abbreviation} ${signed(projection.projectedHomeMargin)}`, source: "computed" },
      { label: "Avg points scored · actual L10", awayValue: projection.awayRecent.averagePointsFor.toFixed(1), homeValue: projection.homeRecent.averagePointsFor.toFixed(1), source: "feature_snapshot" },
      { label: "Avg points allowed · actual L10", awayValue: projection.awayRecent.averagePointsAgainst.toFixed(1), homeValue: projection.homeRecent.averagePointsAgainst.toFixed(1), source: "feature_snapshot" },
    ],
    phaseComparisonProbability: phaseComparisonProjection
      ? moneylineHome
        ? phaseComparisonProjection.homeWinProbability
        : 1 - phaseComparisonProjection.homeWinProbability
      : undefined,
    verifiedPriceObservations: sameBookHistory.length,
    availabilitySnapshotPresent,
    weatherSnapshotPresent,
    consensusSplit: consensusSplits?.moneyline ?? null,
  });

  const total = buildMarket({
    seasonPhase,
    modelFamily,
    slot: "total",
    pick: totalOver ? "Over" : "Under",
    opposingSide: totalOver ? "under" : "over",
    opposingLabel: `${totalOver ? "Under" : "Over"} ${marketNumber(current.total.line)}`,
    selectedSide: totalOver ? "over" : "under",
    modelProbability: totalOver ? overProbability : 1 - overProbability,
    marketProbability: totalOver ? totalFair.first : totalFair.second,
    currentPrice: totalOver ? current.total.overPrice : current.total.underPrice,
    opposingCurrentPrice: totalOver ? current.total.underPrice : current.total.overPrice,
    currentLine: current.total.line,
    opposingCurrentLine: current.total.line,
    sportsbook: current.sportsbook,
    observedAt: current.observedAt,
    openingPrice: openingSameBook?.total ? totalOver ? openingSameBook.total.overPrice : openingSameBook.total.underPrice : null,
    opposingOpeningPrice: openingSameBook?.total ? totalOver ? openingSameBook.total.underPrice : openingSameBook.total.overPrice : null,
    openingLine: openingSameBook?.total?.line ?? null,
    opposingOpeningLine: openingSameBook?.total?.line ?? null,
    openingObservedAt: openingSameBook?.total ? openingSameBook.observedAt : null,
    priceHistory: sameBookHistory.flatMap((observation) => observation.total ? [{
      american: totalOver ? observation.total.overPrice : observation.total.underPrice,
      line: observation.total.line,
      observedAt: observation.observedAt,
      sportsbook: observation.sportsbook,
    }] : []),
    opposingPriceHistory: sameBookHistory.flatMap((observation) => observation.total ? [{
      american: totalOver ? observation.total.underPrice : observation.total.overPrice,
      line: observation.total.line,
      observedAt: observation.observedAt,
      sportsbook: observation.sportsbook,
    }] : []),
    quickRead: regular
      ? seasonPhase === "preseason"
        ? `The Week 1 total ensemble is rehearsing on this preseason matchup and projects ${projection.projectedTotal.toFixed(1)} points against ${current.total.line.toFixed(1)} at ${formatBook(current.sportsbook)}. A separate phase comparison prevents the regular scoring baseline from automatically grading every low preseason total Over.`
        : `The regular-season total ensemble projects ${projection.projectedTotal.toFixed(1)} points against ${current.total.line.toFixed(1)} at ${formatBook(current.sportsbook)}. It remains a forward-validation forecast.`
      : `The fitted preseason total model projects ${projection.projectedTotal.toFixed(1)} points against ${current.total.line.toFixed(1)} at ${formatBook(current.sportsbook)}. The projection is genuine; its market value is not yet proven.`,
    why: regular
      ? marketReferenceRuntime
        ? "The total starts at the no-vig market reference and applies only the historically accepted, capped quarterback/player-value residual. Current depth-chart identity and snap-weighted injury importance are both checksum-backed."
        : "The total head combines opponent-adjusted pace, success, explosiveness, quarterback state, injuries and weather/venue context with a conservative current-market anchor."
      : "The preseason total ensemble was selected with expanding 2022–2024 predictions and then evaluated on the separate 2025 preseason (8.2-point total MAE). No sportsbook line creates the projection.",
    risk: regular
      ? marketReferenceRuntime
        ? "The accepted adjustment is deliberately small and is still shadow-only. Weather, final availability, and the locked sportsbook price must be refreshed before kickoff."
        : seasonPhase === "preseason"
        ? "The regular-season total model does not know preseason playing time. A total must agree with the phase comparison and clear exact-price EV to earn a dry-run Lean; no preseason result is tracked."
        : "The 2025 total holdout was 10.45 MAE versus 10.39 for the closing total. Weather and final Week 1 availability are not known at this early snapshot, so no total can be graded."
      : "Comparable historical preseason odds and participation plans are unavailable, so a strong total signal can reach Watchlist but cannot become an actionable Lean or Best Angle.",
    keyStats: regular ? [
      { label: "Projected total vs market", awayValue: null, homeValue: `${projection.projectedTotal.toFixed(1)} model · ${current.total.line.toFixed(1)} market`, source: "computed" },
      ...(marketReferenceRuntime
        ? [
            { label: "Starting quarterback", awayValue: regular.awayStartingQuarterback ?? "Unconfirmed", homeValue: regular.homeStartingQuarterback ?? "Unconfirmed", source: "feature_snapshot" as const },
            { label: "Snap-weighted injury burden", awayValue: regular.awayTeamContext.injuryBurden.toFixed(2), homeValue: regular.homeTeamContext.injuryBurden.toFixed(2), source: "feature_snapshot" as const },
          ]
        : [
            { label: "Estimated offensive plays", awayValue: regular.awayTeamContext.estimatedPlays.toFixed(1), homeValue: regular.homeTeamContext.estimatedPlays.toFixed(1), source: "feature_snapshot" as const },
            { label: "Opponent-adjusted explosive-play rate", awayValue: pct1(regular.awayTeamContext.opponentAdjustedExplosivePlayRate), homeValue: pct1(regular.homeTeamContext.opponentAdjustedExplosivePlayRate), source: "feature_snapshot" as const },
          ]),
    ] : [
      { label: "Shadow total vs current line", awayValue: null, homeValue: `${projection.projectedTotal.toFixed(1)} model · ${current.total.line.toFixed(1)} market`, source: "computed" },
      { label: "Avg game total · actual L10", awayValue: projection.awayRecent.averageGameTotal.toFixed(1), homeValue: projection.homeRecent.averageGameTotal.toFixed(1), source: "feature_snapshot" },
      { label: "Avg points scored · actual L10", awayValue: projection.awayRecent.averagePointsFor.toFixed(1), homeValue: projection.homeRecent.averagePointsFor.toFixed(1), source: "feature_snapshot" },
    ],
    projectedTotal: projection.projectedTotal,
    phaseComparisonProbability: phaseComparisonProjection
      ? totalOver
        ? phaseComparisonProjection.overProbability
        : 1 - phaseComparisonProjection.overProbability
      : undefined,
    verifiedPriceObservations: sameBookHistory.length,
    availabilitySnapshotPresent,
    weatherSnapshotPresent,
    consensusSplit: consensusSplits?.total ?? null,
  });

  const selectedSpreadLine = spreadHome ? current.spread.homeLine : current.spread.awayLine;
  const spread = buildMarket({
    seasonPhase,
    modelFamily,
    slot: "first_inning",
    pick: `${spreadHome ? game.home.abbreviation : game.away.abbreviation} ${spreadLabel(selectedSpreadLine)}`,
    opposingSide: spreadHome ? "away" : "home",
    opposingLabel: `${spreadHome ? game.away.abbreviation : game.home.abbreviation} ${spreadLabel(spreadHome ? current.spread.awayLine : current.spread.homeLine)}`,
    selectedSide: spreadHome ? "home" : "away",
    modelProbability: spreadHome ? homeCoverProbability : 1 - homeCoverProbability,
    marketProbability: spreadHome ? spreadFair.first : spreadFair.second,
    currentPrice: spreadHome ? current.spread.homePrice : current.spread.awayPrice,
    opposingCurrentPrice: spreadHome ? current.spread.awayPrice : current.spread.homePrice,
    currentLine: selectedSpreadLine,
    opposingCurrentLine: spreadHome ? current.spread.awayLine : current.spread.homeLine,
    sportsbook: current.sportsbook,
    observedAt: current.observedAt,
    openingPrice: openingSameBook?.spread ? spreadHome ? openingSameBook.spread.homePrice : openingSameBook.spread.awayPrice : null,
    opposingOpeningPrice: openingSameBook?.spread ? spreadHome ? openingSameBook.spread.awayPrice : openingSameBook.spread.homePrice : null,
    openingLine: openingSameBook?.spread ? spreadHome ? openingSameBook.spread.homeLine : openingSameBook.spread.awayLine : null,
    opposingOpeningLine: openingSameBook?.spread ? spreadHome ? openingSameBook.spread.awayLine : openingSameBook.spread.homeLine : null,
    openingObservedAt: openingSameBook?.spread ? openingSameBook.observedAt : null,
    priceHistory: sameBookHistory.flatMap((observation) => observation.spread ? [{
      american: spreadHome ? observation.spread.homePrice : observation.spread.awayPrice,
      line: spreadHome ? observation.spread.homeLine : observation.spread.awayLine,
      observedAt: observation.observedAt,
      sportsbook: observation.sportsbook,
    }] : []),
    opposingPriceHistory: sameBookHistory.flatMap((observation) => observation.spread ? [{
      american: spreadHome ? observation.spread.awayPrice : observation.spread.homePrice,
      line: spreadHome ? observation.spread.awayLine : observation.spread.homeLine,
      observedAt: observation.observedAt,
      sportsbook: observation.sportsbook,
    }] : []),
    quickRead: regular
      ? marketReferenceRuntime
        ? `The accepted side model stays at ${game.home.abbreviation} ${spreadLabel(current.spread.homeLine)} because no independent margin correction cleared the historical market gate. That is an evidence-backed reference prediction, not a fabricated edge.`
        : seasonPhase === "preseason"
        ? `The Week 1 independent model made ${projectedResultLabel(game, regular.independentProjectedHomeMargin ?? projection.projectedHomeMargin)} before the same conservative market blend intended for regular season; the rehearsal projection is ${projectedResultLabel(game, projection.projectedHomeMargin)} against ${game.home.abbreviation} ${spreadLabel(current.spread.homeLine)}.`
        : `The independent model made ${projectedResultLabel(game, regular.independentProjectedHomeMargin ?? projection.projectedHomeMargin)} before the conservative market blend; the final projection is ${projectedResultLabel(game, projection.projectedHomeMargin)} against ${game.home.abbreviation} ${spreadLabel(current.spread.homeLine)}.`
      : `The preseason model projects ${projectedResultLabel(game, projection.projectedHomeMargin)} versus ${game.home.abbreviation} ${spreadLabel(current.spread.homeLine)}. The exact-line probability uses the model’s expanding-window preseason error distribution.`,
    why: regular
      ? marketReferenceRuntime
        ? "The spread probability is the no-vig paired price at the displayed sportsbook. Quarterback and team context remain visible, but they do not move a side until a challenger beats the reference chronologically."
        : "Spread probability is evaluated at this exact line using expanding-window regular-season residuals. The market changes the final forecast only through the frozen 30% independent blend selected before the 2025 holdout."
      : "The margin ensemble was fitted only on real preseason outcomes and prior-season team state; today’s line is used to evaluate the forecast, not to create it.",
    risk: regular
      ? marketReferenceRuntime
        ? "A market-reference side is useful for pricing and movement context, but it is not an independent betting advantage. Official grades remain gated on 2026 locked evidence."
        : seasonPhase === "preseason"
        ? "The spread uses the regular-season probability head, while the phase comparison limits rotation-driven overconfidence. A qualified Lean remains a local, untracked rehearsal grade."
        : "The 2025 spread probabilities were calibrated but produced no reliable closing-price value. Forward Week 1 locks—not today’s early board—must establish whether the release earns grades."
      : "The 2025 side holdout failed the predictive gate and historical quarterback rotations are missing. Preseason spreads are capped at Caution and are never eligible for tracking.",
    keyStats: regular ? [
      { label: marketReferenceRuntime ? "Reference margin vs current spread" : "Independent margin vs current spread", awayValue: null, homeValue: `${game.home.abbreviation} ${signed(regular.referenceProjectedHomeMargin ?? regular.independentProjectedHomeMargin ?? projection.projectedHomeMargin)} model · ${spreadLabel(current.spread.homeLine)} market`, source: "computed" },
      { label: "Quarterback EPA/dropback", awayValue: signed3(regular.awayTeamContext.quarterbackEpaPerDropback), homeValue: signed3(regular.homeTeamContext.quarterbackEpaPerDropback), source: "feature_snapshot" },
      { label: "Opponent-adjusted success rate", awayValue: pct1(regular.awayTeamContext.opponentAdjustedSuccessRate), homeValue: pct1(regular.homeTeamContext.opponentAdjustedSuccessRate), source: "feature_snapshot" },
    ] : [
      { label: "Shadow margin vs current spread", awayValue: null, homeValue: `${game.home.abbreviation} ${signed(projection.projectedHomeMargin)} model · ${spreadLabel(current.spread.homeLine)} market`, source: "computed" },
      { label: "Avg scoring margin · actual L10", awayValue: signed(projection.awayRecent.averageMargin), homeValue: signed(projection.homeRecent.averageMargin), source: "feature_snapshot" },
      { label: "Recent record · actual L10", awayValue: recordLabel(projection.awayRecent), homeValue: recordLabel(projection.homeRecent), source: "feature_snapshot" },
    ],
    phaseComparisonProbability: phaseComparisonProjection
      ? spreadHome
        ? phaseComparisonProjection.homeCoverProbability
        : 1 - phaseComparisonProjection.homeCoverProbability
      : undefined,
    verifiedPriceObservations: sameBookHistory.length,
    availabilitySnapshotPresent,
    weatherSnapshotPresent,
    consensusSplit: consensusSplits?.spread ?? null,
  });

  const markets = { moneyline, total, first_inning: spread };
  const headline = strongestMarket([moneyline, total, spread]);
  const decisionLine = seasonPhase === "preseason"
    ? `Sharp-brain directions: ${moneyline.pick}, ${total.pick} ${marketNumber(current.total.line)}, ${spread.pick}. Any Lean is a local preseason dry run; preseason is never added to official tracking.`
    : `Model directions: ${moneyline.pick}, ${total.pick} ${marketNumber(current.total.line)}, ${spread.pick}. This local Week 1 board is untracked until an approved decision release is locked.`;
  return {
    id: `nfl-${game.providerGameId}`,
    sport: "nfl",
    external_id: Number(game.providerGameId),
    awayTeam: game.away.abbreviation,
    awayTeamLogo: nflLogo(game.away.abbreviation),
    homeTeam: game.home.abbreviation,
    homeTeamLogo: nflLogo(game.home.abbreviation),
    gameTime: formatKickoff(game.scheduledStart),
    gameStartAt: game.scheduledStart,
    gameStartMinutes: kickoffMinutes(game.scheduledStart),
    scheduledLockAt: new Date(Date.parse(game.scheduledStart) - 60 * 60_000).toISOString(),
    lockState: "open",
    lockedAt: null,
    updatedAt: current.observedAt,
    generatedAt: projection.generatedAt,
    holdReason: null,
    dataCompleteness: null,
    homeStarter: null,
    awayStarter: null,
    predictions: {
      ml: predictionFromMarket(moneyline),
      total: { ...predictionFromMarket(total), line: total.line },
      nrfi: predictionFromMarket(spread),
    },
    markets,
    decisionLine,
    projected: { away: projection.projectedAwayScore, home: projection.projectedHomeScore },
    sharpSignals: [],
    status: { lineupConfirmed: null, linesLocked: false, sharpSignalPending: true, marketDataLimited: consensusSplits === null },
    result: null,
    breakdown: {
      verdict: headline.verdict,
      sharpRead: {
        key: "mixed",
        sentence: priceHistory.length > 0
          ? "A verified same-book Opening-to-current price trail is available; public/sharp splits are unavailable."
          : "Current named-book prices are verified; an Opening trail and public/sharp splits are unavailable.",
      },
      modelBreakdown: `${game.away.name} at ${game.home.name}. ${decisionLine} Model release ${projection.release}.`,
    },
  };
}

function buildMarket(input: MarketBuildInput): MarketEdgeDto {
  const dryRunDecision = input.seasonPhase === "preseason" &&
    input.modelFamily === "regular_candidate" &&
    input.phaseComparisonProbability !== undefined
    ? deriveNflPreseasonDryRunDecision({
        market: input.slot === "first_inning" ? "spread" : input.slot,
        coreModelProbability: input.modelProbability,
        phaseComparisonProbability: input.phaseComparisonProbability,
        marketFairProbability: input.marketProbability,
        priceAmerican: input.currentPrice,
        verifiedPriceObservations: input.verifiedPriceObservations,
        availabilitySnapshotPresent: input.availabilitySnapshotPresent,
      })
    : null;
  const displayedProbability = dryRunDecision?.decisionProbability ?? input.modelProbability;
  const edgePp = Number(((displayedProbability - input.marketProbability) * 100).toFixed(1));
  const regularDecision = input.seasonPhase === "regular"
    ? deriveNflRegularDecision({
        market: input.slot === "first_inning" ? "spread" : input.slot,
        modelProbability: input.modelProbability,
        marketFairProbability: input.marketProbability,
        priceAmerican: input.currentPrice,
        verifiedPriceObservations: input.verifiedPriceObservations,
        availabilitySnapshotPresent: input.availabilitySnapshotPresent,
        weatherSnapshotPresent: input.weatherSnapshotPresent,
        priceObservedAt: input.observedAt,
      })
    : null;
  const preseasonGrade = input.seasonPhase === "preseason" && dryRunDecision === null
    ? deriveNflPreseasonShadowGrade({
        market: input.slot === "first_inning" ? "spread" : input.slot,
        modelFamily: input.modelFamily,
        modelProbability: input.modelProbability,
        marketProbability: input.marketProbability,
        priceAmerican: input.currentPrice,
      })
    : null;
  const grade = regularDecision?.grade ?? (dryRunDecision?.verdict === "watchlist"
    ? "model_only" as const
    : preseasonGrade?.grade ?? null);
  const verdict = regularDecision?.verdict ?? (dryRunDecision
    ? dryRunDecision.verdict === "watchlist"
      ? { key: "watchlist" as const, label: "Watchlist" }
      : { key: "no_play" as const, label: "No Play" }
    : preseasonGrade?.verdict ?? { key: "no_play" as const, label: "No Play" });
  const recommendationScore = regularDecision?.recommendationScore ?? dryRunDecision?.recommendationScore ?? preseasonGrade?.recommendationScore ?? null;
  const decisionRelease = input.modelFamily === "regular_candidate"
    ? NFL_PRESEASON_DRY_RUN_DECISION_RELEASE
    : NFL_PRESEASON_SHADOW_GRADE_RELEASE;
  const current: OddsTrailStopDto = { american: input.currentPrice, line: input.currentLine, observedAt: input.observedAt, sportsbook: input.sportsbook, source: "current_line", label: "current" };
  const opposingCurrent: OddsTrailStopDto = { american: input.opposingCurrentPrice, line: input.opposingCurrentLine, observedAt: input.observedAt, sportsbook: input.sportsbook, source: "current_line", label: "current" };
  const opening = input.openingPrice !== null && input.openingObservedAt !== null
    ? { american: input.openingPrice, line: input.openingLine, observedAt: input.openingObservedAt, sportsbook: input.sportsbook, source: "provider_opening" as const, label: "open" as const }
    : null;
  const opposingOpening = input.opposingOpeningPrice !== null && input.openingObservedAt !== null
    ? { american: input.opposingOpeningPrice, line: input.opposingOpeningLine, observedAt: input.openingObservedAt, sportsbook: input.sportsbook, source: "provider_opening" as const, label: "open" as const }
    : null;
  const historyStops = historicalStops(input.priceHistory, current, opening !== null);
  const opposingHistoryStops = historicalStops(input.opposingPriceHistory, opposingCurrent, opposingOpening !== null);
  const oddsTrail = [...(opening ? [opening] : []), ...historyStops, current];
  const opposingTrail = [...(opposingOpening ? [opposingOpening] : []), ...opposingHistoryStops, opposingCurrent];
  const previousStop = oddsTrail.length >= 2 ? oddsTrail[oddsTrail.length - 2]! : null;
  const publicSplits = consensusSplitRows(input);
  const pickedSplit = publicSplits.find((row) => row.side === input.selectedSide) ?? null;
  const consensusSection = publicSplits.length > 0 ? {
    label: "Consensus Splits" as const,
    rows: publicSplits,
    signal: null,
    lastUpdated: input.consensusSplit?.capturedAt ?? null,
  } : null;
  const marketReadCopy = opening === null
    ? historyStops.length > 0
      ? input.consensusSplit
        ? `A verified same-book ${formatBook(input.sportsbook)} trail runs from Opening through the current price. Playbook public money and ticket splits are shown separately as consensus context.`
        : `A verified same-book ${formatBook(input.sportsbook)} trail runs from Opening through the current price; public/sharp splits are unavailable.`
      : `A current two-sided ${formatBook(input.sportsbook)} price is verified. An Opening trail and public/sharp splits are unavailable, so no movement or money-read claim is made.`
    : input.consensusSplit
      ? `A provider-native opening and current ${formatBook(input.sportsbook)} pair are available. Playbook public consensus splits are shown as context and do not alter this shadow grade.`
      : `A provider-native opening and current ${formatBook(input.sportsbook)} pair are available. Public/sharp splits remain unavailable and do not affect this shadow output.`;
  return {
    pick: input.pick,
    confidence: displayedProbability,
    grade,
    signalType: null,
    marketSignal: "market_neutral",
    sharpStatus: "mixed",
    held: false,
    verdict,
    rawGrade: grade,
    rawRecScore: recommendationScore,
    capReasons: input.seasonPhase === "preseason"
      ? [
          ...(dryRunDecision?.reasons ?? preseasonGrade?.reasons ?? []),
          ...(dryRunDecision?.eligibleForWeeklyAction ? ["preseason_positive_ev_candidate"] : []),
          dryRunDecision ? "preseason_dry_run_only" : "preseason_shadow_grade_only",
          "preseason_participation_not_modeled",
        ]
      : [
          ...(regularDecision?.reasons ?? []),
          regularDecision?.actionable ? "regular_shadow_action_candidate" : "regular_price_value_gate_not_cleared",
          "regular_forward_validation_pending",
        ],
    finalGrade: grade,
    finalRecScore: recommendationScore,
    actionabilityLabel: verdict.label,
    displayReason: input.quickRead,
    guidedGuide: input.quickRead,
    guidedWatchOut: input.risk,
    whyLine: input.why,
    riskLine: input.risk,
    modelProb: displayedProbability,
    marketFairProb: input.marketProbability,
    pinnacleEvPct: regularDecision?.exactEvPct ?? dryRunDecision?.exactEvPct ?? exactExpectedValuePct(displayedProbability, input.currentPrice),
    moneyPct: pickedSplit?.moneyPct ?? null,
    betsPct: pickedSplit?.betsPct ?? null,
    publicSplits,
    priceAmerican: input.currentPrice,
    currentPriceAmerican: input.currentPrice,
    currentPriceSportsbook: input.sportsbook,
    currentPriceObservedAt: input.observedAt,
    bestAvailablePriceAmerican: null,
    bestAvailableSportsbook: null,
    bestAvailableObservedAt: null,
    gradePriceAmerican: input.currentPrice,
    fiMarketBoard: null,
    lineOpenAmerican: opening?.american ?? null,
    priceUnavailableAtLock: false,
    priceObservedAt: input.observedAt,
    priceIsStale: false,
    lineOpenObservedAt: opening?.observedAt ?? null,
    lineOpenIsStale: false,
    moneyPctObservedAt: input.consensusSplit?.capturedAt ?? null,
    moneyPctIsStale: false,
    betsPctObservedAt: input.consensusSplit?.capturedAt ?? null,
    betsPctIsStale: false,
    oddspherePostedAmerican: input.currentPrice,
    oddspherePostedAt: input.observedAt,
    oddspherePostedMatchesPick: true,
    lockedLineAmerican: null,
    lockedLineAt: null,
    oddsTrail,
    lineTrail: input.currentLine === null ? [] : oddsTrail,
    opposingOddsTrail: { side: input.opposingSide, label: input.opposingLabel, stops: opposingTrail },
    marketInterpretation: null,
    marketReadV2: null,
    marketReadV2Enabled: false,
    lastMovePrevAmerican: previousStop?.american ?? null,
    lastMoveNextAmerican: previousStop ? input.currentPrice : null,
    lastMoveAtIso: previousStop ? input.observedAt : null,
    lastMoveLinePrev: previousStop?.line ?? null,
    lastMoveLineNext: previousStop ? input.currentLine : null,
    modelTotal: input.slot === "total" ? input.projectedTotal ?? null : null,
    marketTotal: input.slot === "total" ? input.currentLine : null,
    line: input.currentLine,
    keyStats: input.keyStats,
    modelTrustPct: displayedProbability * 100,
    marketImpliedPct: input.marketProbability * 100,
    modelMarketGapPct: edgePp,
    recommendationConfidence: recommendationScore,
    recommendationDecision: {
      pick: input.pick,
      modelProbability: displayedProbability,
      marketImplied: input.marketProbability,
      edgePp,
      price: input.currentPrice,
      consensusSplits: consensusSection,
      sharpBookSplits: null,
      lineMovement: null,
      resolvedMarketRead: { status: "insufficient_data", label: "No Clear Signal", copy: marketReadCopy, tone: "gray" },
      sourceConflict: false,
      playGrade: verdict.key === "watchlist"
        ? "Watchlist"
        : verdict.key === "caution"
          ? "Caution"
          : verdict.key === "lean"
            ? "Lean"
            : verdict.key === "best_angle"
              ? "Best Angle"
              : "No Play",
      quickRead: input.quickRead,
      supportingEvidence: [input.why, ...(regularDecision?.reasons ?? dryRunDecision?.reasons ?? [])],
      riskNote: input.risk,
      reasonCodes: input.seasonPhase === "preseason"
        ? [
            "REAL_REGULAR_MODEL_PRESEASON_REHEARSAL",
            dryRunDecision ? "PRESEASON_DRY_RUN_GRADE" : "SHADOW_GRADE_ONLY",
            "HOLDOUT_GATE_FAILED",
            "PRESEASON_NOT_TRACKED",
            opening ? "PROVIDER_OPENING_CAPTURED" : historyStops.length > 0 ? "FIRST_OBSERVED_HISTORY_CAPTURED" : "MARKET_HISTORY_INCOMPLETE",
            input.consensusSplit ? "PUBLIC_CONSENSUS_SPLITS_CAPTURED" : "SPLITS_UNAVAILABLE",
          ]
        : [
            "REAL_REGULAR_MODEL",
            NFL_REGULAR_DECISION_RELEASE,
            regularDecision?.actionable ? "EXACT_PRICE_VALUE_GATE_CLEARED" : "EXACT_PRICE_VALUE_GATE_NOT_CLEARED",
            "2026_FORWARD_VALIDATION_PENDING",
            input.consensusSplit ? "PUBLIC_CONSENSUS_SPLITS_CAPTURED_CONTEXT_ONLY" : "SPLITS_UNAVAILABLE",
          ],
    },
    marketSource: input.sportsbook,
    marketDataQuality: "two_sided_consensus",
    reviewFlags: input.seasonPhase === "preseason"
      ? [decisionRelease, "local_shadow_only", "preseason_not_tracked"]
      : [NFL_REGULAR_DECISION_RELEASE, "local_shadow_only", "regular_forward_validation_pending"],
    reviewActionSummary: "keep",
  };
}

function consensusSplitRows(input: MarketBuildInput): MarketEdgeDto["publicSplits"] {
  const split = input.consensusSplit;
  if (!split) return [];
  const stamp = {
    observedAt: split.capturedAt,
    freshnessCheckedAt: split.capturedAt,
    staleAfterMinutes: 360,
    isStale: false,
  };
  if (input.slot === "total") {
    return [
      { side: "over", label: "Over", moneyPct: split.overMoneyPct, betsPct: split.overBetsPct, ...stamp },
      { side: "under", label: "Under", moneyPct: split.underMoneyPct, betsPct: split.underBetsPct, ...stamp },
    ];
  }
  return [
    { side: "away", label: input.selectedSide === "away" ? input.pick.split(" ")[0]! : input.opposingLabel.split(" ")[0]!, moneyPct: split.awayMoneyPct, betsPct: split.awayBetsPct, ...stamp },
    { side: "home", label: input.selectedSide === "home" ? input.pick.split(" ")[0]! : input.opposingLabel.split(" ")[0]!, moneyPct: split.homeMoneyPct, betsPct: split.homeBetsPct, ...stamp },
  ];
}

function applyPreseasonDryRunPortfolio(games: DailyEdgeGameDto[]): DailyEdgeGameDto[] {
  const selected = selectNflPreseasonDryRunActions(games.flatMap((game) => ([
    dryRunSelectionRow(game, "moneyline", game.markets.moneyline),
    dryRunSelectionRow(game, "total", game.markets.total),
    dryRunSelectionRow(game, "spread", game.markets.first_inning),
  ])));

  return games.map((game) => {
    const moneyline = selected.has(`${game.id}:moneyline`)
      ? promotePreseasonDryRunLean(game.markets.moneyline)
      : game.markets.moneyline;
    const total = selected.has(`${game.id}:total`)
      ? promotePreseasonDryRunLean(game.markets.total)
      : game.markets.total;
    const spread = selected.has(`${game.id}:spread`)
      ? promotePreseasonDryRunLean(game.markets.first_inning)
      : game.markets.first_inning;
    const markets = { moneyline, total, first_inning: spread };
    const headline = strongestMarket([moneyline, total, spread]);
    const action = [moneyline, total, spread].find((market) => market.verdict.key === "lean");
    const decisionLine = action
      ? `${action.pick} earns a dry-run Lean after exact-price EV, cross-model agreement, availability, and weekly portfolio ranking. Preseason is never tracked.`
      : game.decisionLine;
    return {
      ...game,
      predictions: {
        ml: predictionFromMarket(moneyline),
        total: { ...predictionFromMarket(total), line: total.line },
        nrfi: predictionFromMarket(spread),
      },
      markets,
      decisionLine,
      breakdown: {
        ...game.breakdown,
        verdict: headline.verdict,
        modelBreakdown: game.breakdown.modelBreakdown
          ? `${game.breakdown.modelBreakdown} ${decisionLine}`
          : decisionLine,
      },
    };
  });
}

function dryRunSelectionRow(
  game: DailyEdgeGameDto,
  market: NflPreseasonDryRunMarket,
  edge: MarketEdgeDto,
) {
  return {
    gameId: game.id,
    market,
    exactEvPct: edge.pinnacleEvPct ?? 0,
    eligible: edge.capReasons?.includes("preseason_positive_ev_candidate") ?? false,
  };
}

function promotePreseasonDryRunLean(market: MarketEdgeDto): MarketEdgeDto {
  const exactEvPct = market.pinnacleEvPct ?? 0;
  const score = Math.round(Math.min(74, Math.max(54, 52 + exactEvPct * 1.5)));
  return {
    ...market,
    grade: "model_only",
    signalType: "model_only",
    verdict: { key: "lean", label: "Lean" },
    finalGrade: "model_only",
    finalRecScore: score,
    actionabilityLabel: "Lean",
    recommendationConfidence: score,
    capReasons: [
      ...(market.capReasons ?? []).filter((reason) => reason !== "preseason_positive_ev_candidate"),
      "preseason_dry_run_lean",
      "preseason_never_tracked",
    ],
    recommendationDecision: market.recommendationDecision
      ? {
          ...market.recommendationDecision,
          playGrade: "Lean",
          supportingEvidence: [
            ...market.recommendationDecision.supportingEvidence,
            "The priced side survived conservative cross-model shrinkage and ranked inside the weekly dry-run portfolio.",
          ],
          reasonCodes: [
            ...market.recommendationDecision.reasonCodes,
            "POSITIVE_EV_AT_CURRENT_PRICE",
            "CROSS_MODEL_AGREEMENT",
            "WEEKLY_PORTFOLIO_RANK",
            "PRESEASON_DRY_RUN_LEAN",
          ],
        }
      : undefined,
    reviewFlags: [...market.reviewFlags, "preseason_dry_run_lean_promoted"],
    reviewActionSummary: "keep",
  };
}

function exactExpectedValuePct(probability: number, priceAmerican: number): number {
  if (!Number.isFinite(probability) || !Number.isFinite(priceAmerican) || priceAmerican === 0) return 0;
  const profit = priceAmerican > 0 ? priceAmerican / 100 : 100 / Math.abs(priceAmerican);
  return Number(((probability * profit - (1 - probability)) * 100).toFixed(1));
}

function historicalStops(
  observations: TrackedPricePoint[],
  current: OddsTrailStopDto,
  hasProviderOpening: boolean,
): OddsTrailStopDto[] {
  const currentTime = Date.parse(current.observedAt ?? "");
  const prior = observations
    .filter((observation) => {
      const observedTime = Date.parse(observation.observedAt);
      return Number.isFinite(observedTime) && (!Number.isFinite(currentTime) || observedTime < currentTime);
    })
    .sort((first, second) => Date.parse(first.observedAt) - Date.parse(second.observedAt))
    .filter((observation, index, rows) => index === 0 || observation.observedAt !== rows[index - 1]!.observedAt);
  return prior.map((observation, index) => ({
    american: observation.american,
    line: observation.line,
    observedAt: observation.observedAt,
    sportsbook: observation.sportsbook,
    source: "line_history",
    label: !hasProviderOpening && index === 0 ? "first" : "move",
  }));
}

function strongestMarket(markets: MarketEdgeDto[]): MarketEdgeDto {
  const rank: Record<string, number> = { best_angle: 5, lean: 4, watchlist: 3, caution: 2, no_play: 1 };
  return markets.reduce((best, candidate) =>
    (rank[candidate.verdict.key] ?? 0) > (rank[best.verdict.key] ?? 0) ? candidate : best,
  );
}

function predictionFromMarket(market: MarketEdgeDto): DailyEdgePredictionDto {
  return { pick: market.pick, confidence: market.confidence, sharpStatus: market.sharpStatus, grade: market.grade, signalType: market.signalType, marketSignal: market.marketSignal };
}

function fairPair(firstAmerican: number, secondAmerican: number): { first: number; second: number } {
  const firstRaw = americanToImpliedProbability(firstAmerican);
  const secondRaw = americanToImpliedProbability(secondAmerican);
  const total = firstRaw + secondRaw;
  return { first: firstRaw / total, second: secondRaw / total };
}

function recordLabel(summary: NflLocalShadowProjection["homeRecent"]): string {
  return summary.ties > 0 ? `${summary.wins}-${summary.losses}-${summary.ties}` : `${summary.wins}-${summary.losses}`;
}

function projectedResultLabel(game: NflPreviewGame, projectedHomeMargin: number): string {
  return projectedHomeMargin >= 0
    ? `${game.home.abbreviation} by ${Math.abs(projectedHomeMargin).toFixed(1)}`
    : `${game.away.abbreviation} by ${Math.abs(projectedHomeMargin).toFixed(1)}`;
}

function signed(value: number): string { return `${value > 0 ? "+" : ""}${value.toFixed(1)}`; }
function signed3(value: number): string { return `${value > 0 ? "+" : ""}${value.toFixed(3)}`; }
function pct1(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function spreadLabel(value: number): string { return Math.abs(value) < 0.001 ? "PK" : signed(value); }
function marketNumber(value: number): string { return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1); }

function formatBook(value: string): string {
  const names: Record<string, string> = { fanduel: "FanDuel", draftkings: "DraftKings", caesars: "Caesars", betmgm: "BetMGM", fanatics: "Fanatics", betrivers: "BetRivers" };
  return names[value.toLowerCase()] ?? value;
}

function nflLogo(abbreviation: string): string {
  const normalized = abbreviation.toUpperCase() === "WAS" ? "wsh" : abbreviation.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${normalized}.png`;
}

function formatKickoff(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function kickoffMinutes(timestamp: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
  const value = (type: "hour" | "minute") => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

function localDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}
