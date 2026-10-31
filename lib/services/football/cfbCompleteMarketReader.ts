import artifactJson from "./modelArtifacts/cfbCompleteMarketReaderArtifact.json";
import type {
  CfbForwardEvidencePayload,
  CfbForwardMarketHistoryEvidence,
  CfbForwardPlaybookSplit,
} from "./cfbForwardEvidence";
import type {
  CfbForwardContextFamily,
  CfbForwardMarketReaderObservation,
} from "./cfbForwardEvidenceCapture";
import { CFB_FORWARD_CONTEXT_CAPTURE_FRESH_MINUTES } from "./cfbForwardEvidenceCapture";
import type { CfbSharpApiSplitRecord } from "./cfbSharpApiSplits";
import {
  CFB_SHARP_MAX_AGE_MINUTES,
  summarizePmf,
  tiltCfbMarginWithinTotals,
  tiltCfbTotalWithinMargins,
} from "./cfbMarketSharpAwareShadow";
import type { CfbV1Forecast } from "./cfbV1Decision";

export const CFB_COMPLETE_MARKET_READER_RELEASE =
  "cfb_complete_market_reader_2026_10_31_r7_exact_source_named_total_economics" as const;
export const CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE =
  "cfb_market_reader_artifact_2026_10_11_r5_consensus_authority_split_specialization" as const;

type Market = "moneyline" | "spread" | "total";
type Axis = "margin" | "total";
type Side = "first" | "second";
type Artifact = {
  release: string;
  trainedThrough: string;
  games: number;
  selectionProtocol: string;
  margin: {
    baseConsensusAuthority: number;
    maximumAdditionalConsensusAuthority: number;
    disagreementScalePoints: number;
    upsetRetention: {
      minimumAbsoluteConsensusMargin: number;
      maximumAbsoluteConsensusMargin: number;
    };
    minimumResolvedSpreadEdgePoints: number;
  };
  total: {
    splitProvenance: "fallback";
    reflectionAuthority: number;
  };
};
type Observation = {
  capturedAt: string;
  markets: CfbForwardMarketReaderObservation["markets"];
  playbookSplits: CfbForwardEvidencePayload["market"]["playbookSplits"];
  sharpApiSplits: CfbSharpApiSplitRecord[];
};
type Trail = {
  source: string;
  sourceClass: "named" | "retail";
  openingAxis: number | null;
  currentAxis: number | null;
  openingProbability: number;
  currentProbability: number;
  moveCount: number;
  reversalCount: number;
  priceReversalCount: number;
  firstMoveAt: string | null;
};
type SplitRead = {
  provenance: "named_sharp" | "fallback" | "public";
  side: Side;
  gapPp: number;
  moneyPct: number;
  ticketsPct: number;
  moneyAccelerationPp: number | null;
};

const ARTIFACT = artifactJson as Artifact;
const NAMED = new Set(["circa", "pinnacle", "bookmaker"]);

export type CfbCompleteMarketReaderResult = {
  forecast: CfbV1Forecast;
  marginShiftPoints: number;
  totalShiftPoints: number;
  totalSideFlipped: boolean;
  marginEvidenceAvailable: boolean;
  totalEvidenceAvailable: boolean;
  totalEvidenceRoute: "named_economic_path" | "fallback_split" | "independent";
  namedTotalStatus: "applied" | "missing" | "insufficient" | "line_mismatch" |
    "reversal" | "source_conflict" | "partial_named_move" | "flat" | "model_support_unavailable";
  namedMarginStatus: "applied" | "missing" | "insufficient" | "line_mismatch" |
    "reversal" | "source_conflict" | "partial_named_move" | "flat" | "model_support_unavailable";
};

