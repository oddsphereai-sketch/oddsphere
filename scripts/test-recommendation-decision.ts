import { applySharpBookSplitSectionToDecision, buildRecommendationDecision, CURRENT_SPLIT_EVIDENCE_READER_RELEASE } from "../lib/services/recommendationDecision";
import type { MarketSplitDisplaySection } from "../lib/types/domain/RecommendationDecision";
import { applyDailyEdgeRenderedCopyFlags } from "../lib/services/dailyEdge/memberFacingCopyRenderer";
import { buildEdgeStackRows } from "../app/lab/lib/edgeStackRows";
import type { MarketEdgeDto } from "../app/lab/lib/labTypes";
import type { MarketReadV2Dto } from "../lib/types/domain/MarketIntelligenceV2";

let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else {
    fail++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function read(opts: {
  consensusMoney?: number;
  consensusBets?: number;
  sharp?: "support" | "resistance" | null;
  move?: "support" | "resistance" | "neutral";
}): MarketReadV2Dto {
  return {
    label: "Market Support",
    score: 2,
    tone: "emerald",
    explanation: "Market context.",
    copyMode: "context_only_not_pick_changing",
    exactLineEvidenceStatus: "ok",
    evidenceAsOf: "2026-06-28T16:00:00.000Z",
    generatedAt: "2026-06-28T16:00:00.000Z",
    validityStatus: "valid_directional",
    movement: {
      firstTrackedLine: null,
      firstTrackedPrice: -110,
      currentLine: null,
      currentPrice: -120,
      directionRelativeToPick: opts.move ?? "neutral",
      observedAt: "2026-06-28T16:00:00.000Z",
    },
    consensus: {
      moneyPct: opts.consensusMoney ?? null,
      betsPct: opts.consensusBets ?? null,
      booksUsed: 9,
      lineBasis: "provider_explicit",
    },
    sourceSummary: {
      priceAction: null,
      playbookConsensus: "Consensus: 66% money / 62% bets.",
      sharpApiSourceSpecific: null,
      sharpMoney: opts.sharp === "support"
        ? "Sharp Money: sharp-book price action moved with our pick."
        : opts.sharp === "resistance"
          ? "Sharp Money: sharp-book price action moved against our pick."
          : null,
    },
  };
}

const baseMarket = {
  key: "moneyline" as const,
  pick: "CWS",
  selectedSide: "away" as const,
  modelProbability: 0.58,
  marketImplied: 52,
  edgePp: 6,
  price: -110,
  playGrade: "Lean",
  quickRead: "CWS has a playable model edge.",
  riskNote: "Watch price drift.",
  publicSplits: [
    { side: "away" as const, label: "CWS", moneyPct: 66, betsPct: 62, observedAt: "2026-06-28T16:00:00.000Z" },
    { side: "home" as const, label: "KC", moneyPct: 34, betsPct: 38, observedAt: "2026-06-28T16:00:00.000Z" },
  ],
  marketReadV2Enabled: true,
};

const aligned = buildRecommendationDecision({
  sport: "mlb",
  slateDate: "2026-06-28",
  gameId: "game-1",
  homeTeam: "KC",
  awayTeam: "CWS",
  markets: [{ ...baseMarket, playGrade: "Best Angle", marketReadV2: read({ consensusMoney: 0.66, consensusBets: 0.62, sharp: "support", move: "support" }) }],
});
check("MLB both sources renders consensus", aligned.markets.moneyline?.consensusSplits?.label === "Consensus Splits");
check("MLB sharp resistance without bars renders sharp book signal", aligned.markets.moneyline?.sharpBookSplits?.label === "Sharp Book Signal");
check("Aligned market read supports Best Angle", aligned.markets.moneyline?.resolvedMarketRead.status === "aligned");

const mixed = buildRecommendationDecision({
  sport: "mlb",
  slateDate: "2026-06-28",
  gameId: "game-2",
  homeTeam: "KC",
  awayTeam: "CWS",
  markets: [{ ...baseMarket, playGrade: "Best Angle", marketReadV2: read({ consensusMoney: 0.66, consensusBets: 0.62, sharp: "resistance", move: "support" }) }],
});
check("Consensus support plus sharp resistance is mixed", mixed.markets.moneyline?.resolvedMarketRead.status === "mixed");
check("Best Angle with mixed source state is capped", mixed.markets.moneyline?.playGrade !== "Best Angle");
check("Mixed quick read names conflict", mixed.markets.moneyline?.quickRead.toLowerCase().includes("mixed market signals") === true);
check("Source conflict tracked", mixed.sourceState.sourceConflict === true);

const pressureReactionConflict = buildRecommendationDecision({
  sport: "cfb",
  slateDate: "2026-11-05",
  gameId: "professional-pressure-reaction-conflict",
  homeTeam: "USM",
  awayTeam: "JMU",
  markets: [{
    ...baseMarket,
    key: "firstInning",
    pick: "JMU -13.5",
    selectedSide: "away",
    playGrade: "Lean",
    marketReadV2: read({ consensusMoney: 0.64, consensusBets: 0.55, sharp: "support", move: "resistance" }),
    lineMovementOverride: "resistance",
  }],
});
check("Professional pressure opposed by price response is mixed",
  pressureReactionConflict.markets.firstInning?.resolvedMarketRead.status === "mixed");
check("Professional pressure/response conflict is stored",
  pressureReactionConflict.markets.firstInning?.sourceConflict === true && pressureReactionConflict.sourceState.sourceConflict === true);
check("Pressure/response copy preserves both facts",
  pressureReactionConflict.markets.firstInning?.resolvedMarketRead.copy.includes("pressure supports JMU -13.5") === true &&
  pressureReactionConflict.markets.firstInning?.resolvedMarketRead.copy.includes("price response resists") === true);

const owlsAligned = applySharpBookSplitSectionToDecision({
  sport: "mlb",
  marketKey: "moneyline",
  decision: aligned.markets.moneyline!,
  section: {
    label: "Sharp Book Splits",
    sourceBook: "circa",
    sourceObservedAt: "2026-06-28T16:01:00.000Z",
    lastUpdated: null,
    signal: null,
    rows: [
      { side: "away", label: "CWS", betsPct: 54, moneyPct: 67, isStale: false },
      { side: "home", label: "KC", betsPct: 46, moneyPct: 33, isStale: false },
    ],
  },
});
check("Owls sharp-book evidence reaches the market reader", owlsAligned.resolvedMarketRead.status === "aligned" && owlsAligned.sharpBookSplits?.sourceBook === "circa");
check("Post-decision split context preserves the writer grade", owlsAligned.playGrade === aligned.markets.moneyline!.playGrade);
check("Post-decision split context preserves the writer pick and probability", owlsAligned.pick === aligned.markets.moneyline!.pick && owlsAligned.modelProbability === aligned.markets.moneyline!.modelProbability);
const mixedEdgeRows = buildEdgeStackRows("moneyline", {
  pick: "CWS",
  pinnacleEvPct: null,
  modelProb: 0.6,
  marketFairProb: null,
  marketImpliedPct: 54,
  modelMarketGapPct: 6,
  marketDataQuality: "two_sided_consensus",
  marketSource: "consensus",
  publicSplits: baseMarket.publicSplits,
  moneyPct: 66,
  betsPct: 62,
  lineOpenAmerican: -110,
  priceAmerican: -120,
  lastMoveLinePrev: null,
  lastMoveLineNext: null,
  marketReadV2Enabled: true,
  marketReadV2: null,
  recommendationDecision: mixed.markets.moneyline,
} as unknown as MarketEdgeDto);
check("Supporting Evidence includes Consensus Splits", mixedEdgeRows.some((r) => r.label === "Consensus Splits"));
check("Supporting Evidence includes Sharp Book Signal", mixedEdgeRows.some((r) => r.label === "Sharp Book Signal"));
check("Supporting Evidence shows Mixed Market Read", mixedEdgeRows.some((r) => r.label === "Market Read" && r.evidence.includes("Mixed")));

const wnba = buildRecommendationDecision({
  sport: "wnba",
  slateDate: "2026-06-28",
  gameId: "game-3",
  homeTeam: "NY",
  awayTeam: "LV",
  markets: [{ ...baseMarket, pick: "LV", playGrade: "Lean", marketReadV2: read({ consensusMoney: 0.61, consensusBets: 0.59, sharp: null }) }],
});
check("WNBA consensus-only omits sharp book section", wnba.markets.moneyline?.sharpBookSplits === null);
check("WNBA consensus-only resolves consensus support", wnba.markets.moneyline?.resolvedMarketRead.status === "consensus_support");
check("No provider names in canonical decision", !JSON.stringify(wnba).match(/\b(Playbook|SharpAPI)\b/));

const splitSupportOddsResistance = applyDailyEdgeRenderedCopyFlags(buildRecommendationDecision({
  sport: "mlb",
  slateDate: "2026-06-28",
  gameId: "game-split-support-odds-resistance",
  homeTeam: "ATL",
  awayTeam: "STL",
  markets: [{
    ...baseMarket,
    pick: "ATL",
    selectedSide: "home",
    playGrade: "Best Angle",
    marketReadV2: read({ consensusMoney: 0.61, consensusBets: 0.57, sharp: null, move: "resistance" }),
    lineMovementOverride: "resistance",
  }],
}), { quickRead: true, marketRead: true, supportingEvidence: true, risk: false });
const splitSupportOddsResistanceText = JSON.stringify(splitSupportOddsResistance.markets.moneyline);
check("Rendered Market Read does not call odds resistance clean support", splitSupportOddsResistance.markets.moneyline?.resolvedMarketRead.label === "Mixed", splitSupportOddsResistanceText);
check("Rendered Market Read mentions odds movement against pick", splitSupportOddsResistance.markets.moneyline?.resolvedMarketRead.copy.toLowerCase().includes("odds movement is against the pick") === true, splitSupportOddsResistanceText);
check("Rendered Quick Read names odds movement friction", splitSupportOddsResistance.markets.moneyline?.quickRead.toLowerCase().includes("odds movement against the pick") === true, splitSupportOddsResistanceText);
check("Rendered Supporting Evidence names odds movement friction", splitSupportOddsResistance.markets.moneyline?.supportingEvidence.some((line) => line.toLowerCase().includes("odds movement is against the pick")) === true, splitSupportOddsResistanceText);

const wnbaSpread = applyDailyEdgeRenderedCopyFlags(buildRecommendationDecision({
  sport: "wnba",
  slateDate: "2026-06-28",
  gameId: "game-wnba-spread",
  homeTeam: "NY",
  awayTeam: "LV",
  markets: [{
    ...baseMarket,
    key: "firstInning",
    pick: "NY +6.5",
    selectedSide: "home",
    playGrade: "Watchlist",
    marketReadV2: read({ consensusMoney: 0.58, consensusBets: 0.55, sharp: null }),
  }],
}), { quickRead: true, marketRead: true, supportingEvidence: true, risk: false });
const wnbaSpreadText = JSON.stringify(wnbaSpread.markets.firstInning);
check("WNBA spread slot keeps consensus-only context", wnbaSpread.markets.firstInning?.consensusSplits !== null && wnbaSpread.markets.firstInning?.sharpBookSplits === null);
check("WNBA spread slot does not render FI copy", !wnbaSpreadText.match(/\b(FI|YRFI|NRFI|first-inning)\b/i), wnbaSpreadText);
check("WNBA spread slot does not mention missing sharp", !wnbaSpreadText.match(/\b(sharp).{0,40}\b(unavailable|missing|absent|not available)\b/i), wnbaSpreadText);

const worldCup = applyDailyEdgeRenderedCopyFlags(buildRecommendationDecision({
  sport: "soccer",
  slateDate: "2026-06-28",
  gameId: "game-wc-1",
  homeTeam: "KOR",
  awayTeam: "CZE",
  projectedScore: { away: 1.4, home: 1.1 },
  markets: [
    {
      ...baseMarket,
      key: "moneyline",
      pick: "CZE Win",
      selectedSide: null,
      modelProbability: 0.47,
      marketImplied: 42,
      edgePp: 5,
      price: 138,
      playGrade: "Lean",
      publicSplits: [],
      marketReadV2: null,
    },
    {
      ...baseMarket,
      key: "total",
      pick: "Over 2.5",
      selectedSide: "over",
      modelProbability: 0.54,
      marketImplied: 50,
      edgePp: 4,
      price: -105,
      playGrade: "Watchlist",
      publicSplits: [],
      marketReadV2: null,
    },
  ],
}), { quickRead: true, marketRead: true, supportingEvidence: true, risk: false });
const worldCupText = JSON.stringify(worldCup);
check("World Cup does not expect Consensus Splits", worldCup.sourceState.missingExpectedSources.length === 0);
check("World Cup no-split copy does not mention Consensus Splits", !worldCupText.match(/Consensus Splits/i), worldCupText);
check("World Cup no-split copy does not mention Sharp Book", !worldCupText.match(/Sharp Book|Sharp-book/i), worldCupText);
check("World Cup rendered copy uses price/model context", worldCupText.match(/model|price|movement|edge/i) !== null, worldCupText);

const noEdge = buildRecommendationDecision({
  sport: "mlb",
  slateDate: "2026-06-28",
  gameId: "game-4",
  homeTeam: "KC",
  awayTeam: "CWS",
  markets: [{ ...baseMarket, edgePp: 0.4, playGrade: "No Play", marketReadV2: read({ consensusMoney: 0.51, consensusBets: 0.50, sharp: null }) }],
});
check("No Play can be used with present data", noEdge.markets.moneyline?.playGrade === "No Play" && noEdge.markets.moneyline.consensusSplits !== null);

// The new open-card interpretation is explicit. Existing/default callers,
// including immutable CFB locks, retain their exact legacy interpretation.
const staleNamed: MarketSplitDisplaySection = {
  label: "Sharp Book Splits", sourceBook: "circa", signal: "strong resistance against the pick",
  lastUpdated: "2026-11-06T10:02:00Z", rows: [
    {side: "away", label: "CWS", moneyPct: 20, betsPct: 30, observedAt: "2026-11-06T10:02:00Z", isStale: true},
    {side: "home", label: "KC", moneyPct: 80, betsPct: 70, observedAt: "2026-11-06T10:02:00Z", isStale: true},
  ],
};
const currentMarket = {...baseMarket, publicSplits: baseMarket.publicSplits.map(row => ({...row, isStale: false})),
  marketReadV2: null, sharpBookSplitsOverride: staleNamed, allowBestAngleMarketConflict: true};
const currentArgs = {sport: "cfb", slateDate: "2026-11-06", gameId: "current-cfb", homeTeam: "KC", awayTeam: "CWS", markets: [currentMarket]};
const inputBefore = JSON.stringify(currentArgs);
const legacyStale = buildRecommendationDecision(currentArgs);
const explicitLegacy = buildRecommendationDecision({...currentArgs, currentSplitEvidenceOnly: false});
check("Default and explicit legacy stale interpretation are byte-identical", JSON.stringify(legacyStale) === JSON.stringify(explicitLegacy));
check("Legacy stale opposition remains the stored mixed read", legacyStale.markets.moneyline?.resolvedMarketRead.status === "mixed");
const currentStale = buildRecommendationDecision({...currentArgs, currentSplitEvidenceOnly: true});
const currentMoneyline = currentStale.markets.moneyline!;
check("Open CFB stale opposition is older context rather than current mixed pressure", currentMoneyline.resolvedMarketRead.status === "consensus_support" && !currentMoneyline.sourceConflict);
check("Older context is explicitly labeled", currentMoneyline.quickRead.includes("Older sharp book splits") && currentMoneyline.quickRead.includes("do not establish current pressure"));
check("Original stale section and timestamps remain exact", JSON.stringify(currentMoneyline.sharpBookSplits) === JSON.stringify(staleNamed));
check("Opt-in interpretation has its own presentation release", currentMoneyline.reasonCodes.includes(CURRENT_SPLIT_EVIDENCE_READER_RELEASE));
check("Legacy interpretation has no new presentation stamp", !legacyStale.markets.moneyline!.reasonCodes.includes(CURRENT_SPLIT_EVIDENCE_READER_RELEASE));
check("Summary migration preserves price/probability/grade", currentMoneyline.price === legacyStale.markets.moneyline!.price && currentMoneyline.modelProbability === legacyStale.markets.moneyline!.modelProbability && currentMoneyline.playGrade === legacyStale.markets.moneyline!.playGrade);
check("Summary migration never mutates source input", JSON.stringify(currentArgs) === inputBefore);
const noCurrentSplit = {...currentMarket, publicSplits: [], sharpBookSplitsOverride: {...staleNamed, rows: []}};
const signalOnly = buildRecommendationDecision({...currentArgs, currentSplitEvidenceOnly: true, markets: [noCurrentSplit]});
check("Signal-only section cannot resurrect fresh pressure", signalOnly.markets.moneyline!.resolvedMarketRead.status === "no_clear_signal" && signalOnly.markets.moneyline!.quickRead.includes("freshness") && signalOnly.markets.moneyline!.quickRead.includes("unverified"));
const unknownTime = buildRecommendationDecision({...currentArgs, currentSplitEvidenceOnly: true, markets: [{...currentMarket,
  sharpBookSplitsOverride: {...staleNamed, rows: staleNamed.rows.map(row => ({...row, isStale: undefined}))}}]});
check("Missing freshness does not claim current professional pressure", unknownTime.markets.moneyline!.resolvedMarketRead.status === "consensus_support" && unknownTime.markets.moneyline!.quickRead.includes("unverified"));
const currentPriceOnly = buildRecommendationDecision({...currentArgs, currentSplitEvidenceOnly: true,
  markets: [{...noCurrentSplit, lineMovementOverride: "resistance"}]});
check("Current price response still reads without a fresh split", currentPriceOnly.markets.moneyline!.resolvedMarketRead.status === "resistance" && currentPriceOnly.markets.moneyline!.quickRead.includes("Observed price movement"));
const freshPressure: MarketSplitDisplaySection = {...staleNamed, signal: null,
  rows: staleNamed.rows.map(row => ({...row, isStale: false, moneyPct: row.side === "away" ? 65 : 35, betsPct: row.side === "away" ? 60 : 40}))};
const pressureResponse = buildRecommendationDecision({...currentArgs, currentSplitEvidenceOnly: true,
  markets: [{...currentMarket, sharpBookSplitsOverride: freshPressure, lineMovementOverride: "resistance"}]});
check("Fresh pressure and opposing observed response remain distinct", pressureResponse.markets.moneyline!.resolvedMarketRead.status === "mixed" && pressureResponse.markets.moneyline!.resolvedMarketRead.copy.includes("observed price response"));
const retailSection: MarketSplitDisplaySection = {...freshPressure, label: "DraftKings Splits", sourceBook: "draftkings"};
const retailBuilt = buildRecommendationDecision({...currentArgs, currentSplitEvidenceOnly: true,
  markets: [{...currentMarket, sharpBookSplitsOverride: retailSection}]});
check("Current retail display never establishes professional source coverage", !retailBuilt.sourceState.sharpBookSplitsAvailable && retailBuilt.markets.moneyline!.reasonCodes.includes("named_retail_splits_available"));
const retail = applySharpBookSplitSectionToDecision({sport: "cfb", marketKey: "moneyline", decision: currentMoneyline,
  section: retailSection, currentSplitEvidenceOnly: true});
check("Named retail overlay retains its physical source without professional authority", retail.sharpBookSplits?.sourceBook === "draftkings" && retail.reasonCodes.includes("named_retail_splits_available") && !retail.reasonCodes.includes("sharp_book_splits_available"));
check("Named retail overlay never regrades", retail.playGrade === currentMoneyline.playGrade && retail.modelProbability === currentMoneyline.modelProbability && retail.price === currentMoneyline.price);
const staleRetail = applySharpBookSplitSectionToDecision({sport: "cfb", marketKey: "moneyline", decision: currentMoneyline,
  section: {...staleNamed, label: "DraftKings Splits", sourceBook: "draftkings"}, currentSplitEvidenceOnly: true});
check("Older retail context is labeled by its actual book", staleRetail.quickRead.includes("Older DraftKings splits") && !/sharp book pressure/i.test(staleRetail.quickRead));
const inheritedOverlay = applySharpBookSplitSectionToDecision({sport: "cfb", marketKey: "moneyline", decision: currentMoneyline, section: staleNamed});
check("Later overlays inherit the open-card contract without a new caller flag", inheritedOverlay.resolvedMarketRead.status === "consensus_support" && inheritedOverlay.quickRead.includes("Older sharp book splits") && inheritedOverlay.reasonCodes.includes(CURRENT_SPLIT_EVIDENCE_READER_RELEASE));
check("Inherited overlays retain original section and economics", JSON.stringify(inheritedOverlay.sharpBookSplits) === JSON.stringify(staleNamed) && inheritedOverlay.playGrade === currentMoneyline.playGrade && inheritedOverlay.price === currentMoneyline.price && inheritedOverlay.modelProbability === currentMoneyline.modelProbability);
const inheritedUnknown = applySharpBookSplitSectionToDecision({sport: "cfb", marketKey: "moneyline", decision: currentMoneyline,
  section: {...staleNamed, rows: staleNamed.rows.map(row => ({...row, isStale: undefined}))}});
check("Inherited overlays cannot resurrect unknown freshness or its legacy signal", inheritedUnknown.resolvedMarketRead.status === "consensus_support" && inheritedUnknown.quickRead.includes("unverified"));
const legacyOverlay = applySharpBookSplitSectionToDecision({sport: "cfb", marketKey: "moneyline", decision: legacyStale.markets.moneyline!, section: staleNamed});
check("Unstamped legacy overlays preserve existing interpretation", legacyOverlay.resolvedMarketRead.status === "mixed" && !legacyOverlay.reasonCodes.includes(CURRENT_SPLIT_EVIDENCE_READER_RELEASE));

if (fail > 0) process.exit(1);
console.log("\nAll recommendation decision tests passed.");
