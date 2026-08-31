import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "../app/lab/lib/labTypes";
import { readFileSync } from "node:fs";
import {
  buildDailyEdgeReaderUrl,
  primaryDailyEdgeMarket,
  resolveInitialDailyEdgeReaderSelection,
} from "../app/lab/lib/dailyEdgeReaderState";
import {
  AVAILABLE_DAILY_EDGE_SPORTS,
  DAILY_EDGE_SPORT_AVAILABILITY,
  DAILY_EDGE_SPORTS,
  DAILY_EDGE_TOP_LEVEL_SPORT_KEYS,
} from "../app/lab/lib/dailyEdgeSports";
import { isDailyEdgeExperiencePreviewAvailable } from "../lib/config/dailyEdgeExperience";
import { __WNBA_AVAILABILITY_TEST__ } from "../lib/services/wnba/espnWnbaAvailability";
import { __MLB_AVAILABILITY_TEST__ } from "../lib/services/mlb/playbookMlbAvailability";
import { parseDailyEdgeAvailabilityMatchup } from "../lib/services/dailyEdge/availabilityRequest";
import { pitcherFirstInningPoint } from "../app/lab/lib/dailyEdgeFirstInningHistory";
import {
  DAILY_EDGE_WEEKLY_READER_LIFECYCLE_RELEASE,
  filterWeeklyReaderSnapshot,
  weeklyReaderGameIsVisible,
} from "../lib/services/dailyEdge/weeklyReaderLifecycle";
import {
  resolveFirstInningMarketPulseMovement,
  resolvePointLineMarketPulseMovement,
} from "../app/lab/lib/dailyEdgeMarketPulseMovement";
import { resolveDailyEdgeCurrentOnlyMovement } from "../app/lab/lib/dailyEdgeCurrentOnlyMovement";
import { marketSplitSectionIsStale } from "../app/lab/lib/dailyEdgeSplitFreshness";
import {
  buildDailyEdgeSportSwitchDestination,
  dailyEdgeSportDestinationIsCurrent,
} from "../app/lab/lib/dailyEdgeSportSwitch";
import { createSportTabActivationGuard } from "../app/lab/lib/sportTabActivation";
import {
  DAILY_EDGE_MEMBER_PRESENTATION_RELEASE_ID,
  dailyEdgeHeldGuide,
  dailyEdgeHeldRisk,
  dailyEdgeOperationalNoPlayReason,
  dailyEdgePresentationVerdict,
  presentDailyEdgeOperationalNoPlay,
} from "../app/lab/lib/dailyEdgeMarketPresentation";
import {
  buildDailyEdgeMemberPresentation,
  finalizeDailyEdgeResponseCoherence,
} from "../app/lab/lib/dailyEdgeResponseCoherence";
import {
  DAILY_EDGE_FORECAST_UNAVAILABLE_LABEL,
  DAILY_EDGE_SPREAD_UNAVAILABLE_LABEL,
  DAILY_EDGE_TOTAL_UNAVAILABLE_LABEL,
  dailyEdgeExactPriceSelectionLabel,
  dailyEdgeMarketPredictionProbability,
  dailyEdgeMarketPredictionProvenanceLabel,
  dailyEdgeOutcomeForecastLabel,
  isDailyEdgeOutcomeForecastHealthError,
} from "../app/lab/lib/dailyEdgeOutcomeForecast";
import {
  FOOTBALL_PRIMARY_EVIDENCE_LIMIT,
  prioritizeFootballEvidenceStats,
} from "../app/lab/lib/footballEvidencePresentation";
import {
  CFB_MEMBER_BOARD_SCOPE_RELEASE,
  resolveInitialCfbBoardScope,
  selectCfbBoardGames,
} from "../app/lab/lib/cfbBoardScope";