export function applyCfbCompleteMarketReader(args: {
  forecast: CfbV1Forecast;
  independentForecast: Pick<CfbV1Forecast, "expectedMarginHome" | "expectedTotal">;
  histories: CfbForwardMarketHistoryEvidence[];
  currentObservation: CfbForwardMarketReaderObservation;
  kickoffAt: string;
  awayFbs: boolean;
  homeFbs: boolean;
  awayConferenceId: number | null;
  homeConferenceId: number | null;
  evaluatedLines: {
    homeSpread: number | null;
    total: number | null;
  };
  evaluatedSportsbooks?: Partial<Record<Market, string>>;
}): CfbCompleteMarketReaderResult {
  assertArtifact();
  const observations = [
    ...args.histories
      .filter((history) => Date.parse(history.capturedAt) <= Date.parse(args.currentObservation.capturedAt))
      .map(observationFromHistory),
    args.currentObservation,
  ].sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt));
  const base = {
    independentMargin: args.independentForecast.expectedMarginHome,
    independentTotal: args.independentForecast.expectedTotal,
    awayFbs: args.awayFbs,
    homeFbs: args.homeFbs,
    awayConferenceId: args.awayConferenceId,
    homeConferenceId: args.homeConferenceId,
    kickoffAt: args.kickoffAt,
    observations,
  };
  const splitContext = {
    asOf: args.currentObservation.capturedAt,
    kickoffAt: args.kickoffAt,
    homeSpread: args.evaluatedLines.homeSpread,
    total: args.evaluatedLines.total,
    evaluatedSportsbooks: args.evaluatedSportsbooks ?? {},
  };
  const marginFeatures = residualFeatures(base, "margin", splitContext);
  // Named price-discovery books form the margin reference when at least two
  // independent named sources agree on an exact current axis. Retail breadth
  // remains context, not a vote that can swamp those sources by book count.
  const marketMargin = (marginFeatures.spread_named_source_count ?? 0) >= 2
    ? marginFeatures.spread_named_current_axis
    : marginFeatures.spread_all_current_axis;
  const spreadConsensusAvailable = marketMargin !== undefined;
  const independentMargin = args.independentForecast.expectedMarginHome;
  const disagreement = marketMargin === undefined ? 0 : Math.abs(marketMargin - independentMargin);
  const consensusAuthority = ARTIFACT.margin.baseConsensusAuthority +
    ARTIFACT.margin.maximumAdditionalConsensusAuthority *
      Math.tanh(disagreement / ARTIFACT.margin.disagreementScalePoints);
  const anchoredMargin = marketMargin === undefined
    ? args.forecast.expectedMarginHome
    : independentMargin + consensusAuthority * (marketMargin - independentMargin);
  const retainIndependentUpset = marketMargin !== undefined &&
    lineWinner(independentMargin, 0) !== lineWinner(marketMargin, 0) &&
    Math.abs(marketMargin) >= ARTIFACT.margin.upsetRetention.minimumAbsoluteConsensusMargin &&
    Math.abs(marketMargin) <= ARTIFACT.margin.upsetRetention.maximumAbsoluteConsensusMargin;
  const upsetAwareMargin = retainIndependentUpset ? independentMargin : anchoredMargin;
  const spreadBoundary = args.evaluatedLines.homeSpread === null
    ? null
    : -args.evaluatedLines.homeSpread;
  const unresolvedSpreadCrossing = spreadBoundary !== null &&
    lineWinner(upsetAwareMargin, spreadBoundary) !== lineWinner(args.forecast.expectedMarginHome, spreadBoundary) &&
    Math.abs(upsetAwareMargin - spreadBoundary) < ARTIFACT.margin.minimumResolvedSpreadEdgePoints;
  const consensusMargin = unresolvedSpreadCrossing
    ? args.forecast.expectedMarginHome
    : upsetAwareMargin;
  // Adjudicate the named spread and ML paths against the same pre-reader PMF
  // before touching the score. The spread number and its price are one
  // economic observation; a named path cannot be counted again as consensus.
  const namedMarginRead = namedMarginPriceOnlyTarget({
    spreadTrails: marketTrails(observations, "spread", splitContext.asOf,
      splitContext.evaluatedSportsbooks.spread),
    moneylineTrails: marketTrails(observations, "moneyline", splitContext.asOf,
      splitContext.evaluatedSportsbooks.moneyline),
    spreadBoundary,
    pmf: args.forecast.pmf,
  });
  const proposedMargin = namedMarginRead.targetMargin ??
    (namedMarginRead.status === "source_conflict" || namedMarginRead.status === "reversal"
      ? args.forecast.expectedMarginHome : consensusMargin);

  const fallbackTotalSide = consensusSplitSide(observations, "total", ARTIFACT.total.splitProvenance, splitContext);
  const totalBoundary = args.evaluatedLines.total;
  const namedTotalRead = totalBoundary === null
    ? { status: "model_support_unavailable" as const, targetTotal: null }
    :
    namedTotalMarketTarget({
      trails: marketTrails(observations, "total", splitContext.asOf,
        splitContext.evaluatedSportsbooks.total),
      boundary: totalBoundary,
      pmf: args.forecast.pmf,
    });
  const namedTotalTarget = namedTotalRead.targetTotal;
  // Public money-ticket pressure against named books holding their price is
  // resistance, not confirmation. A partial lead, buyback, or disagreement
  // similarly cannot be silently resolved by a lower-provenance split.
  const namedBlocksFallback = ["flat", "partial_named_move", "reversal", "source_conflict"]
    .includes(namedTotalRead.status);
  const fallbackTotalQualified = fallbackTotalSide !== null && !namedBlocksFallback;
  const totalEvidenceAvailable = totalBoundary !== null &&
    (fallbackTotalQualified || namedTotalTarget !== null);
  const releasedTotal = args.forecast.expectedTotal;
  const proposedTotal = namedTotalTarget ?? (!totalEvidenceAvailable ||
      lineWinner(releasedTotal, totalBoundary!) === fallbackTotalSide
    ? releasedTotal
    : releasedTotal + ARTIFACT.total.reflectionAuthority *
      (2 * totalBoundary! - 2 * releasedTotal));
  const marginPmf = tiltCfbMarginWithinTotals(
    args.forecast.pmf,
    proposedMargin - args.forecast.expectedMarginHome,
  );
  const marginSummary = summarizePmf(marginPmf);
  const initialTotalPmf = tiltCfbTotalWithinMargins(
    marginPmf,
    proposedTotal - marginSummary.expectedTotal,
  );
  const desiredTotalSide = totalBoundary === null || namedTotalTarget !== null ||
      !fallbackTotalQualified
    ? null
    : fallbackTotalSide;
  const finalPmf = totalBoundary !== null && desiredTotalSide !== null
    ? alignTotalPmfSide({
      basePmf: marginPmf,
      initialPmf: initialTotalPmf,
      initialTargetTotal: proposedTotal,
      boundary: totalBoundary,
      side: desiredTotalSide,
    })
    : initialTotalPmf;
  const summary = summarizePmf(finalPmf);
  const totalSideFlipped = totalBoundary !== null &&
    pmfTotalSide(finalPmf, totalBoundary) !== pmfTotalSide(args.forecast.pmf, totalBoundary);
  return {
    forecast: { ...args.forecast, ...summary, pmf: finalPmf },
    marginShiftPoints: summary.expectedMarginHome - args.forecast.expectedMarginHome,
    totalShiftPoints: summary.expectedTotal - args.forecast.expectedTotal,
    totalSideFlipped,
    marginEvidenceAvailable: spreadConsensusAvailable || namedMarginRead.targetMargin !== null,
    totalEvidenceAvailable,
    totalEvidenceRoute: namedTotalTarget !== null ? "named_economic_path"
      : fallbackTotalQualified && totalBoundary !== null ? "fallback_split" : "independent",
    namedTotalStatus: namedTotalRead.status,
    namedMarginStatus: namedMarginRead.status,
  };
}

function pmfTotalSide(
  pmf: CfbV1Forecast["pmf"],
  boundary: number,
): Side | "push" {
  let over = 0;
  let under = 0;
  for (const cell of pmf) {
    const total = cell.home + cell.away;
    if (total > boundary) over += cell.probability;
    else if (total < boundary) under += cell.probability;
    else {
      over += 0.5 * cell.probability;
      under += 0.5 * cell.probability;
    }
  }
  return Math.abs(over - under) < 1e-12 ? "push" : over > under ? "first" : "second";
}

function overProbability(pmf: CfbV1Forecast["pmf"], boundary: number): number {
  return pmf.reduce((sum, cell) => {
    const total = cell.home + cell.away;
    return sum + cell.probability * (total > boundary ? 1 : total === boundary ? 0.5 : 0);
  }, 0);
}

function homeCoverProbability(pmf: CfbV1Forecast["pmf"], boundary: number): number {
  return pmf.reduce((sum, cell) => {
    const margin = cell.home - cell.away;
    return sum + cell.probability * (margin > boundary ? 1 : margin === boundary ? 0.5 : 0);
  }, 0);
}

function namedMarginPriceOnlyTarget(args: {
  spreadTrails: Trail[];
  moneylineTrails: Trail[];
  spreadBoundary: number | null;
  pmf: CfbV1Forecast["pmf"];
}): {
  status: CfbCompleteMarketReaderResult["namedMarginStatus"];
  targetMargin: number | null;
} {
  const cohort = (trails: Trail[], boundary: number | null) => {
    const named = trails.filter((trail) => trail.sourceClass === "named");
    if (named.length < 2) return { status: named.length ? "insufficient" : "missing", delta: null } as const;
    if (boundary !== null && named.some((trail) =>
      trail.openingAxis === null || trail.currentAxis === null)) {
      return { status: "line_mismatch", delta: null } as const;
    }
    if (named.some((trail) => trail.priceReversalCount > 0 || trail.reversalCount > 0)) {
      return { status: "reversal", delta: null } as const;
    }
    // A moved spread number and its juice are one economic observation.
    // Books need not quote the evaluated number: normalize each book against
    // the same PMF at its own opening and current cover contracts, then
    // transfer only the agreed change to the evaluated contract below.
    const deltas = named.map((trail) => boundary === null
      ? logOdds(trail.currentProbability) - logOdds(trail.openingProbability)
      : logOdds(trail.currentProbability) -
          logOdds(homeCoverProbability(args.pmf, trail.currentAxis!)) -
          (logOdds(trail.openingProbability) -
            logOdds(homeCoverProbability(args.pmf, trail.openingAxis!))));
    if (deltas.some((delta) => !Number.isFinite(delta))) {
      return { status: "model_support_unavailable", delta: null } as const;
    }
    if (new Set(deltas.filter((delta) => Math.abs(delta) >= 1e-9).map(Math.sign)).size > 1) {
      return { status: "source_conflict", delta: null } as const;
    }
    if (deltas.some((delta) => Math.abs(delta) < 1e-9)) {
      return { status: deltas.some((delta) => Math.abs(delta) >= 1e-9)
        ? "partial_named_move" : "flat", delta: null } as const;
    }
    return { status: "applied", delta: median(deltas) } as const;
  };
  const spread = args.spreadBoundary === null
    ? { status: "missing", delta: null } as const
    : cohort(args.spreadTrails, args.spreadBoundary);
  const moneyline = cohort(args.moneylineTrails, null);
  // A disagreement inside either named side market is a game-story conflict.
  // Do not silently promote agreement in the other market into a coherent
  // margin update while one set of named books points both ways.
  if (spread.status === "source_conflict" || moneyline.status === "source_conflict") {
    return { status: "source_conflict", targetMargin: null };
  }
  if (spread.delta !== null && moneyline.delta !== null &&
      Math.sign(spread.delta) !== Math.sign(moneyline.delta)) {
    return { status: "source_conflict", targetMargin: null };
  }
  const selected = spread.delta !== null
    ? { delta: spread.delta, boundary: args.spreadBoundary! }
    : moneyline.delta !== null
      ? { delta: moneyline.delta, boundary: 0 }
      : null;
  if (!selected) {
    return { status: spread.status !== "missing" ? spread.status : moneyline.status,
    targetMargin: null };
  }
  const prior = homeCoverProbability(args.pmf, selected.boundary);
  if (prior <= 0 || prior >= 1) return { status: "model_support_unavailable", targetMargin: null };
  const target = 1 / (1 + Math.exp(-(logOdds(prior) + selected.delta)));
  const current = summarizePmf(args.pmf).expectedMarginHome;
  const margins = args.pmf.map((cell) => cell.home - cell.away);
  let low = Math.min(...margins) + 1e-6;
  let high = Math.max(...margins) - 1e-6;
  const lowP = homeCoverProbability(tiltCfbMarginWithinTotals(args.pmf, low - current), selected.boundary);
  const highP = homeCoverProbability(tiltCfbMarginWithinTotals(args.pmf, high - current), selected.boundary);
  if (target < lowP || target > highP) {
    return { status: "model_support_unavailable", targetMargin: null };
  }
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const tilted = tiltCfbMarginWithinTotals(args.pmf, middle - current);
    if (homeCoverProbability(tilted, selected.boundary) < target) low = middle;
    else high = middle;
  }
  return { status: "applied", targetMargin: (low + high) / 2 };
}