const snapshotPrimerSource = readFileSync(
  "scripts/operator/prime-daily-edge-experience-snapshots.ts",
  "utf8",
);
const privateNavSource = readFileSync("app/lab/components/LabAppNav.tsx", "utf8");
const liveRefreshSource = readFileSync(
  "app/lab/daily-edge/DailyEdgeLiveRefresh.tsx",
  "utf8",
);
const candidateMemberPageSource = readFileSync(
  "app/lab/daily-edge/CandidateDailyEdgePage.tsx",
  "utf8",
);
const dailyEdgeRouteSource = readFileSync(
  "app/lab/daily-edge/page.tsx",
  "utf8",
);
const dailyEdgeApiSource = readFileSync(
  "app/api/lab/daily-edge/route.ts",
  "utf8",
);
const legacyDailyEdgeSource = readFileSync(
  "app/lab/components/daily-edge/DailyEdgeShell.tsx",
  "utf8",
);
const candidateDailyEdgeSource = readFileSync(
  "app/dev/experience-preview/ActualDailyEdgePreview.tsx",
  "utf8",
);
const labTypesSource = readFileSync("app/lab/lib/labTypes.ts", "utf8");

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}`);
}

const heldPresentationMarket = {
  held: true,
  verdict: { key: "no_play", label: "No Play" },
  grade: null,
  finalGrade: null,
  rawGrade: null,
} as Pick<MarketEdgeDto, "held" | "verdict" | "grade" | "finalGrade" | "rawGrade">;
const heldPresentationBefore = JSON.stringify(heldPresentationMarket);
for (const sport of ["mlb", "wnba", "nfl", "cfb", "soccer", "nba", "nhl"] as const) {
  const presented = dailyEdgePresentationVerdict(heldPresentationMarket);
  check(
    `${sport.toUpperCase()} shared reader presents an internal hold as public No Play`,
    presented.key === "no_play" && presented.label === "No Play",
  );
}
check(
  "held presentation leaves writer verdict and grade fields byte-for-byte unchanged",
  JSON.stringify(heldPresentationMarket) === heldPresentationBefore &&
    heldPresentationMarket.verdict.key === "no_play" &&
    heldPresentationMarket.verdict.label === "No Play",
);
check(
  "operational No Play uses explicit incomplete-evidence vocabulary",
  dailyEdgeHeldGuide(heldPresentationMarket) ===
    "No Play: required evidence is incomplete, so no exact-price bet evaluation is being presented." &&
    dailyEdgeHeldRisk(heldPresentationMarket) ===
      "Starter, lineup, identity, or price evidence is still unconfirmed; internal recovery remains active.",
);
check(
  "starter exception gives a specific public No Play reason",
  dailyEdgeOperationalNoPlayReason({
    held: true,
    reviewFlags: ["missing_starter"],
    capReasons: [],
    displayReason: null,
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
  }) ===
    "No Play — starter unconfirmed; required evidence is incomplete.",
);

const dangerousHeldMarket = {
  held: true,
  pick: "NYY",
  confidence: 0.61,
  grade: "lean",
  signalType: "market_edge",
  marketSignal: "positive",
  verdict: { key: "lean", label: "Lean" },
  rawGrade: "best_signal",
  rawRecScore: 74,
  finalGrade: "lean",
  finalRecScore: 63,
  actionabilityLabel: "Lean",
  displayReason: null,
  guidedGuide: "Bet NYY",
  guidedWatchOut: "",
  whyLine: "NYY has value",
  riskLine: "",
  reviewFlags: [],
  capReasons: [],
  modelProb: 0.61,
  marketFairProb: 0.56,
  pinnacleEvPct: 7.4,
  priceAmerican: -125,
  currentPriceAmerican: -122,
  currentPriceSportsbook: "FanDuel",
  currentPriceObservedAt: "2026-08-26T15:00:00Z",
  bestAvailablePriceAmerican: -118,
  bestAvailableSportsbook: "DraftKings",
  bestAvailableObservedAt: "2026-08-26T15:00:00Z",
  gradePriceAmerican: -125,
  lineOpenAmerican: -120,
  oddsTrail: [{ american: -125, line: null, observedAt: "2026-08-26T14:00:00Z", sportsbook: "FanDuel", source: "current_line", label: "current" }],
  opposingOddsTrail: { side: "away", label: "HOU", stops: [] },
  modelTrustPct: 61,
  marketImpliedPct: 56,
  modelMarketGapPct: 5,
  recommendationConfidence: 63,
  recommendationDecision: {
    pick: "NYY",
    modelProbability: 0.61,
    marketImplied: 0.56,
    edgePp: 5,
    price: -125,
    projectedScore: { away: 3.9, home: 4.8 },
    consensusSplits: null,
    sharpBookSplits: null,
    lineMovement: "support",
    resolvedMarketRead: { status: "aligned", label: "Market Support", copy: "Support", tone: "emerald" },
    sourceConflict: false,
    playGrade: "Lean",
    quickRead: "Lean NYY",
    supportingEvidence: [],
    riskNote: "",
    reasonCodes: [],
  },
} as unknown as MarketEdgeDto;
const presentedHeldMarket = presentDailyEdgeOperationalNoPlay(
  dangerousHeldMarket,
  "missing_or_scratched_starter",
);
check(
  "starter exception preserves the outcome forecast and withholds only the evaluated bet tuple",
  presentedHeldMarket.held === true &&
    presentedHeldMarket.verdict.key === "no_play" &&
    presentedHeldMarket.verdict.label === "No Play" &&
    presentedHeldMarket.pick === "NYY" &&
    presentedHeldMarket.confidence === 0.61 &&
    presentedHeldMarket.grade === null &&
    presentedHeldMarket.rawGrade === null &&
    presentedHeldMarket.finalGrade === null &&
    presentedHeldMarket.modelProb === 0.61 &&
    presentedHeldMarket.modelTrustPct === 61 &&
    presentedHeldMarket.marketFairProb === null &&
    presentedHeldMarket.pinnacleEvPct === null &&
    presentedHeldMarket.priceAmerican === null &&
    presentedHeldMarket.gradePriceAmerican === null &&
    presentedHeldMarket.bestAvailablePriceAmerican === null &&
    presentedHeldMarket.recommendationConfidence === null &&
    presentedHeldMarket.oddsTrail?.length === 1 &&
    presentedHeldMarket.oddsTrail[0]?.sportsbook === "FanDuel" &&
    presentedHeldMarket.opposingOddsTrail?.side === "away" &&
    presentedHeldMarket.recommendationDecision?.playGrade === "No Play" &&
    presentedHeldMarket.recommendationDecision.pick === null &&
    presentedHeldMarket.recommendationDecision.modelProbability === 0.61 &&
    presentedHeldMarket.recommendationDecision.projectedScore?.home === 4.8 &&
    presentedHeldMarket.recommendationDecision.price === null &&
    presentedHeldMarket.recommendationDecision.edgePp === null,
);
check(
  "operational exception retains authentic current and movement evidence as non-evaluated context",
  presentedHeldMarket.currentPriceAmerican === -122 &&
    presentedHeldMarket.currentPriceSportsbook === "FanDuel" &&
    presentedHeldMarket.lineOpenAmerican === -120 &&
    presentedHeldMarket.displayReason ===
      "No Play — starter unconfirmed; required evidence is incomplete.",
);
const priceOnlyHeldMarket = {
  ...structuredClone(dangerousHeldMarket),
  pick: "USC",
  confidence: 0.72,
  modelProb: 0.72,
  modelTrustPct: 72,
  reviewFlags: [],
  capReasons: ["complete_exact_price_unavailable"],
  displayReason: "",
  guidedGuide: "",
  whyLine: "",
  recommendationDecision: {
    ...structuredClone(dangerousHeldMarket.recommendationDecision!),
    pick: "USC",
    modelProbability: 0.72,
    projectedScore: { away: 17.4, home: 34.2 },
  },
} as MarketEdgeDto;
const presentedPriceOnlyMarket = presentDailyEdgeOperationalNoPlay(
  priceOnlyHeldMarket,
  "exact_price_consensus_unavailable",
);
check(
  "price-only No Play follows the same forecast-preserving contract",
  presentedPriceOnlyMarket.held === true &&
    presentedPriceOnlyMarket.verdict.key === "no_play" &&
    presentedPriceOnlyMarket.pick === "USC" &&
    presentedPriceOnlyMarket.confidence === 0.72 &&
    presentedPriceOnlyMarket.modelProb === 0.72 &&
    presentedPriceOnlyMarket.modelTrustPct === 72 &&
    presentedPriceOnlyMarket.recommendationDecision?.pick === null &&
    presentedPriceOnlyMarket.recommendationDecision.modelProbability === 0.72 &&
    presentedPriceOnlyMarket.recommendationDecision.projectedScore?.home === 34.2 &&
    presentedPriceOnlyMarket.marketFairProb === null &&
    presentedPriceOnlyMarket.pinnacleEvPct === null &&
    presentedPriceOnlyMarket.priceAmerican === null &&
    presentedPriceOnlyMarket.recommendationDecision.marketImplied === null &&
    presentedPriceOnlyMarket.recommendationDecision.edgePp === null &&
    presentedPriceOnlyMarket.recommendationDecision.price === null &&
    presentedPriceOnlyMarket.actionabilityLabel === "No Play",
);
const chcTotalForecastGame = {
  id: "mlb-5059766",
  sport: "mlb",
  awayTeam: "CHC",
  homeTeam: "ARI",
  projected: { away: 3.7, home: 4.6 },
} as DailyEdgeGameDto;
const chcTotalForecastMarket = {
  ...structuredClone(dangerousHeldMarket),
  pick: null,
  modelProb: null,
  modelTotal: 8.31750489307457,
  line: 8.5,
} as MarketEdgeDto;
check(
  "CHC@ARI Total prediction surface shows the model total rather than its No Play Bet grade",
  dailyEdgeOutcomeForecastLabel({
    game: chcTotalForecastGame,
    market: chcTotalForecastMarket,
    marketKey: "total",
    sport: "mlb",
  }) === "Projected total 8.3",
);
const crossSportForecastCases = [
  { sport: "mlb", marketKey: "moneyline", expected: "ARI projected leader" },
  { sport: "wnba", marketKey: "first_inning", expected: "Projected margin ARI 0.9" },
  { sport: "nfl", marketKey: "total", expected: "Projected total 8.3" },
  { sport: "nfl", marketKey: "first_inning", expected: "Projected margin ARI 0.9" },
  { sport: "cfb", marketKey: "first_inning", expected: "Projected margin ARI 0.9" },
  { sport: "soccer", marketKey: "total", expected: "Projected total 8.3" },
  { sport: "nba", marketKey: "moneyline", expected: "ARI projected leader" },
  { sport: "nhl", marketKey: "moneyline", expected: "ARI projected leader" },
] as const;
for (const testCase of crossSportForecastCases) {
  const label = dailyEdgeOutcomeForecastLabel({
    game: { ...chcTotalForecastGame, sport: testCase.sport },
    market: chcTotalForecastMarket,
    marketKey: testCase.marketKey,
    sport: testCase.sport,
  });
  check(
    `${testCase.sport} prediction fallback remains model-native and grade-free`,
    label === testCase.expected && !/no play|held/i.test(label),
  );
}
const footballSpreadMarketPrediction = {
  ...structuredClone(chcTotalForecastMarket),
  marketPrediction: {
    status: "available",
    label: "SJSU +38.5",
    line: 38.5,
    probability: 0.818,
    source: "playbook_consensus",
    sportsbook: null,
    observedAt: "2026-08-27T19:54:15.711Z",
    freshnessCheckedAt: "2026-08-27T19:54:15.711Z",
    reason: null,
  },
} as MarketEdgeDto;
check(
  "football Spread prediction uses the coherent side and current market line instead of projected margin",
  dailyEdgeOutcomeForecastLabel({
    game: { ...chcTotalForecastGame, sport: "cfb", awayTeam: "SJSU", homeTeam: "USC" },
    market: footballSpreadMarketPrediction,
    marketKey: "first_inning",
    sport: "cfb",
  }) === "SJSU +38.5",
);
check(
  "consensus prediction line is explicitly contextual rather than an available sportsbook offer",
  dailyEdgeMarketPredictionProvenanceLabel(footballSpreadMarketPrediction) ===
    "Consensus prediction line · context only, not an available sportsbook offer",
);
const opposingFootballTotalAxes = {
  ...structuredClone(chcTotalForecastMarket),
  pick: "Under 61.5",
  line: 61.5,
  modelProb: 0.589,
  marketPrediction: {
    status: "available",
    label: "Over 61.5",
    line: 61.5,
    probability: 0.525,
    source: "model_at_context_line",
    sportsbook: null,
    observedAt: "2026-08-28T16:24:49.022Z",
    freshnessCheckedAt: "2026-08-28T16:24:49.022Z",
    reason: null,
  },
} as MarketEdgeDto;
check(
  "prediction probability stays attached to the model prediction side",
  dailyEdgeMarketPredictionProbability(opposingFootballTotalAxes) === 0.525,
);
check(
  "exact-price selection stays attached to the evaluated Bet Grade side",
  dailyEdgeExactPriceSelectionLabel({
    market: opposingFootballTotalAxes,
    marketKey: "total",
  }) === "Under 61.5" &&
    dailyEdgeOutcomeForecastLabel({
      game: { ...chcTotalForecastGame, sport: "cfb", awayTeam: "SJSU", homeTeam: "USC" },
      market: opposingFootballTotalAxes,
      marketKey: "total",
      sport: "cfb",
    }) === "Over 61.5",
);
check(
  "shared MLB first-inning labels do not gain a synthetic point-line suffix",
  dailyEdgeExactPriceSelectionLabel({
    market: { ...opposingFootballTotalAxes, pick: "NRFI", line: 0.5 },
    marketKey: "first_inning",
  }) === "NRFI",
);
const unavailableFootballSpread = {
  ...footballSpreadMarketPrediction,
  marketPrediction: {
    ...footballSpreadMarketPrediction.marketPrediction!,
    status: "market_data_unavailable",
    label: null,
    line: null,
  },
} as MarketEdgeDto;
const unavailableFootballSpreadLabel = dailyEdgeOutcomeForecastLabel({
  game: { ...chcTotalForecastGame, sport: "cfb" },
  market: unavailableFootballSpread,
  marketKey: "first_inning",
  sport: "cfb",
});
check(
  "football Spread with no current market line does not present projected margin as a line-specific prediction",
  unavailableFootballSpreadLabel === DAILY_EDGE_SPREAD_UNAVAILABLE_LABEL &&
    isDailyEdgeOutcomeForecastHealthError(unavailableFootballSpreadLabel),
);
const unavailableFootballTotalLabel = dailyEdgeOutcomeForecastLabel({
  game: { ...chcTotalForecastGame, sport: "cfb" },
  market: unavailableFootballSpread,
  marketKey: "total",
  sport: "cfb",
});
check(
  "football Total with no current market line does not present projected total as a line-specific prediction",
  unavailableFootballTotalLabel === DAILY_EDGE_TOTAL_UNAVAILABLE_LABEL &&
    isDailyEdgeOutcomeForecastHealthError(unavailableFootballTotalLabel),
);
check(
  "defensive Forecast unavailable copy is classified as a high health error",
  isDailyEdgeOutcomeForecastHealthError(DAILY_EDGE_FORECAST_UNAVAILABLE_LABEL),
);
check(
  "a missing football spread prediction fails closed instead of presenting projected margin as the bettable side",
  isDailyEdgeOutcomeForecastHealthError(DAILY_EDGE_SPREAD_UNAVAILABLE_LABEL),
);
const footballEvidenceRow = (label: string): MarketEdgeDto["keyStats"][number] => ({
  label,
  awayValue: "away",
  homeValue: "home",
  source: "computed",
});
const footballEvidenceRows = [
  "Expected points",
  "Current context · Expected quarterback",
  "Outcome-model input · EPA/play",
  "Outcome-model input · Success rate",
  "Outcome-model input · Early-down efficiency",
  "Outcome-model input · Team strength rating",
  "Outcome-model input · Prior scoring margin",
  "Outcome-model input · Line yards per carry",
  "Outcome-model input · Offensive plays per game",
  "Outcome-model input · Explosive-play rate",
  "Outcome-model input · Red-zone success rate",
  "Outcome-model input · Prior scoring profile",
  "Model scoring margin",
  "Model expected total",
  "80% margin range",
  "80% total range",
].map(footballEvidenceRow);
const footballPrimaryLabels = (marketKey: "moneyline" | "total" | "first_inning") =>
  prioritizeFootballEvidenceStats(footballEvidenceRows, marketKey)
    .slice(0, FOOTBALL_PRIMARY_EVIDENCE_LIMIT)
    .map((row) => row.label);
check(
  "football Moneyline prioritizes quarterback and efficiency inputs",
  JSON.stringify(footballPrimaryLabels("moneyline")) === JSON.stringify([
    "Current context · Expected quarterback",
    "Outcome-model input · EPA/play",
    "Outcome-model input · Success rate",
    "Outcome-model input · Early-down efficiency",
    "Outcome-model input · Team strength rating",
  ]),
);
check(
  "football Spread prioritizes margin, efficiency, and trench inputs",
  JSON.stringify(footballPrimaryLabels("first_inning")) === JSON.stringify([
    "Model scoring margin",
    "Outcome-model input · EPA/play",
    "Outcome-model input · Line yards per carry",
    "Outcome-model input · Prior scoring margin",
    "Outcome-model input · Team strength rating",
  ]),
);
check(
  "football Total prioritizes projected total, pace, explosiveness, red zone, and scoring profile",
  JSON.stringify(footballPrimaryLabels("total")) === JSON.stringify([
    "Model expected total",
    "Outcome-model input · Offensive plays per game",
    "Outcome-model input · Explosive-play rate",
    "Outcome-model input · Red-zone success rate",
    "Outcome-model input · Prior scoring profile",
  ]),
);
const evaluatedPresentationMarket = {
  held: false,
  verdict: { key: "no_play", label: "No Play" },
} as Pick<MarketEdgeDto, "held" | "verdict">;
check(
  "an evaluated No Play remains No Play",
  dailyEdgePresentationVerdict(evaluatedPresentationMarket) === evaluatedPresentationMarket.verdict,
);
check(
  "active member card, headline, market strip, and Bet Grade share the No Play helper",
  candidateDailyEdgeSource.includes("const headlineVerdict = dailyEdgePresentationVerdict(headline)") &&
    candidateDailyEdgeSource.includes("const itemVerdict = dailyEdgePresentationVerdict(item)") &&
    candidateDailyEdgeSource.includes("const verdict = dailyEdgePresentationVerdict(market)") &&
    candidateDailyEdgeSource.includes("dailyEdgeHeldGuide") &&
    candidateDailyEdgeSource.includes("dailyEdgeHeldRisk") &&
    !candidateDailyEdgeSource.includes('{ key: "held", label: "Held" }'),
);
check(
  "prediction category and card surfaces use model-native forecast labels instead of Bet Grade fallbacks",
  candidateDailyEdgeSource.includes("dailyEdgeOutcomeForecastLabel({ game, market, marketKey, sport })") &&
    candidateDailyEdgeSource.includes("dailyEdgeOutcomeForecastLabel({ game, market: item, marketKey: key, sport })") &&
    candidateDailyEdgeSource.includes("dailyEdgeMarketPredictionProbability(market)") &&
    candidateDailyEdgeSource.includes("dailyEdgeExactPriceSelectionLabel({ market, marketKey })") &&
    !candidateDailyEdgeSource.includes("displayPick(") &&
    !candidateDailyEdgeSource.includes('market.pick ?? "No Play"') &&
    !candidateDailyEdgeSource.includes('label="Score projection" value="No Play"') &&
    !candidateDailyEdgeSource.includes('label="Outcome confidence" value="No Play"'),
);
check(
  "member Daily Edge filter contract is owned by the active candidate renderer, not the legacy shell",
  candidateMemberPageSource.includes(
    'import ActualDailyEdgePreview from "@/app/dev/experience-preview/ActualDailyEdgePreview"',
  ) &&
    !candidateDailyEdgeSource.includes('{ key: "held", label: "Held" }') &&
    candidateDailyEdgeSource.includes('{ key: "no_play", label: "No Play" }'),
);
check(
  "CFB member cadence copy matches six-hour beyond 48 hours, hourly inside 48 hours, and event-triggered T-60 behavior",
  (candidateMemberPageSource.match(/six-hour beyond 48h · hourly inside 48h · T-60 lock/g) ?? []).length === 2 &&
    !candidateMemberPageSource.includes("CFB · Opening Week · evidence temporarily unavailable\",\n                previousHref: null,\n                nextHref: null,\n                displayGameCount: 0,\n                asOf: snapshot.as_of,\n                cadenceLabel: \"six-hour early evidence · hourly inside 48h · 15-minute T-60 checks"),
);

const countFixture = {
  as_of: "2026-08-26T15:00:00Z",
  sport: "mlb",
  games: [{ markets: {
    moneyline: { held: true, verdict: { key: "no_play", label: "No Play" } },
    total: { held: false, verdict: { key: "lean", label: "Lean" } },
    first_inning: { held: false, verdict: { key: "no_play", label: "No Play" } },
  } }],
} as unknown as DailyEdgeResponse;
countFixture.memberPresentation = buildDailyEdgeMemberPresentation(countFixture);
check(
  "member counts exclude operational exceptions from evaluated grades",
  countFixture.memberPresentation?.releaseId === DAILY_EDGE_MEMBER_PRESENTATION_RELEASE_ID &&
    countFixture.memberPresentation.counts.totalMarkets === 3 &&
    countFixture.memberPresentation.counts.evaluatedMarkets === 2 &&
    countFixture.memberPresentation.counts.operationalExceptions === 1 &&
    countFixture.memberPresentation.counts.evaluatedByVerdict.no_play === 1 &&
    countFixture.memberPresentation.counts.publicNoPlayMarkets === 2,
);

const heldResponseFixture = {
  as_of: "2026-08-26T15:00:00Z",
  date: "2026-08-26",
  sport: "mlb",
  games: [{
    id: "mlb-5059773",
    external_id: 5059773,
    awayTeam: "HOU",
    homeTeam: "NYY",
    projected: { away: 3.9, home: 4.8 },
    lockState: "open",
    lockedAt: null,
    holdReason: "missing_or_scratched_starter",
    markets: {
      moneyline: structuredClone(dangerousHeldMarket),
      total: structuredClone(dangerousHeldMarket),
      first_inning: structuredClone(dangerousHeldMarket),
    },
  }],
} as unknown as DailyEdgeResponse;
finalizeDailyEdgeResponseCoherence(heldResponseFixture);
check(
  "response finalizer maps HOU@NYY to No Play while preserving its outcome forecast",
  Object.values(heldResponseFixture.games[0]!.markets).every((market) =>
    market.held === true &&
    market.verdict.key === "no_play" &&
    market.actionabilityLabel === "No Play" &&
    market.pick === "NYY" &&
    market.modelProb === 0.61 &&
    market.recommendationDecision?.pick === null &&
    market.recommendationDecision?.modelProbability === 0.61 &&
    market.priceAmerican === null &&
    market.displayReason === "No Play — starter unconfirmed; required evidence is incomplete."
  ) &&
    heldResponseFixture.games[0]!.projected.away === 3.9 &&
    heldResponseFixture.games[0]!.projected.home === 4.8 &&
    heldResponseFixture.memberPresentation?.counts.operationalExceptions === 3 &&
    heldResponseFixture.memberPresentation.counts.publicNoPlayMarkets === 3 &&
    heldResponseFixture.memberPresentation.counts.evaluatedMarkets === 0,
);

for (const sport of ["mlb", "wnba", "nfl", "cfb", "soccer", "nba", "nhl"] as const) {
  const market = structuredClone(dangerousHeldMarket) as MarketEdgeDto;
  const response = {
    as_of: "2026-08-26T15:00:00Z",
    date: "2026-08-26",
    sport,
    games: [{
      id: `${sport}-forecast-grade-contract`,
      awayTeam: "AWAY",
      homeTeam: "HOME",
      projected: { away: 21.4, home: 24.7 },
      holdReason: "model_input_incomplete",
      markets: {
        moneyline: market,
        total: structuredClone(market),
        first_inning: structuredClone(market),
      },
    }],
  } as unknown as DailyEdgeResponse;
  finalizeDailyEdgeResponseCoherence(response);
  check(
    `${sport} operational No Play preserves prediction and strips the evaluated bet tuple`,
    response.games[0]!.projected.away === 21.4 &&
      response.games[0]!.projected.home === 24.7 &&
      Object.values(response.games[0]!.markets).every((presented) =>
        presented.held === true &&
        presented.verdict.key === "no_play" &&
        presented.pick === "NYY" &&
        presented.modelProb === 0.61 &&
        presented.recommendationDecision?.pick === null &&
        presented.recommendationDecision?.modelProbability === 0.61 &&
        presented.recommendationDecision?.projectedScore?.home === 4.8 &&
        presented.priceAmerican === null &&
        presented.marketFairProb === null &&
        presented.pinnacleEvPct === null &&
        presented.actionabilityLabel === "No Play"
      ),
  );
}

function game(
  id: string,
  grades: [string, string, string],
): DailyEdgeGameDto {
  const market = (key: string) => ({ verdict: { key } });
  return {
    id,
    markets: {
      moneyline: market(grades[0]),
      total: market(grades[1]),
      first_inning: market(grades[2]),
    },
  } as unknown as DailyEdgeGameDto;
}

console.log("\n━━━ First-inning history identity ━━━");
check(
  "an away starter's runs allowed follow the opponent's first-inning score",
  pitcherFirstInningPoint({
    game_date: "2026-08-01",
    away_pitcher_id: 42,
    home_pitcher_id: 7,
    inning_scores: { away: [0], home: [2] },
  }, 42)?.runsAllowed === 2,
);
check(
  "the same pitcher is retained when a later start is at home",
  pitcherFirstInningPoint({
    game_date: "2026-08-06",
    away_pitcher_id: 7,
    home_pitcher_id: 42,
    inning_scores: { away: [1], home: [0] },
  }, 42)?.runsAllowed === 1,
);

console.log("\n━━━ Daily Edge experience gate ━━━");
check(
  "local development is available without a flag",
  isDailyEdgeExperiencePreviewAvailable({ NODE_ENV: "development" }),
);
check(
  "production mode fails closed without a flag",
  !isDailyEdgeExperiencePreviewAvailable({ NODE_ENV: "production" }),
);
check(
  "production mode opens only with the explicit server flag",
  isDailyEdgeExperiencePreviewAvailable({
    NODE_ENV: "production",
    DAILY_EDGE_EXPERIENCE_PREVIEW_ENABLED: "true",
  }),
);
check(
  "candidate slate cards reserve a consistent row for Play Grade and time",
  candidateDailyEdgeSource.includes('compactSoccer ? "grid gap-2" : "grid gap-3"') &&
    candidateDailyEdgeSource.includes('compactSoccer ? "min-h-6" : "min-h-8"') &&
    !candidateDailyEdgeSource.includes('className="flex flex-wrap items-center justify-between gap-3">\n          <div className="flex min-w-0 items-center gap-2.5"'),
);
check(
  "Daily Edge labels outcome confidence separately from the exact-price Bet grade",
  candidateDailyEdgeSource.includes("Outcome confidence") &&
    candidateDailyEdgeSource.includes(">Bet grade</p>") &&
    candidateDailyEdgeSource.includes("Bet grade · exact-price decision") &&
    candidateDailyEdgeSource.includes("Exact-price selected-side probability") &&
    candidateDailyEdgeSource.includes("Price-calibrated bet probability") &&
    !candidateDailyEdgeSource.includes(">Play grade</p>"),
);
check(
  "the shared reader explains that confidence cannot silently override price-sensitive grading",
  candidateDailyEdgeSource.includes("Outcome confidence is shown separately and does not override the Bet grade") &&
    candidateDailyEdgeSource.includes("neither is a guarantee or automatic parlay recommendation") &&
    candidateDailyEdgeSource.includes("recommendation evaluated at"),
);
check(
  "truth-like flag values do not accidentally open production",
  !isDailyEdgeExperiencePreviewAvailable({
    NODE_ENV: "production",
    DAILY_EDGE_EXPERIENCE_PREVIEW_ENABLED: "1",
  }),
);
check(
  "the private candidate switch also makes its underlying preview route available",
  isDailyEdgeExperiencePreviewAvailable({
    NODE_ENV: "production",
    DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED: "true",
  }),
);
check(
  "cutover snapshot priming is dry-run by default and reuses the authoritative writer",
  snapshotPrimerSource.includes('process.argv.includes("--apply")') &&
    snapshotPrimerSource.includes('url.searchParams.set("snapshotBypass", "true")') &&
    snapshotPrimerSource.includes("refreshDailyEdgeResponseSnapshot") &&
    snapshotPrimerSource.includes("No snapshots were written"),
);
check(
  "cutover validation blocks wrong WNBA logos, mixed-book trails, and unsupported sharp sections",
  snapshotPrimerSource.includes('/teamlogos/wnba/') &&
    snapshotPrimerSource.includes("movement trail mixes sportsbooks") &&
    snapshotPrimerSource.includes("must not render unsupported sharp-book splits"),
);
check(
  "cutover validation runs the full MLB member tuple coherence audit",
  snapshotPrimerSource.includes("auditDailyEdgeResponseCoherence") &&
    snapshotPrimerSource.includes("violations.push(...auditDailyEdgeResponseCoherence(body)"),
);
check(
  "private Player Props navigation prefers the real read-only snapshot over fixture data",
  privateNavSource.includes('{ href: "/dev/mlb-props-preview", label: "Player Props"') &&
    !privateNavSource.includes('{ href: "/dev/mlb-props-preview?source=fixture", label: "Player Props"'),
);
check(
  "member Daily Edge refreshes while open and recovers on focus, reconnect, and back-forward restore",
  candidateMemberPageSource.includes("<DailyEdgeLiveRefresh />") &&
    liveRefreshSource.includes("router.refresh()") &&
    liveRefreshSource.includes('document.addEventListener("visibilitychange"') &&
    liveRefreshSource.includes('window.addEventListener("focus"') &&
    liveRefreshSource.includes('window.addEventListener("online"') &&
    liveRefreshSource.includes('window.addEventListener("pageshow"') &&
    liveRefreshSource.includes("window.clearInterval(interval)"),
);
check(
  "member Daily Edge is request-rendered so refreshes cannot reuse a deployment-time slate",
  dailyEdgeRouteSource.includes('import { connection } from "next/server"') &&
    dailyEdgeRouteSource.includes("await connection()") &&
    dailyEdgeRouteSource.indexOf("await connection()") <
      dailyEdgeRouteSource.indexOf("isDailyEdgeExperienceCandidateEnabled()"),
);
check(
  "source-aware loading protects current Sharp rows from the per-event history cap",
  dailyEdgeApiSource.includes("const [currentSharpResult, ...historyResults]") &&
    dailyEdgeApiSource.includes('.eq("provider", "sharpapi")') &&
    dailyEdgeApiSource.includes("[currentSharpResult, ...historyResults]"),
);

console.log("\n━━━ Reader selection contract ━━━");
const games = [
  game("game-a", ["lean", "best_angle", "no_play"]),
  game("game-b", ["watchlist", "caution", "lean"]),
];
check(
  "an exact board game and Total pill resolve to that reader state",
  JSON.stringify(resolveInitialDailyEdgeReaderSelection(games, "game-b", "total")) ===
    JSON.stringify({ gameId: "game-b", market: "total" }),
);
check(
  "an exact First Inning pill remains First Inning",
  resolveInitialDailyEdgeReaderSelection(games, "game-a", "first_inning").market ===
    "first_inning",
);
check(
  "an unknown game falls back to the first slate game",
  resolveInitialDailyEdgeReaderSelection(games, "missing", "moneyline").gameId ===
    "game-a",
);
check(
  "an invalid market fails closed to Moneyline",
  resolveInitialDailyEdgeReaderSelection(games, "game-a", "props").market ===
    "moneyline",
);
check(
  "the card headline selects the strongest graded market",
  primaryDailyEdgeMarket(games[0]) === "total",
);
check(
  "headline ranking does not mutate market priority across calls",
  primaryDailyEdgeMarket(games[1]) === "first_inning" &&
    primaryDailyEdgeMarket(games[0]) === "total",
);

console.log("\n━━━ URL-addressable reader state ━━━");
const url = buildDailyEdgeReaderUrl(
  "/dev/experience-preview",
  "?source=qa&sport=mlb",
  "wnba",
  "wnba-42",
  "first_inning",
);
const parsed = new URL(url, "http://localhost");
check("reader URL preserves unrelated QA parameters", parsed.searchParams.get("source") === "qa");
check("reader URL replaces the sport", parsed.searchParams.get("sport") === "wnba");
check("reader URL stores the exact game", parsed.searchParams.get("game") === "wnba-42");
check(
  "reader URL stores the exact market",
  parsed.searchParams.get("market") === "first_inning",
);

const nflDestination = buildDailyEdgeSportSwitchDestination({
  pathname: "/lab/daily-edge",
  currentSearch: "sport=mlb&game=mlb-1&market=total&league=epl&date=2026-08-25&fresh=1",
  nextSport: "nfl",
  explicitDestinations: { nfl: "/lab/daily-edge?sport=nfl" },
  slateDate: () => "2026-08-25",
});
check(
  "member sport switching resolves one canonical URL with no stale reader query",
  nflDestination === "/lab/daily-edge?sport=nfl",
);
check(
  "sport transition completion ignores query ordering but rejects a stale reader URL",
  dailyEdgeSportDestinationIsCurrent(
    "https://www.oddsphereai.com/lab/daily-edge?sport=soccer&league=epl",
    "/lab/daily-edge?league=epl&sport=soccer",
  ) &&
    !dailyEdgeSportDestinationIsCurrent(
      "https://www.oddsphereai.com/lab/daily-edge?sport=nfl&game=nfl-1&market=total",
      "/lab/daily-edge?sport=nfl",
    ),
);

let pointerNavigations = 0;
let backdropClosures = 0;
let pointerPropagationStopped = false;
const pointerGuard = createSportTabActivationGuard<string>();
const pointerEvent = {
  preventDefault: () => undefined,
  stopPropagation: () => { pointerPropagationStopped = true; },
};
// The pointer originates on a nested label and bubbles to its tab handler.
pointerGuard.pointerDown(pointerEvent, "nfl", () => { pointerNavigations += 1; });
if (!pointerPropagationStopped) backdropClosures += 1;
pointerGuard.click(pointerEvent, "nfl", () => { pointerNavigations += 1; });
check(
  "nested reader-tab pointer activation navigates once and cannot fall through to the modal backdrop",
  pointerNavigations === 1 && backdropClosures === 0,
);
let keyboardNavigations = 0;
createSportTabActivationGuard<string>().click(
  { stopPropagation: () => undefined },
  "cfb",
  () => { keyboardNavigations += 1; },
);
check("keyboard tab activation remains actionable", keyboardNavigations === 1);

console.log("\n━━━ Cross-surface sport readiness registry ━━━");
check(
  "member-available Daily Edge models retain Soccer competitions without a separate UCL top-level pill",
  AVAILABLE_DAILY_EDGE_SPORTS.includes("soccer") &&
    AVAILABLE_DAILY_EDGE_SPORTS.includes("ucl") &&
    DAILY_EDGE_TOP_LEVEL_SPORT_KEYS.includes("soccer") &&
    !DAILY_EDGE_TOP_LEVEL_SPORT_KEYS.includes("ucl"),
);
check(
  "the top-level Soccer model is labeled and presented as active while EPL has a live slate",
  DAILY_EDGE_SPORTS.find((definition) => definition.key === "soccer")?.label === "Soccer" &&
    DAILY_EDGE_SPORT_AVAILABILITY.soccer?.statusLabel === "Active",
);
check(
  "the shared Soccer selector owns Premier League, Champions League, and World Cup navigation",
  candidateDailyEdgeSource.includes('labelOverrides={{ soccer: "Soccer" }}') &&
    candidateDailyEdgeSource.includes('label: "Premier League"') &&
    candidateDailyEdgeSource.includes('label: "Champions League"') &&
    candidateDailyEdgeSource.includes('label: "World Cup"'),
);
check(
  "all active models lead the top-level pill bar and both football models are active",
  DAILY_EDGE_TOP_LEVEL_SPORT_KEYS.slice(0, 5).join(",") === "mlb,wnba,soccer,nfl,cfb" &&
    DAILY_EDGE_SPORT_AVAILABILITY.nfl?.isLive === true &&
    DAILY_EDGE_SPORT_AVAILABILITY.nfl?.statusLabel === "Active" &&
    DAILY_EDGE_SPORT_AVAILABILITY.cfb?.isLive === true &&
    DAILY_EDGE_SPORT_AVAILABILITY.cfb?.statusLabel === "Active",
);
check(
  "planned college basketball remains visible but unavailable",
  DAILY_EDGE_SPORTS.find((definition) => definition.key === "cbb")?.memberAvailable === false,
);

console.log("\n━━━ Weekly member-board lifecycle ━━━");
const thursdayKickoff = { gameStartAt: "2026-08-21T00:00:00.000Z" };
const fridayKickoff = { gameStartAt: "2026-08-22T00:00:00.000Z" };
check(
  "the weekly reader lifecycle is explicitly released",
  DAILY_EDGE_WEEKLY_READER_LIFECYCLE_RELEASE === "daily_edge_weekly_reader_lifecycle_2026_08_25_r3_cfb",
);
check(
  "an NFL game stays visible throughout its Eastern game date",
  weeklyReaderGameIsVisible(thursdayKickoff, "nfl", new Date("2026-08-21T03:59:59.000Z")),
);
check(
  "an NFL game rolls off when Friday begins in the East",
  !weeklyReaderGameIsVisible(thursdayKickoff, "nfl", new Date("2026-08-21T04:00:00.000Z")),
);
check(
  "a CFB game follows the same Eastern weekly rolloff contract",
  weeklyReaderGameIsVisible(thursdayKickoff, "cfb", new Date("2026-08-21T03:59:59.000Z")) &&
    !weeklyReaderGameIsVisible(thursdayKickoff, "cfb", new Date("2026-08-21T04:00:00.000Z")),
);
check(
  "the EPL reader retains its existing 2 a.m. Eastern rollover",
  weeklyReaderGameIsVisible(thursdayKickoff, "soccer", new Date("2026-08-21T05:59:59.000Z")) &&
    !weeklyReaderGameIsVisible(thursdayKickoff, "soccer", new Date("2026-08-21T06:00:00.000Z")),
);
const weeklySnapshot = {
  games: [
    { id: "nfl-thursday", ...thursdayKickoff },
    { id: "nfl-friday", ...fridayKickoff },
    { id: "nfl-legacy", gameStartAt: null },
  ],
} as unknown as import("../app/lab/lib/labTypes").DailyEdgeResponse;
const filteredWeeklySnapshot = filterWeeklyReaderSnapshot(
  weeklySnapshot,
  "nfl",
  new Date("2026-08-21T12:00:00.000Z"),
);
check(
  "filtering removes only prior-date games and fails open for legacy timestamps",
  filteredWeeklySnapshot.games.map((row) => row.id).join(",") === "nfl-friday,nfl-legacy" &&
    weeklySnapshot.games.length === 3,
);
check(
  "an explicit EPL request can never fall through to the World Cup snapshot",
  candidateMemberPageSource.includes("else if (eplRequested && eplEnabled)") &&
    candidateMemberPageSource.includes("else if (eplRequested)") &&
    candidateMemberPageSource.includes("snapshot = emptyPreviewSnapshot(sport)") &&
    candidateMemberPageSource.includes('competition === "premier_league" && eplEnabled'),
);

console.log("\n━━━ Candidate presentation truthfulness ━━━");
const nflSplitCapturedAt = "2026-08-25T15:36:00.000Z";
const nflSplitSection = {
  label: "Consensus Splits" as const,
  rows: [{
    side: "home" as const,
    label: "SEA",
    moneyPct: 60,
    betsPct: 55,
    observedAt: nflSplitCapturedAt,
    staleAfterMinutes: 360,
  }],
  signal: null,
  lastUpdated: nflSplitCapturedAt,
};
check(
  "NFL split freshness honors its six-hour early-week collection contract",
  !marketSplitSectionIsStale(nflSplitSection, Date.parse("2026-08-25T17:36:00.000Z")),
);
check(
  "NFL split freshness becomes stale after its declared collection window",
  marketSplitSectionIsStale(nflSplitSection, Date.parse("2026-08-25T21:37:00.000Z")),
);
const candidateSource = readFileSync(
  "app/dev/experience-preview/ActualDailyEdgePreview.tsx",
  "utf8",
);
const nflMemberFixtureSource = readFileSync(
  "lib/services/football/nflWeekOneHeldMemberFixture.ts",
  "utf8",
);
const footballEvidenceSource = readFileSync(
  "app/lab/lib/footballEvidencePresentation.ts",
  "utf8",
);
const sportSwitchSource = readFileSync("app/lab/lib/dailyEdgeSportSwitch.ts", "utf8");
const candidatePageSource = readFileSync(
  "app/dev/experience-preview/page.tsx",
  "utf8",
);
const availabilityRouteSource = readFileSync(
  "app/api/lab/daily-edge-availability/route.ts",
  "utf8",
);
const mlbAvailabilitySource = readFileSync(
  "lib/services/mlb/playbookMlbAvailability.ts",
  "utf8",
);
const productNavSource = readFileSync(
  "app/lab/components/LabAppNav.tsx",
  "utf8",
);
check(
  "private review navigation cannot escape into live product routes",
  productNavSource.includes("PRIVATE_REVIEW_TABS") &&
    productNavSource.includes('{ href: "/dev/mlb-props-preview", label: "Player Props"') &&
    productNavSource.includes('/dev/tracking-preview') &&
    productNavSource.includes('isPrivatePreview ? "/dev/relaunch-review"'),
);
check(
  "candidate defaults to the member warm snapshot and isolates explicit fresh contract reads",
  candidatePageSource.includes('if (freshContractRead) params.set("snapshotBypass", "true")') &&
    candidatePageSource.includes("Normal preview traffic uses the same warm read path as the member board"),
);
check(
  "normal sport switching requests the current slate instead of silently substituting a historical review date",
  sportSwitchSource.includes('params.set("date", slateDate(nextSport))') &&
    !sportSwitchSource.includes("DAILY_EDGE_REVIEW_SLATES[nextSport]") &&
    sportSwitchSource.includes('params.delete("game")') &&
    sportSwitchSource.includes('params.delete("market")'),
);
check(
  "an open mobile reader keeps the shared sport tabs actionable and routes through the same cleanup path",
  candidateSource.includes('aria-label="Reader sport switch"') &&
    candidateSource.includes("onSportChange={switchSport}") &&
    candidateSource.includes("onChange={onSportChange}") &&
    candidateSource.includes("sports={ACTIVE_DAILY_EDGE_TOP_LEVEL_SPORT_KEYS}") &&
    candidateSource.includes('density="compact"') &&
    candidateSource.includes("activateOnPointerDown") &&
    candidateSource.includes('params.delete("game")') &&
    candidateSource.includes('params.delete("market")'),
);
check(
  "desktop and mobile sport tabs share an in-app transition with bounded native recovery only",
  candidateSource.includes("router.push(destination, { scroll: false })") &&
    candidateSource.includes("DAILY_EDGE_SPORT_SWITCH_FALLBACK_MS") &&
    candidateSource.includes("dailyEdgeSportDestinationIsCurrent(window.location.href, destination)") &&
    candidateSource.includes('window.sessionStorage.setItem("daily-edge-sport-focus", next)') &&
    candidateSource.includes("setReaderOpen(false)") &&
    candidateSource.includes("setMobileSheetOpen(false)"),
);
check(
  "football weekly metadata no longer inserts a custom evidence wall above the shared reader",
  !candidateSource.includes("weeklySlate.evidence") &&
    !readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8").includes("evidence:"),
);
const sportSelectorSource = readFileSync("app/lab/components/SportSelector.tsx", "utf8");
check(
  "the compact reader selector keeps five sports simultaneously visible with tab and keyboard semantics",
  sportSelectorSource.includes('density?: "default" | "compact"') &&
    sportSelectorSource.includes('"grid w-full grid-cols-5 gap-1"') &&
    sportSelectorSource.includes('role="tab"') &&
    sportSelectorSource.includes("aria-selected={isActive}") &&
    sportSelectorSource.includes("focus-visible:ring-2 focus-visible:ring-violet-300"),
);
check(
  "live sport tabs warm their canonical route on pointer intent or keyboard focus without selecting it",
  sportSelectorSource.includes("onPrefetch?: (next: Sport) => void") &&
    sportSelectorSource.includes("onPointerEnter") &&
    sportSelectorSource.includes("onFocus") &&
    sportSelectorSource.includes("onPrefetch?.(sport)") &&
    candidateSource.includes("router.prefetch(destination)") &&
    candidateSource.includes("function prefetchSport(next: Sport)"),
);
check(
  "consensus-only markets do not render an empty sharp-book panel",
  candidateSource.includes("selectedSharp ?? (sharpAvailability === null ? null") &&
    candidateSource.includes("{displayedSharp ? <SplitSourcePanel") &&
    !candidateSource.includes('<SplitSourcePanel source="SHARP BOOK SPLITS" section={sharp}'),
);
check(
  "public consensus and sharp book split cards retain their established presentation while Circa-priority fill-ins remain display-only",
  candidateSource.includes("const sportsbook = market.sportsbookSplits ?? null") &&
    candidateSource.includes("const selectedSharp = currentSharp ?? (sportsbook?.rows.length ? sportsbook : sharp)") &&
    candidateSource.includes("const selectedSharpIsSportsbook = selectedSharp !== null && selectedSharp === sportsbook") &&
    candidateSource.includes('source="PUBLIC CONSENSUS"') &&
    candidateSource.includes('displayedSharp.label === "Sharp Book Signal" ? "SHARP SPLITS" : "SHARP BOOK SPLITS"') &&
    candidateSource.includes("Public and sharp splits remain separate signals") &&
    !candidateSource.includes('{sportsbook ? <SplitSourcePanel source="SHARP BOOK SPLITS"') &&
    !candidateSource.includes("sharpBookSplits = market.sportsbookSplits"),
);
check(
  "cross-source split language is rendered only when sharp rows exist",
  candidateSource.includes("{displayedSharp?.rows.length ? <CrossSourceSplitRead"),
);
check(
  "Daily Edge preserves the live product hierarchy with a compact selected reader by default",
  candidateSource.includes("const [readerOpen, setReaderOpen] = useState(initialReaderRequested)") &&
    candidateSource.includes("function CollapsedReader") &&
    candidateSource.includes('aria-label="Selected Edge collapsed reader"') &&
    candidateSource.includes("Compact read · click any game or market below to open the full reader.") &&
    candidateSource.includes("initialReaderRequested || !initialGame ? initialSelection.market : primaryMarket(initialGame)") &&
    candidateSource.includes('activeId={game.id}'),
);
check(
  "a URL-restored mobile reader cannot lock desktop page scrolling",
  candidateSource.includes('const phoneViewport = window.matchMedia("(max-width: 639px)")') &&
    candidateSource.includes("if (phoneViewport.matches && previousOverflow === null)") &&
    candidateSource.includes("if (!phoneViewport.matches && previousOverflow !== null)") &&
    candidateSource.includes('phoneViewport.addEventListener("change", syncBodyScrollLock)') &&
    candidateSource.includes('phoneViewport.removeEventListener("change", syncBodyScrollLock)'),
);
check(
  "candidate visibly renders authoritative lock state on board and reader surfaces",
  candidateSource.includes('import { LockBadge }') &&
    candidateSource.includes("minute lock checks") &&
    (candidateSource.match(/<LockBadge/g) ?? []).length === 4,
);
check(
  "a game, market, or expand action opens the full reader and it can collapse again",
    candidateSource.includes("setReaderOpen(true)") &&
    candidateSource.includes("function collapseReader()") &&
    candidateSource.includes('aria-label="Expand full read"') &&
    candidateSource.includes('aria-label="Collapse reader"') &&
    candidateSource.includes("onClose={collapseReader}"),
);
check(
  "intentional game-and-market review links may still open the exact reader directly",
  candidateSource.includes("const initialReaderRequested = Boolean(") &&
    candidateSource.includes("displaySnapshot.games.some((candidate) => candidate.id === requestedGameId)") &&
    candidateSource.includes("isMarketKey(requestedMarket)") &&
    candidateSource.includes("useState(initialReaderRequested)"),
);
check(
  "available offseason models remain selectable but are not presented as active today",
  ["nba", "nhl", "ucl"].every(
    (sport) =>
      DAILY_EDGE_SPORT_AVAILABILITY[sport as keyof typeof DAILY_EDGE_SPORT_AVAILABILITY]
        ?.statusLabel === "No games today",
  ) &&
    candidateSource.includes("Model available") &&
    candidateSource.includes("instead of showing games from an older date"),
);
check(
  "MLB and WNBA availability load after the core reader and stay cached independently from prediction writes",
  candidateSource.includes("/api/lab/daily-edge-availability") &&
    candidateSource.includes("controller.abort()") &&
    availabilityRouteSource.includes("loadCachedMlbAvailability") &&
    availabilityRouteSource.includes("loadCachedWnbaAvailability") &&
    availabilityRouteSource.includes("revalidate: 15 * 60"),
);
check(
  "publish-time probability is not mislabeled as the latest market price",
  candidateSource.includes("publish-time market") &&
    candidateSource.includes("Market at publish") &&
    candidateSource.includes("latest observed price is shown separately"),
);
check(
  "displayed probability gap is derived from the displayed probability pair",
  candidateSource.includes("function displayedProbabilityGap") &&
    candidateSource.includes("modelPct - market.marketImpliedPct"),
);
check(
  "mixed-time generated price/edge sentences are withheld",
  !candidateSource.includes("recommendationDecision?.supportingEvidence") &&
    !candidateSource.includes("market.recommendationDecision?.supportingEvidence"),
);
check(
  "sport-specific recent context uses goals, points, or runs",
  candidateSource.includes('const scoringNoun = sport === "soccer"') &&
    candidateSource.includes('sport === "nba" || sport === "wnba" || sport === "nfl" || sport === "cfb" || sport === "cbb" ? "points" : "runs"'),
);
check(
  "MLB candidate uses the same established ESPN logo host as the current reader",
  candidateSource.includes("https://a.espncdn.com/i/teamlogos/mlb/500/"),
);
check(
  "authoritative sport-specific logos win over overlapping MLB abbreviations",
  candidateSource.includes("const suppliedSrc = src?.trim() || null") &&
    candidateSource.includes('suppliedSrc.includes("mlbstatic.com/team-logos/")') &&
    candidateSource.includes(": suppliedSrc") &&
    !candidateSource.includes("const resolvedSrc = mlbLogoUrl(label) ?? src"),
);
check(
  "odds movement explicitly renders a named same-book trail",
  candidateSource.includes('movement.coherentTrail ? "same-book trail"') &&
    candidateSource.includes("Group by book—not by point line"),
);
check(
  "each verified movement row labels favorable and adverse direction independently",
  candidateSource.includes("function movementRowDirection") &&
    candidateSource.includes('label: "Toward pick"') &&
    candidateSource.includes('label: "Against pick"') &&
    candidateSource.includes('label: "Slight toward"') &&
    candidateSource.includes('label: "Slight against"') &&
    candidateSource.includes("magnitude < 1.25") &&
    candidateSource.includes('tone: "red"') &&
    candidateSource.includes('tone: "teal"') &&
    candidateSource.includes('tone: "amber"') &&
    candidateSource.includes("text-red-300") &&
    candidateSource.includes("text-teal-300"),
);
check(
  "different primary and tracked-book prices are labeled instead of mixed",
  candidateSource.includes("displayedBook !== null") &&
    candidateSource.includes("displayedPrice === stop.american") &&
    candidateSource.includes(".filter((group) => group.length >= 2 && group.some"),
);
check(
  "soccer movement rows stay on one sportsbook without a secondary cross-book capture",
  candidateSource.includes('movement.coherentTrail ? "same-book trail"') &&
    !candidateSource.includes("Earlier market capture") &&
    !candidateSource.includes("Different book; not counted as"),
);
check(
  "total and spread summaries preserve both point lines instead of comparing unlike prices at one line",
  candidateSource.includes("line moved from ${formatNumber(movement.openLine)}") &&
    candidateSource.includes("to ${formatNumber(movement.currentLine)}"),
);
check(
  "MLB totals retain the opposing outcome at its own verified line without using it for grading",
  dailyEdgeApiSource.includes("opposingLinesCurrent: currentLinesByGameMarket.get(`${row.id}::total`) ?? []") &&
    dailyEdgeApiSource.includes("Presentation-only opposing outcome context must not disappear") &&
    candidateSource.includes("The available opposing outcome is shown at its own verified book and line") &&
    candidateSource.includes("not a two-sided fair-price pair or a grading input"),
);
check(
  "totals and WNBA spreads render the dedicated line tracker after price movement and before market splits",
  candidateSource.includes("function CompactPointLineMovement") &&
    candidateSource.includes('const isSpread = !isTotal && market.line !== null') &&
    candidateSource.includes('/(?:^|\\s)[+-]\\d+(?:\\.\\d+)?(?:\\s|$)/.test(market.pick ?? "")') &&
    candidateSource.includes('const marketLabel = isTotal ? "Total" : "Spread"') &&
    candidateSource.indexOf("<CompactOddsMovement market={market}") < candidateSource.indexOf("<CompactPointLineMovement market={market}") &&
    candidateSource.indexOf("<CompactPointLineMovement market={market}") < candidateSource.indexOf("<DefaultSplitSummary market={market}"),
);
const wnbaSpreadPointLinePulse = resolvePointLineMarketPulseMovement({
  pick: "POR +4.5",
  marketReadV2: {
    movement: {
      firstTrackedLine: 3.5,
      firstTrackedPrice: -104,
      currentLine: 4.5,
      currentPrice: -104,
      directionRelativeToPick: "support",
      observedAt: "2026-08-23T13:23:26.920Z",
    },
  },
  oddsTrail: [
    {
      american: -104,
      line: 4.5,
      observedAt: "2026-08-23T13:23:26.920Z",
      sportsbook: "fanduel",
      source: "current_line",
      label: "current",
    },
  ],
  lineTrail: [
    {
      american: -104,
      line: 3.5,
      observedAt: "2026-08-22T18:23:14.119Z",
      sportsbook: "fanduel",
      source: "line_history",
      label: "first",
    },
    {
      american: -104,
      line: 4.5,
      observedAt: "2026-08-23T13:23:26.920Z",
      sportsbook: "fanduel",
      source: "current_line",
      label: "current",
    },
  ],
} as unknown as DailyEdgeGameDto["markets"]["first_inning"]);
check(
  "Total/Spread Market Pulse prefers a canonical same-book point-line move over a current-only price trail",
  wnbaSpreadPointLinePulse?.coherentTrail === true &&
    wnbaSpreadPointLinePulse.openLine === 3.5 &&
    wnbaSpreadPointLinePulse.currentLine === 4.5 &&
    wnbaSpreadPointLinePulse.sportsbook === "fanduel" &&
    candidateDailyEdgeSource.includes("resolveMarketPulseMovement(market)") &&
    candidateDailyEdgeSource.includes("resolveFirstInningMarketPulseMovement(market) ??") &&
    candidateDailyEdgeSource.includes("resolvePointLineMarketPulseMovement(market) ??"),
);
const nyyBosNrfiPulse = resolveFirstInningMarketPulseMovement({
  pick: "NRFI",
  fiMarketBoard: {
    line: 0.5,
    nrfiAmerican: -150,
    yrfiAmerican: 115,
    nrfiOpenAmerican: -135,
    yrfiOpenAmerican: 105,
    nrfiPreviousAmerican: -145,
    yrfiPreviousAmerican: 110,
    source: "fi_market_ok_hardrock",
  },
} as unknown as MarketEdgeDto);
check(
  "MLB FI Market Pulse uses the visible selected-side same-book board",
  nyyBosNrfiPulse?.open === -135 &&
    nyyBosNrfiPulse.previous === -145 &&
    nyyBosNrfiPulse.current === -150 &&
    nyyBosNrfiPulse.sportsbook === "hardrock" &&
    nyyBosNrfiPulse.coherentTrail === true,
);
check(
  "MLB FI Market Pulse fails closed without a named same-book opening",
  resolveFirstInningMarketPulseMovement({
    pick: "NRFI",
    fiMarketBoard: {
      line: 0.5,
      nrfiAmerican: -150,
      yrfiAmerican: 115,
      nrfiOpenAmerican: null,
      yrfiOpenAmerican: null,
      source: "fi_market_ok_hardrock",
    },
  } as unknown as MarketEdgeDto) === null,
);
check(
  "Market Pulse keeps public consensus, sharp-book splits, and price movement source-coherent",
  candidateSource.includes("function sourceCoherentMarketPulse") &&
    candidateSource.includes("canonicalMatchesVisibleTrail") &&
    candidateSource.includes("isVerifiedFirstInningPriceBoard") &&
    candidateSource.includes("canonicalLineMatchesVisibleTrail") &&
    candidateSource.includes("canonical.firstTrackedPrice === movement.open") &&
    candidateSource.includes("canonical.currentPrice === movement.current") &&
    candidateSource.includes('chip: "Split sources disagree"') &&
    candidateSource.includes("Public consensus money leans") &&
    candidateSource.includes("sharp-book split snapshot leans") &&
    candidateSource.includes("effectively flat"),
);
check(
  "stale split snapshots cannot masquerade as current sharp-money evidence",
  candidateSource.includes("function splitSectionIsStale") &&
    candidateSource.includes("Stale snapshot") &&
    candidateSource.includes("historical context—not a current sharp-money claim") &&
    candidateSource.includes("Historical cross-source read"),
);
check(
  "legacy consensus divergence is relabeled instead of being shown as sharp money",
  candidateSource.includes('if (/sharp money/i.test(rawChip))') &&
    candidateSource.includes("Consensus money split leans against our side") &&
    candidateSource.includes('rawDetail.replace(/sharp money/gi, "consensus money split")'),
);
check(
  "unverified movement fails closed instead of implying validated endpoints",
  candidateSource.includes("this snapshot does not contain a continuous same-book trail that can support a directional movement claim") &&
    !candidateSource.includes("only validated market endpoints are shown"),
);
check(
  "current-only movement keeps the stored sportsbook price and line tuple intact",
  candidateSource.includes("resolveDailyEdgeCurrentOnlyMovement") &&
    !candidateSource.includes("current: canonical?.currentPrice ?? currentDisplayedPrice(market)"),
);
const currentOnlyTotalMovement = resolveDailyEdgeCurrentOnlyMovement({
  trail: [{
    american: -108,
    line: 8.5,
    observedAt: "2026-08-25T11:06:25.686Z",
    sportsbook: "onexbet",
    source: "current_line",
    label: "current",
  }],
  displayedPrice: -108,
  displayedBook: "onexbet",
  fallbackLine: 8.5,
});
check(
  "a current-only total cannot inherit a stale writer-time line or price",
  currentOnlyTotalMovement.open === null &&
    currentOnlyTotalMovement.openLine === null &&
    currentOnlyTotalMovement.current === -108 &&
    currentOnlyTotalMovement.currentLine === 8.5 &&
    currentOnlyTotalMovement.sportsbook === "onexbet",
);
check(
  "MLB Sharp panels expose complete, provider-limited, pending, and stale states",
  dailyEdgeApiSource.includes('status: "complete"') &&
    dailyEdgeApiSource.includes('status: "provider_limited"') &&
    dailyEdgeApiSource.includes('status: "pending"') &&
    dailyEdgeApiSource.includes('status: "stale"') &&
    candidateDailyEdgeSource.includes('availabilityStatus === "provider_limited" ? "Limited"') &&
    candidateDailyEdgeSource.includes("No verified split yet") &&
    !candidateDailyEdgeSource.includes('availabilityStatus === "pending" ? "Awaiting provider data"'),
);
check(
  "first-inning reader distinguishes team results from starter-game context",
  candidateSource.includes("Starter opening frames") &&
    candidateSource.includes("not pitcher earned-run attribution"),
);
check(
  "first-inning Market Pulse uses the real two-sided FI price board alongside specialized evidence",
  candidateSource.includes('<CompactMarketPulse market={market} /><section className="rounded-xl border border-violet-400/20') &&
    candidateSource.includes("CompactFirstInningOddsMovement market={market}") &&
    candidateSource.includes('row("NRFI"') &&
    candidateSource.includes('row("YRFI"'),
);
check(
  "first-inning odds stack both sides and always expose First, Prior, and Current",
  candidateSource.includes('<div className="mt-3 flex flex-col gap-2">{row("NRFI"') &&
    candidateSource.includes('<PricePoint label="First observed"') &&
    candidateSource.includes('<PricePoint label="Prior observed"') &&
    candidateSource.includes('<PricePoint label="Current"'),
);
check(
  "legacy reader also prioritizes the vertically stacked two-sided FI board",
  legacyDailyEdgeSource.includes('<div className="flex flex-col gap-2">') &&
    legacyDailyEdgeSource.includes("{showFiBoardOddsTrail ? (") &&
    legacyDailyEdgeSource.includes(": persistedOddsTrail.length > 0 ? (") &&
    legacyDailyEdgeSource.indexOf("{showFiBoardOddsTrail ? (") <
      legacyDailyEdgeSource.indexOf(": persistedOddsTrail.length > 0 ? (") &&
    legacyDailyEdgeSource.includes('{hasYrfi && <Row label="YRFI" trail={yrfi} />}') &&
    legacyDailyEdgeSource.includes('{hasNrfi && <Row label="NRFI" trail={nrfi} />}'),
);
check(
  "finite recent-game rates use a segmented game tally instead of a continuous bar",
  candidateSource.includes('kind: "rate" | "record" | "average"') &&
    candidateSource.includes('comparison.kind === "rate"') &&
    candidateSource.includes("function SampleTally") &&
    candidateSource.includes("Each tile is one completed game") &&
    !candidateSource.includes("function StatBar"),
);
check(
  "recent-result tallies use semantic success and failure colors",
  candidateSource.includes("border-emerald-300/35 bg-emerald-400/80") &&
    candidateSource.includes("border-rose-300/30 bg-rose-500/65") &&
    candidateSource.includes("green = supports") &&
    candidateSource.includes("red = opposes"),
);
check(
  "play-grade scale inherits the active verdict color",
  candidateSource.includes("function gradeScaleColor") &&
    candidateSource.includes('key === "best_angle"') &&
    candidateSource.includes('key === "lean"') &&
    candidateSource.includes('key === "watchlist"') &&
    candidateSource.includes('key === "caution"'),
);
check(
  "recent records render actual chronological W/D/L tiles instead of text-only summaries",
  candidateSource.includes("function RecordComparison") &&
    candidateSource.includes('row.drawn ? "draw" : row.won') &&
    candidateSource.includes('hitLabel="Win" missLabel="Loss"') &&
    candidateSource.includes("Oldest → newest · green = win · amber = draw · red = loss"),
);
check(
  "recent averages use direct comparison cards with an explicit meaningful delta",
  candidateSource.includes("function AverageComparison") &&
    candidateSource.includes("Recent-game average") &&
    candidateSource.includes("difference.toFixed(1)") &&
    candidateSource.includes("is more supportive of") &&
    !candidateSource.includes("comparisonScaleMaximum") &&
    !candidateSource.includes("Same zero-based scale"),
);
check(
  "record and average comparisons use pick-contextual support cues",
  candidateSource.includes('comparison.advantage === "higher"') &&
    candidateSource.includes("comparison.supportLabel") &&
    candidateSource.includes("Challenges") &&
    candidateSource.includes("Lower is better defensively") &&
    !candidateSource.includes("Higher L10 win rate"),
);
check(
  "average comparison cards keep official team-color accents without arbitrary bar scaling",
  candidateSource.includes('style={{ backgroundColor: teamAccent(team) }}') &&
    candidateSource.includes("overflow-hidden rounded-xl border") &&
    !candidateSource.includes("comparisonTeamColors"),
);
check(
  "recent rate tiles explain their semantic colors",
  candidateSource.includes("Green = game supported") &&
    candidateSource.includes("green = supports") &&
    candidateSource.includes("red = opposes"),
);
check(
  "first-inning context pairs each team with its starter and does not duplicate complementary rate bars",
  candidateSource.includes("FirstInningEvidenceSide") &&
    candidateSource.includes("completed-game results paired with its probable starter") &&
    candidateSource.includes("Games with 1+ first-inning run") &&
    candidateSource.includes('marketKey === "first_inning" && sport === "mlb" ? null'),
);
check(
  "small first-inning samples show understandable counts and explain missing starter history",
  candidateSource.includes('`${supportingCount}/${rows.length}`') &&
    candidateSource.includes("Each tile is one completed game") &&
    candidateSource.includes("No verified recent sample") &&
    candidateSource.includes("This is a data-availability gap, not a 0% result"),
);
check(
  "first-inning result tiles preserve actual oldest-to-newest game order",
  candidateSource.includes("const chronologicalOutcomes = [...rows].reverse()") &&
    candidateSource.includes("outcomes={chronologicalOutcomes}") &&
    candidateSource.includes("Oldest → newest") &&
    candidateSource.includes("green = supports"),
);
check(
  "availability context cannot silently change the prediction",
  candidateSource.includes("It does not change the displayed OddSphere prediction, grade, or stake") &&
    candidateSource.includes("does not by itself prove causation"),
);
check(
  "MLB availability remains in the Market & Price column and fails visibly when unavailable",
  candidateSource.includes('availability ? <AvailabilityContext report={availability} market={market} /> : sport === "mlb" ? <MlbAvailabilityUnavailable />') &&
    candidateSource.includes('<IntegratedEvidence game={game} market={market} marketKey={marketKey} sport={sport} availability={availability} />') &&
    candidateSource.includes("Report temporarily unavailable") &&
    candidateSource.includes("missing report is not evidence that every player is available"),
);
check(
  "previous-day MLB reports are labeled instead of silently discarded or presented as current",
  candidateSource.includes("Previous report") &&
    candidateSource.includes("has not published a report dated for today") &&
    mlbAvailabilitySource.includes("isAcceptableReportDate"),
);
check(
  "availability uses a literal label instead of implying it caused the move",
  candidateSource.includes("Injuries &amp; Availability") &&
    candidateSource.includes("report.sourceLabel") &&
    !candidateSource.includes("What changed?"),
);
check(
  "redundant market-resolution card is not repeated after Market Pulse and splits",
  !candidateSource.includes("How OddSphere resolves the market") &&
    !candidateSource.includes("MarketResolutionPanel"),
);
check(
  "availability stays compact until the member requests player detail",
  candidateSource.includes("View {players.length} reported player") &&
    candidateSource.includes("<details className="),
);
check(
  "sports without formatted driver rows still show an honest core snapshot",
  candidateSource.includes("CoreDecisionSnapshot") &&
    candidateSource.includes("Core snapshot available"),
);
check(
  "football readers prioritize five market-specific drivers while keeping every supplied row reachable",
  candidateSource.includes("prioritizeFootballEvidenceStats") &&
    candidateSource.includes("FOOTBALL_PRIMARY_EVIDENCE_LIMIT") &&
    candidateSource.includes("const primary = orderedStats.slice(0, FOOTBALL_PRIMARY_EVIDENCE_LIMIT)") &&
    candidateSource.includes("const supporting = orderedStats.slice(FOOTBALL_PRIMARY_EVIDENCE_LIMIT)") &&
    candidateSource.includes("More supporting evidence") &&
    candidateSource.includes("supporting.map(driver)") &&
    candidateSource.includes('game.markets[key as MarketKey].keyStats'),
);
check(
  "a context-only CFB line never promises missing sportsbook odds",
  DAILY_EDGE_MEMBER_PRESENTATION_RELEASE_ID ===
    "daily_edge_member_presentation_2026_08_31_r22_cfb_public_consensus_market_input" &&
    candidateSource.includes("Sportsbook odds unavailable") &&
    candidateSource.includes("Consensus line only") &&
    candidateSource.includes("No eligible named-book American price was captured") &&
    !candidateSource.includes(">Current odds shown below</span></span> :"),
);
const cfbScopeFixture = [
  { id: "cfb-fbs", collegeFootballScope: "fbs_involved" },
  { id: "cfb-fcs", collegeFootballScope: "fcs_only" },
] as DailyEdgeGameDto[];
check(
  "CFB defaults to the FBS-involved member board without deleting Division I forecasts",
  CFB_MEMBER_BOARD_SCOPE_RELEASE === "cfb_member_board_scope_2026_08_29_r1_fbs_default" &&
    selectCfbBoardGames(cfbScopeFixture, "cfb", "fbs").map((game) => game.id).join(",") === "cfb-fbs" &&
    selectCfbBoardGames(cfbScopeFixture, "cfb", "division_i").length === 2 &&
    resolveInitialCfbBoardScope({ sport: "cfb", games: cfbScopeFixture, requestedGameId: null }) === "fbs" &&
    resolveInitialCfbBoardScope({ sport: "cfb", games: cfbScopeFixture, requestedGameId: "cfb-fcs" }) === "division_i" &&
    candidateDailyEdgeSource.includes("FBS-involved games are the member default") &&
    candidateDailyEdgeSource.includes("All Division I"),
);
check(
  "the active NFL reader discloses its line-specific calibration boundary",
  candidateSource.includes("separate line-specific calibration to Spread and Total probabilities") &&
    candidateSource.includes("so those market sides can differ from the score-centered view") &&
    nflMemberFixtureSource.includes("separately calibrated ${marketName} forecast side"),
);
check(
  "the active CFB reader presents one concise writer-owned forecast and exact-price decision",
  candidateSource.includes('game.sport === "cfb" ? "Outcome forecast"') &&
    candidateSource.includes('sport === "cfb" ? "Model"') &&
    candidateSource.includes("displayedExpectedValuePct") &&
    candidateSource.includes('sport === "cfb" ? <div className="mt-3"><VerdictBadge') &&
    !candidateSource.includes("This exact-price probability is calibrated from the same authoritative") &&
    !candidateSource.includes("the reader never overrides the stored grade"),
);
check(
  "the CFB reader keeps release-separated baseline context without exposing audit methodology",
  candidateSource.includes("Football baseline ·") &&
    candidateSource.includes("game.footballOnlyProjection") &&
    !candidateSource.includes("75% independent football mass with 25% bounded market/sharp mass") &&
    labTypesSource.includes("footballOnlyProjection?:"),
);
check(
  "football evidence labels distinguish model inputs from explanatory current context",
  footballEvidenceSource.includes("Win-probability evidence") &&
    footballEvidenceSource.includes("Spread evidence") &&
    footballEvidenceSource.includes("Total evidence") &&
    candidateSource.includes("Outcome model input") &&
    candidateSource.includes("Bet model input") &&
    candidateSource.includes("Current context") &&
    candidateSource.includes("driverEvidenceRole") &&
    candidateSource.includes('if (/^Current context\\s*·/i.test(label)) return null'),
);
check(
  "World Cup home and away tokens become team labels only in the candidate presentation",
  candidateSource.includes("normalizeCandidatePicks") &&
    candidateSource.includes('if (normalized === "home") return game.homeTeam') &&
    candidateSource.includes('if (normalized === "away") return game.awayTeam'),
);

console.log("\n━━━ Source-coherent WNBA evidence ━━━");
const wnbaAdapterSource = readFileSync(
  "lib/services/wnba/buildWnbaDailyEdgeAdapted.ts",
  "utf8",
);
const wnbaTrailSource = readFileSync(
  "lib/services/wnba/wnbaPriceTrail.ts",
  "utf8",
);
const wnbaModelWriterSource = readFileSync(
  "lib/services/wnba/runWnbaModel.ts",
  "utf8",
);
const wnbaRecordWriterSource = readFileSync(
  "lib/services/wnba/buildWnbaPredictionRecords.ts",
  "utf8",
);
check(
  "WNBA current lines and history both retain sportsbook identity",
  wnbaAdapterSource.includes('side, sportsbook, line_value, odds_american') &&
    wnbaAdapterSource.includes('side, sportsbook, line_value, odds_american, recorded_at'),
);
check(
  "WNBA directional reads require a coherent same-book trail",
  wnbaAdapterSource.includes("if (!trail?.coherent || pick === null) return null") &&
    wnbaAdapterSource.includes("coherentPriceTrail("),
);
check(
  "WNBA same-book trails terminate at the latest observation instead of looping back to the opener",
  wnbaAdapterSource.includes("selectWnbaSameBookTrail(") &&
    !wnbaAdapterSource.includes("? liveCandidates[0]"),
);
check(
  "WNBA history-only boards preserve both sides when the current lines table is temporarily empty",
  wnbaAdapterSource.includes("terminalSource: selection.terminalSource") &&
    wnbaAdapterSource.includes("opposingPriceTrail: game.pickedPrices?.opposingTotal") &&
    wnbaAdapterSource.includes("opposingPriceTrail: game.pickedPrices?.opposingSpread"),
);
check(
  "WNBA price trails stay on the current point line while total and spread line trails retain line changes",
  wnbaTrailSource.includes("history.filter((row) => closeLine(row.line_value, currentLine))") &&
    wnbaAdapterSource.includes('totalLine: coherentPriceTrail(rows, historyRows, "total"') &&
    wnbaAdapterSource.includes("totalCurrentContext.currentQuote ?? totalDecisionPrice, true") &&
    wnbaAdapterSource.includes('spreadLine: coherentPriceTrail(rows, historyRows, "spread"') &&
    wnbaAdapterSource.includes("spreadCurrentContext.currentQuote ?? spreadDecisionPrice, true") &&
    wnbaAdapterSource.includes("lineTrail: game.pickedPrices?.spreadLine"),
);
check(
  "WNBA number trackers use distinct line stops instead of repeated price polls",
  wnbaAdapterSource.includes("reduce<WnbaPriceTrailStop[]>") &&
    wnbaAdapterSource.includes("prior.line !== stop.line") &&
    wnbaAdapterSource.includes("lastMoveLinePrev: pointLineStops.length > 1"),
);
check(
  "WNBA preserves repeated observations so steady markets still have a verified prior stop",
  wnbaTrailSource.includes("prior.recorded_at === row.recorded_at") &&
    wnbaTrailSource.includes("if (rows.length >= 2) return selection"),
);
check(
  "WNBA retains current-only opposing context without calling it coherent movement",
  wnbaTrailSource.includes("currentOnlyFallback ??= selection") &&
    wnbaAdapterSource.includes("const coherent = stops.length >= 2") &&
    wnbaAdapterSource.includes('(opts.opposingPriceTrail?.stops?.length ?? 0) > 0'),
);
check(
  "WNBA authoritative writer freezes one exact decision tuple for every market",
  wnbaModelWriterSource.includes("buildWnbaDecisionTuple({") &&
    wnbaModelWriterSource.includes("decision_tuple_contract_version") &&
    wnbaModelWriterSource.includes("decision_tuples: decisionTuples") &&
    wnbaModelWriterSource.includes("observedAt: (l.fetched_at ?? l.recorded_at ?? null)"),
);
check(
  "WNBA tracking records copy the writer tuple instead of re-evaluating a later price",
  wnbaRecordWriterSource.includes("mlTuple?.evaluated_price_american") &&
    wnbaRecordWriterSource.includes("totalTuple?.evaluated_price_american") &&
    wnbaRecordWriterSource.includes("spreadTuple?.evaluated_price_american") &&
    wnbaRecordWriterSource.includes("decision_tuple: decisionTuple"),
);
check(
  "WNBA DTO keeps the grade price immutable while exposing a later current quote separately",
  wnbaAdapterSource.includes("const priceAmerican = opts.decisionTuple?.evaluated_price_american") &&
    wnbaAdapterSource.includes("currentPriceAmerican: opts.priceTrail?.currentQuote ?? priceAmerican") &&
    wnbaAdapterSource.includes("gradePriceAmerican: priceAmerican") &&
    wnbaAdapterSource.includes("currentQuoteObservedAt: terminal?.observedAt ?? null"),
);
check(
  "WNBA T-60 readers retain the locked tuple while current quotes continue independently",
  wnbaAdapterSource.includes("const lockedTuple = input.lockedRecord?.snapshot_json?.decision_tuple") &&
    wnbaAdapterSource.includes("if (isWnbaDecisionTuple(lockedTuple)) return lockedTuple") &&
    wnbaAdapterSource.includes("const currentPrice = pickedPrice(rows, market, side, currentLine)") &&
    wnbaAdapterSource.includes("currentQuoteSportsbook: currentTrail.sportsbook ?? null"),
);
check(
  "WNBA unlocked readers reuse only a compatible last-known-good v3 tuple",
  wnbaAdapterSource.includes("record.snapshot_json?.prediction_record_contract_version !== WNBA_V3_RECORD_CONTRACT_VERSION") &&
    wnbaAdapterSource.includes("return retainCompatibleWnbaDecisionTuple(candidate, input.currentDecision)") &&
    wnbaAdapterSource.includes("decisionTuples.total?.evaluated_price_american") &&
    wnbaAdapterSource.includes('decisionLineRows("total", totalSide, totalDecisionLine)'),
);

const parsedEvent = __WNBA_AVAILABILITY_TEST__.parseScoreboardEvent({
  id: "401857128",
  competitions: [{ competitors: [
    { homeAway: "home", team: { abbreviation: "NY" } },
    { homeAway: "away", team: { abbreviation: "LV" } },
  ] }],
});
check(
  "WNBA availability attaches the ESPN event to the exact matchup",
  parsedEvent?.eventId === "401857128" && parsedEvent.awayTeam === "LV" && parsedEvent.homeTeam === "NY",
);
const parsedInjuries = __WNBA_AVAILABILITY_TEST__.parseInjuryGroups([{ team: { abbreviation: "LV", displayName: "Las Vegas Aces" }, injuries: [{ status: "Out", date: "2026-08-09T14:04Z", athlete: { displayName: "A'ja Wilson", position: { abbreviation: "C" } }, details: { type: "Rest" } }] }]);
check(
  "WNBA availability preserves status, reason, position, and report time",
  parsedInjuries[0]?.players[0]?.name === "A'ja Wilson" &&
    parsedInjuries[0]?.players[0]?.status === "Out" &&
    parsedInjuries[0]?.players[0]?.detail === "Rest" &&
    parsedInjuries[0]?.players[0]?.position === "C" &&
    parsedInjuries[0]?.players[0]?.reportedAt === "2026-08-09T14:04Z",
);

const parsedMlbInjuries = __MLB_AVAILABILITY_TEST__.parsePlaybookMlbInjuries({
  reportDate: "2026-08-09",
  updatedAt: "2026-08-09T03:57:30.846Z",
  data: [{
    teamAbbr: "WAS",
    teamName: "Washington Nationals",
    players: [{ name: "James Wood", status: "Out", statusContext: "Injury", reason: "10-day injured list" }],
  }],
});
check(
  "MLB availability normalizes provider teams and preserves report freshness",
  parsedMlbInjuries?.reportDate === "2026-08-09" &&
    parsedMlbInjuries.updatedAt === "2026-08-09T03:57:30.846Z" &&
    parsedMlbInjuries.teams[0]?.abbreviation === "WSH" &&
    parsedMlbInjuries.teams[0]?.players[0]?.status === "Out" &&
    parsedMlbInjuries.teams[0]?.players[0]?.detail === "Injury · 10-day injured list",
);
check(
  "MLB availability accepts only the slate-date or immediately previous provider report",
  __MLB_AVAILABILITY_TEST__.isAcceptableReportDate("2026-08-20", "2026-08-20") &&
    __MLB_AVAILABILITY_TEST__.isAcceptableReportDate("2026-08-19", "2026-08-20") &&
    !__MLB_AVAILABILITY_TEST__.isAcceptableReportDate("2026-08-18", "2026-08-20"),
);
check(
  "MLB availability rejects an implausible all-Out provider payload",
  parsedMlbInjuries !== null &&
    !__MLB_AVAILABILITY_TEST__.hasPlausiblePlaybookReport({
      ...parsedMlbInjuries,
      teams: Array.from({ length: 2 }, (_, teamIndex) => ({
        abbreviation: teamIndex === 0 ? "CLE" : "COL",
        teamName: teamIndex === 0 ? "Cleveland Guardians" : "Colorado Rockies",
        players: Array.from({ length: 10 }, (_, playerIndex) => ({
          name: `Player ${teamIndex}-${playerIndex}`,
          status: "Out",
          detail: null,
          position: null,
          reportedAt: null,
        })),
      })),
    }),
);
const officialMlbTeam = __MLB_AVAILABILITY_TEST__.parseMlbStatsFortyManRoster("CLE", [
  { person: { id: 1, fullName: "Healthy Player" }, position: { abbreviation: "P" }, status: { code: "A", description: "Active" } },
  { person: { id: 2, fullName: "Injured Player" }, position: { abbreviation: "1B" }, status: { code: "D10", description: "Injured 10-Day" }, note: "Lower back inflammation." },
  { person: { id: 3, fullName: "Minor League Player" }, position: { abbreviation: "OF" }, status: { code: "RM", description: "Reassigned to Minors" } },
]);
check(
  "official MLB fallback includes only explicit injured-list statuses",
  officialMlbTeam?.abbreviation === "CLE" &&
    officialMlbTeam.players.length === 1 &&
    officialMlbTeam.players[0]?.name === "Injured Player" &&
    officialMlbTeam.players[0]?.detail === "Lower back inflammation.",
);
check(
  "availability endpoint accepts only bounded exact matchup tokens",
  parseDailyEdgeAvailabilityMatchup("mlb-42|WSH|PHI")?.homeTeam === "PHI" &&
    parseDailyEdgeAvailabilityMatchup("mlb-42|WSH|PHI|extra") === null &&
    parseDailyEdgeAvailabilityMatchup("../secret|WSH|PHI") === null,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