function namedTotalMarketTarget(args: {
  trails: Trail[];
  boundary: number;
  pmf: CfbV1Forecast["pmf"];
}): {
  status: CfbCompleteMarketReaderResult["namedTotalStatus"];
  targetTotal: number | null;
} {
  const named = args.trails.filter((trail) => trail.sourceClass === "named");
  if (named.length === 0) return { status: "missing", targetTotal: null };
  if (named.length < 2) return { status: "insufficient", targetTotal: null };
  if (named.some((trail) => trail.openingAxis === null || trail.currentAxis === null)) {
    return { status: "line_mismatch", targetTotal: null };
  }
  if (named.some((trail) => trail.reversalCount > 0 || trail.priceReversalCount > 0)) {
    return { status: "reversal", targetTotal: null };
  }
  // Compare each book's two prices against the same independent scoring PMF
  // at the *respective* quoted lines. A new number and its compensating juice
  // therefore form one economic observation, rather than two votes.
  const changes = named.map((trail) => {
    const modelOpening = overProbability(args.pmf, trail.openingAxis!);
    // Each named book can quote a different current number. Normalize the
    // opening/current prices at that book's own contracts, then transfer the
    // agreed change to the evaluated contract below.
    const modelCurrent = overProbability(args.pmf, trail.currentAxis!);
    return logOdds(trail.currentProbability) - logOdds(modelCurrent) -
      (logOdds(trail.openingProbability) - logOdds(modelOpening));
  });
  if (changes.some((change) => !Number.isFinite(change))) {
    return { status: "model_support_unavailable", targetTotal: null };
  }
  if (new Set(changes.filter((change) => Math.abs(change) >= 1e-9).map(Math.sign)).size > 1) {
    return { status: "source_conflict", targetTotal: null };
  }
  if (changes.some((change) => Math.abs(change) < 1e-9)) {
    return { status: changes.some((change) => Math.abs(change) >= 1e-9)
      ? "partial_named_move" : "flat", targetTotal: null };
  }
  const marketOddsChange = median(changes);
  if (marketOddsChange === null) return { status: "flat", targetTotal: null };
  const priorOver = overProbability(args.pmf, args.boundary);
  if (priorOver <= 0 || priorOver >= 1) {
    return { status: "model_support_unavailable", targetTotal: null };
  }
  const targetOver = 1 / (1 + Math.exp(-(logOdds(priorOver) + marketOddsChange)));
  const targetTotal = totalMeanForOverProbability(args.pmf, args.boundary, targetOver);
  if (targetTotal === null) return { status: "model_support_unavailable", targetTotal: null };
  return {
    status: "applied",
    targetTotal,
  };
}

function logOdds(probability: number): number {
  return Math.log(probability / (1 - probability));
}

function totalMeanForOverProbability(
  pmf: CfbV1Forecast["pmf"],
  boundary: number,
  targetOver: number,
): number | null {
  const current = summarizePmf(pmf).expectedTotal;
  const totals = pmf.map((cell) => cell.home + cell.away);
  let low = Math.min(...totals) + 1e-6;
  let high = Math.max(...totals) - 1e-6;
  const lowP = overProbability(tiltCfbTotalWithinMargins(pmf, low - current), boundary);
  const highP = overProbability(tiltCfbTotalWithinMargins(pmf, high - current), boundary);
  if (targetOver < lowP || targetOver > highP) return null;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const tilted = tiltCfbTotalWithinMargins(pmf, middle - current);
    if (overProbability(tilted, boundary) < targetOver) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function alignTotalPmfSide(args: {
  basePmf: CfbV1Forecast["pmf"];
  initialPmf: CfbV1Forecast["pmf"];
  initialTargetTotal: number;
  boundary: number;
  side: Side;
}): CfbV1Forecast["pmf"] {
  if (pmfTotalSide(args.initialPmf, args.boundary) === args.side) return args.initialPmf;
  const base = summarizePmf(args.basePmf);
  const totals = args.basePmf.map((cell) => cell.home + cell.away);
  const extreme = args.side === "first"
    ? Math.max(...totals) - 1e-6
    : Math.min(...totals) + 1e-6;
  const atTarget = (target: number) => tiltCfbTotalWithinMargins(
    args.basePmf,
    target - base.expectedTotal,
  );
  const extremePmf = atTarget(extreme);
  if (pmfTotalSide(extremePmf, args.boundary) !== args.side) return args.initialPmf;
  let unresolved = args.initialTargetTotal;
  let resolved = extreme;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const midpoint = (unresolved + resolved) / 2;
    const candidate = atTarget(midpoint);
    if (pmfTotalSide(candidate, args.boundary) === args.side) resolved = midpoint;
    else unresolved = midpoint;
  }
  return atTarget(resolved);
}

function assertArtifact(): void {
  if (
    ARTIFACT.release !== CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE ||
    ARTIFACT.games !== 373 ||
    ARTIFACT.margin.baseConsensusAuthority !== 0.5 ||
    ARTIFACT.margin.maximumAdditionalConsensusAuthority !== 0.25 ||
    ARTIFACT.margin.disagreementScalePoints !== 7 ||
    ARTIFACT.margin.minimumResolvedSpreadEdgePoints !== 1 ||
    ARTIFACT.total.splitProvenance !== "fallback" ||
    ARTIFACT.total.reflectionAuthority !== 1
  ) {
    throw new Error("CFB complete market-reader artifact contract mismatch.");
  }
}

function consensusSplitSide(
  observations: Observation[],
  market: Market,
  provenance: SplitRead["provenance"],
  context: SplitContext,
): Side | null {
  const reads = splitReads(observations, market, context).filter((read) => read.provenance === provenance);
  if (reads.length === 0) return null;
  const vote = reads.reduce((sum, read) =>
    sum + (read.side === "second" ? 1 : -1) * Math.max(Math.abs(read.gapPp), 1), 0);
  return Math.abs(vote) < 1e-9 ? null : vote > 0 ? "second" : "first";
}

function observationFromHistory(history: CfbForwardMarketHistoryEvidence): Observation {
  const empty = { families: [], targetExcludedFamilies: [] };
  return {
    capturedAt: history.capturedAt,
    markets: {
      moneyline: history.payload.contextualEvidenceCapture?.markets.moneyline ?? empty,
      spread: history.payload.contextualEvidenceCapture?.markets.spread ?? empty,
      total: history.payload.contextualEvidenceCapture?.markets.total ?? empty,
    },
    playbookSplits: history.payload.market.playbookSplits,
    sharpApiSplits: history.payload.market.sharpApiSplits ?? [],
  };
}

function targetExcludedFamilies(observation: Observation, market: Market): CfbForwardContextFamily[] {
  const captured = observation.markets[market];
  const allowed = new Set(captured.targetExcludedFamilies);
  return captured.families.filter((family) => allowed.has(family[0]));
}

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function fairFirst(landmark: CfbForwardContextFamily[5]): number {
  const first = implied(landmark[4]);
  const second = implied(landmark[5]);
  return first / (first + second);
}

function axisValue(market: Market, landmark: CfbForwardContextFamily[5]): number | null {
  if (market === "moneyline" || landmark[3] === null) return null;
  return market === "spread" ? -landmark[3] : landmark[3];
}

function probabilityValue(market: Market, landmark: CfbForwardContextFamily[5]): number {
  const first = fairFirst(landmark);
  return market === "total" ? first : 1 - first;
}

function marketTrails(observations: Observation[], market: Market, asOfAt: string,
  evaluatedSportsbook?: string): Trail[] {
  const bySource = new Map<string, Array<{
    opening: CfbForwardContextFamily[4];
    current: CfbForwardContextFamily[5];
  }>>();
  for (const observation of observations) {
    for (const family of targetExcludedFamilies(observation, market)) {
      const source = canonical(family[0]);
      // A historical capture excluded its *then* target. Re-exclude the
      // current evaluated target across the entire trail, not just today.
      if (evaluatedSportsbook && source === canonical(evaluatedSportsbook)) continue;
      bySource.set(source, [...(bySource.get(source) ?? []), {
        opening: family[4],
        current: family[5],
      }]);
    }
  }
  return [...bySource.entries()].flatMap(([source, values]): Trail[] => {
    const ordered = values.sort((first, second) => Date.parse(first.current[0]) - Date.parse(second.current[0]));
    const first = ordered[0];
    const last = ordered.at(-1);
    if (!first || !last) return [];
    const ageMinutes = (Date.parse(asOfAt) - Date.parse(last.current[0])) / 60_000;
    if (last.current[2] !== "f" || !Number.isFinite(ageMinutes) || ageMinutes < 0 ||
        ageMinutes > CFB_FORWARD_CONTEXT_CAPTURE_FRESH_MINUTES) return [];
    const opening = ordered
      .flatMap((row) => row.opening ? [row.opening] : [])
      .sort((left, right) => Date.parse(left[0]) - Date.parse(right[0]))[0] ?? first.current;
    const deltas: number[] = [];
    const priceDeltas: number[] = [];
    const openingValue = market === "moneyline"
      ? probabilityValue(market, opening) : axisValue(market, opening);
    const firstCurrentValue = market === "moneyline"
      ? probabilityValue(market, first.current) : axisValue(market, first.current);
    if (openingValue !== null && firstCurrentValue !== null &&
        Math.abs(firstCurrentValue - openingValue) > 1e-9) {
      deltas.push(firstCurrentValue - openingValue);
    }
    const openingPriceMove = probabilityValue(market, first.current) - probabilityValue(market, opening);
    if (Math.abs(openingPriceMove) > 1e-9) priceDeltas.push(openingPriceMove);
    for (let index = 1; index < ordered.length; index += 1) {
      const prior = ordered[index - 1]!.current;
      const current = ordered[index]!.current;
      const priorValue = market === "moneyline" ? probabilityValue(market, prior) : axisValue(market, prior);
      const currentValue = market === "moneyline" ? probabilityValue(market, current) : axisValue(market, current);
      if (priorValue !== null && currentValue !== null && Math.abs(currentValue - priorValue) > 1e-9) {
        deltas.push(currentValue - priorValue);
      }
      const priceDelta = probabilityValue(market, current) - probabilityValue(market, prior);
      if (Math.abs(priceDelta) > 1e-9) priceDeltas.push(priceDelta);
    }
    let reversalCount = 0;
    for (let index = 1; index < deltas.length; index += 1) {
      if (Math.sign(deltas[index]!) !== Math.sign(deltas[index - 1]!)) reversalCount += 1;
    }
    let priceReversalCount = 0;
    for (let index = 1; index < priceDeltas.length; index += 1) {
      if (Math.sign(priceDeltas[index]!) !== Math.sign(priceDeltas[index - 1]!)) priceReversalCount += 1;
    }
    return [{
      source,
      sourceClass: NAMED.has(source) ? "named" : "retail",
      openingAxis: axisValue(market, opening),
      currentAxis: axisValue(market, last.current),
      openingProbability: probabilityValue(market, opening),
      currentProbability: probabilityValue(market, last.current),
      moveCount: deltas.length,
      reversalCount,
      priceReversalCount,
      firstMoveAt: deltas.length || priceDeltas.length ? first.current[0] : null,
    }];
  });
}

function median(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (finite.length === 0) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle]! : (finite[middle - 1]! + finite[middle]!) / 2;
}

function average(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function addTrailFeatures(
  output: Record<string, number>,
  prefix: string,
  trails: Trail[],
  kickoffAt: string,
): void {
  for (const sourceClass of ["all", "named", "retail"] as const) {
    const selected = sourceClass === "all" ? trails : trails.filter((trail) => trail.sourceClass === sourceClass);
    const currentAxis = median(selected.flatMap((trail) => trail.currentAxis === null ? [] : [trail.currentAxis]));
    const openingAxis = median(selected.flatMap((trail) => trail.openingAxis === null ? [] : [trail.openingAxis]));
    const currentProbability = median(selected.map((trail) => trail.currentProbability));
    const openingProbability = median(selected.map((trail) => trail.openingProbability));
    if (currentAxis !== null) output[`${prefix}_${sourceClass}_current_axis`] = currentAxis;
    if (openingAxis !== null) output[`${prefix}_${sourceClass}_opening_axis`] = openingAxis;
    if (currentAxis !== null && openingAxis !== null) output[`${prefix}_${sourceClass}_axis_move`] = currentAxis - openingAxis;
    if (currentProbability !== null) output[`${prefix}_${sourceClass}_current_probability`] = currentProbability;
    if (openingProbability !== null) output[`${prefix}_${sourceClass}_opening_probability`] = openingProbability;
    if (currentProbability !== null && openingProbability !== null) {
      output[`${prefix}_${sourceClass}_probability_move`] = currentProbability - openingProbability;
    }
    output[`${prefix}_${sourceClass}_source_count`] = selected.length;
    output[`${prefix}_${sourceClass}_move_count`] = selected.reduce((sum, trail) => sum + trail.moveCount, 0);
    output[`${prefix}_${sourceClass}_reversal_count`] = selected.reduce((sum, trail) => sum + trail.reversalCount, 0);
    output[`${prefix}_${sourceClass}_late_6h_count`] = selected.filter((trail) =>
      trail.firstMoveAt && (Date.parse(kickoffAt) - Date.parse(trail.firstMoveAt)) / 60_000 <= 360).length;
  }
}

function splitGap(side: { moneyPct: number; ticketsPct: number }): number {
  return side.moneyPct - side.ticketsPct;
}

function playbookSide(split: CfbForwardPlaybookSplit, market: Market): {
  side: Side;
  gap: number;
  money: number;
  tickets: number;
} | null {
  if (market === "total") {
    if ([split.overMoneyPct, split.overBetsPct, split.underMoneyPct, split.underBetsPct].some((value) => value === null)) return null;
    const first = split.overMoneyPct! - split.overBetsPct!;
    const second = split.underMoneyPct! - split.underBetsPct!;
    if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
    return {
      side: first >= second ? "first" : "second",
      gap: first >= second ? first : second,
      money: first >= second ? split.overMoneyPct! : split.underMoneyPct!,
      tickets: first >= second ? split.overBetsPct! : split.underBetsPct!,
    };
  }
  if ([split.awayMoneyPct, split.awayBetsPct, split.homeMoneyPct, split.homeBetsPct].some((value) => value === null)) return null;
  const first = split.awayMoneyPct! - split.awayBetsPct!;
  const second = split.homeMoneyPct! - split.homeBetsPct!;
  if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
  return {
    side: first >= second ? "first" : "second",
    gap: first >= second ? first : second,
    money: first >= second ? split.awayMoneyPct! : split.homeMoneyPct!,
    tickets: first >= second ? split.awayBetsPct! : split.homeBetsPct!,
  };
}

function sharpSide(record: CfbSharpApiSplitRecord, market: Market): {
  side: Side;
  gap: number;
  money: number;
  tickets: number;
} | null {
  if (market === "total" && record.total) {
    const first = splitGap(record.total.over);
    const second = splitGap(record.total.under);
    if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
    return {
      side: first >= second ? "first" : "second",
      gap: first >= second ? first : second,
      money: first >= second ? record.total.over.moneyPct : record.total.under.moneyPct,
      tickets: first >= second ? record.total.over.ticketsPct : record.total.under.ticketsPct,
    };
  }
  const value = market === "moneyline" ? record.moneyline : record.spread;
  if (!value) return null;
  const first = splitGap(value.away);
  const second = splitGap(value.home);
  if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
  return {
    side: first >= second ? "first" : "second",
    gap: first >= second ? first : second,
    money: first >= second ? value.away.moneyPct : value.home.moneyPct,
    tickets: first >= second ? value.away.ticketsPct : value.home.ticketsPct,
  };
}

type SplitContext = {
  asOf: string;
  kickoffAt: string;
  homeSpread: number | null;
  total: number | null;
  evaluatedSportsbooks: Partial<Record<Market, string>>;
};

function splitReads(observations: Observation[], market: Market, context: SplitContext): SplitRead[] {
  const buckets = new Map<string, Array<{
    at: string;
    side: Side;
    gap: number;
    money: number;
    tickets: number;
    provenance: SplitRead["provenance"];
  }>>();
  const asOfMs = Date.parse(context.asOf);
  const fresh = (capturedAt: string, maxAgeMinutes: number) => {
    const ageMs = asOfMs - Date.parse(capturedAt);
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMinutes * 60_000 &&
      Date.parse(capturedAt) < Date.parse(context.kickoffAt);
  };
  for (const observation of observations) {
    const publicSplit = observation.playbookSplits?.[market] ?? null;
    const publicRead = publicSplit ? playbookSide(publicSplit, market) : null;
    const publicMinutesToKickoff = publicSplit
      ? Date.parse(context.kickoffAt) - Date.parse(publicSplit.capturedAt) : Number.NaN;
    const publicMaxAgeMinutes = publicMinutesToKickoff <= 48 * 60 * 60_000 ? 90 : 390;
    if (publicSplit && publicRead && fresh(publicSplit.capturedAt, publicMaxAgeMinutes)) {
      buckets.set("public", [...(buckets.get("public") ?? []), {
        at: publicSplit.capturedAt,
        ...publicRead,
        provenance: "public",
      }]);
    }
    for (const record of observation.sharpApiSplits) {
      if (!fresh(record.capturedAt, CFB_SHARP_MAX_AGE_MINUTES)) continue;
      if (canonical(record.sportsbook) === canonical(context.evaluatedSportsbooks[market] ?? "")) continue;
      if (market === "total" &&
        (context.total === null || record.total?.line !== context.total)) continue;
      if (market === "spread" &&
        (context.homeSpread === null || record.spread?.homeLine !== context.homeSpread)) continue;
      const read = sharpSide(record, market);
      if (!read) continue;
      const provenance: SplitRead["provenance"] =
        record.sportsbook === "circa" && record.sourceSemantics === "sharp_adjacent"
          ? "named_sharp"
          : "fallback";
      const key = `${provenance}:${canonical(record.sportsbook)}`;
      buckets.set(key, [...(buckets.get(key) ?? []), {
        at: record.capturedAt,
        ...read,
        provenance,
      }]);
    }
  }
  return [...buckets.values()].flatMap((values): SplitRead[] => {
    const unique = [...new Map(values
      .sort((first, second) => Date.parse(first.at) - Date.parse(second.at))
      .map((value) => [`${value.at}:${value.side}:${value.gap}:${value.money}`, value])).values()];
    const first = unique[0];
    const last = unique.at(-1);
    if (!first || !last) return [];
    const firstComparable = unique.find((value) => value.side === last.side) ?? first;
    return [{
      provenance: last.provenance,
      side: last.side,
      gapPp: last.gap,
      moneyPct: last.money,
      ticketsPct: last.tickets,
      moneyAccelerationPp: last.side === firstComparable.side ? last.money - firstComparable.money : null,
    }];
  });
}

function signedSplit(read: SplitRead, axis: Axis): number {
  const positive = axis === "margin" ? read.side === "second" : read.side === "first";
  return (positive ? 1 : -1) * Math.abs(read.gapPp);
}

function residualFeatures(args: {
  independentMargin: number;
  independentTotal: number;
  awayFbs: boolean;
  homeFbs: boolean;
  awayConferenceId: number | null;
  homeConferenceId: number | null;
  kickoffAt: string;
  observations: Observation[];
}, axis: Axis, splitContext: SplitContext): Record<string, number> {
  const output: Record<string, number> = {
    independent_margin: args.independentMargin,
    independent_margin_abs: Math.abs(args.independentMargin),
    independent_total: args.independentTotal,
    both_fbs: Number(args.awayFbs && args.homeFbs),
    fbs_mismatch: Number(args.awayFbs !== args.homeFbs),
    same_conference: Number(args.awayConferenceId !== null && args.awayConferenceId === args.homeConferenceId),
  };
  const primaryMarket: Market = axis === "margin" ? "spread" : "total";
  const primaryTrails = marketTrails(args.observations, primaryMarket, splitContext.asOf,
    splitContext.evaluatedSportsbooks[primaryMarket]);
  addTrailFeatures(output, primaryMarket, primaryTrails, args.kickoffAt);
  if (axis === "margin") {
    addTrailFeatures(output, "moneyline", marketTrails(args.observations, "moneyline", splitContext.asOf,
      splitContext.evaluatedSportsbooks.moneyline), args.kickoffAt);
  }
  const primaryCurrent = median(primaryTrails.flatMap((trail) => trail.currentAxis === null ? [] : [trail.currentAxis]));
  const primaryOpening = median(primaryTrails.flatMap((trail) => trail.openingAxis === null ? [] : [trail.openingAxis]));
  const independent = axis === "margin" ? args.independentMargin : args.independentTotal;
  if (primaryCurrent !== null) output.market_disagreement = primaryCurrent - independent;
  if (primaryOpening !== null) output.opening_disagreement = primaryOpening - independent;
  if (primaryCurrent !== null && primaryOpening !== null) output.market_path = primaryCurrent - primaryOpening;
  const reads = splitReads(args.observations, primaryMarket, splitContext);
  for (const provenance of ["named_sharp", "fallback", "public"] as const) {
    const selected = reads.filter((read) => read.provenance === provenance);
    const signed = average(selected.map((read) => signedSplit(read, axis)));
    const signedMoneyMajority = average(selected.map((read) => {
      const positive = axis === "margin" ? read.side === "second" : read.side === "first";
      return (positive ? 1 : -1) * (read.moneyPct - 50);
    }));
    const signedTicketMajority = average(selected.map((read) => {
      const positive = axis === "margin" ? read.side === "second" : read.side === "first";
      return (positive ? 1 : -1) * (read.ticketsPct - 50);
    }));
    const acceleration = average(selected.flatMap((read) =>
      read.moneyAccelerationPp === null ? [] : [Math.sign(signedSplit(read, axis)) * Math.abs(read.moneyAccelerationPp)]));
    if (signed !== null) output[`split_${provenance}`] = signed;
    if (signedMoneyMajority !== null) output[`split_${provenance}_money_majority`] = signedMoneyMajority;
    if (signedTicketMajority !== null) output[`split_${provenance}_ticket_majority`] = signedTicketMajority;
    if (acceleration !== null) output[`split_${provenance}_acceleration`] = acceleration;
    output[`split_${provenance}_count`] = selected.length;
    if (signed !== null && output.market_path !== undefined) {
      output[`split_${provenance}_path_alignment`] = signed * output.market_path;
    }
    if (signed !== null && output.market_disagreement !== undefined) {
      output[`split_${provenance}_disagreement_alignment`] = signed * output.market_disagreement;
    }
  }
  const namedCurrent = output[`${primaryMarket}_named_current_axis`];
  const retailCurrent = output[`${primaryMarket}_retail_current_axis`];
  if (namedCurrent !== undefined && retailCurrent !== undefined) {
    output.named_retail_axis_gap = namedCurrent - retailCurrent;
  }
  const namedMove = output[`${primaryMarket}_named_axis_move`];
  const retailMove = output[`${primaryMarket}_retail_axis_move`];
  if (namedMove !== undefined && retailMove !== undefined) {
    output.named_retail_move_product = namedMove * retailMove;
  }
  return output;
}

function lineWinner(value: number, boundary: number): Side | "push" {
  const difference = value - boundary;
  return Math.abs(difference) < 1e-9 ? "push" : difference > 0 ? "first" : "second";
}
