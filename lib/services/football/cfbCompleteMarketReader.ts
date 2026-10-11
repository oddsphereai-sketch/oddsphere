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
import type { CfbSharpApiSplitRecord } from "./cfbSharpApiSplits";
import {
  summarizePmf,
  tiltCfbMarginWithinTotals,
  tiltCfbTotalWithinMargins,
} from "./cfbMarketSharpAwareShadow";
import type { CfbV1Forecast } from "./cfbV1Decision";

export const CFB_COMPLETE_MARKET_READER_RELEASE =
  "cfb_complete_market_reader_2026_10_11_r5_consensus_authority_split_specialization" as const;
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
  const marginFeatures = residualFeatures(base, "margin");
  const marketMargin = marginFeatures.spread_all_current_axis;
  const marginEvidenceAvailable = marketMargin !== undefined;
  const independentMargin = args.independentForecast.expectedMarginHome;
  const disagreement = marketMargin === undefined ? 0 : Math.abs(marketMargin - independentMargin);
  const consensusAuthority = ARTIFACT.margin.baseConsensusAuthority +
    ARTIFACT.margin.maximumAdditionalConsensusAuthority *
      Math.tanh(disagreement / ARTIFACT.margin.disagreementScalePoints);
  const anchoredMargin = marketMargin === undefined
    ? independentMargin
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
  const proposedMargin = unresolvedSpreadCrossing
    ? args.forecast.expectedMarginHome
    : upsetAwareMargin;

  const fallbackTotalSide = consensusSplitSide(observations, "total", ARTIFACT.total.splitProvenance);
  const totalBoundary = args.evaluatedLines.total;
  const totalEvidenceAvailable = totalBoundary !== null && fallbackTotalSide !== null;
  const independentTotal = args.independentForecast.expectedTotal;
  const proposedTotal = !totalEvidenceAvailable ||
      lineWinner(independentTotal, totalBoundary!) === fallbackTotalSide
    ? independentTotal
    : independentTotal + ARTIFACT.total.reflectionAuthority *
      (2 * totalBoundary! - 2 * independentTotal);
  const marginPmf = tiltCfbMarginWithinTotals(
    args.forecast.pmf,
    proposedMargin - args.forecast.expectedMarginHome,
  );
  const marginSummary = summarizePmf(marginPmf);
  const initialTotalPmf = tiltCfbTotalWithinMargins(
    marginPmf,
    proposedTotal - marginSummary.expectedTotal,
  );
  const desiredTotalSide = totalBoundary === null
    ? null
    : fallbackTotalSide ?? lineWinner(independentTotal, totalBoundary);
  const finalPmf = totalBoundary !== null && desiredTotalSide !== null && desiredTotalSide !== "push"
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
    marginEvidenceAvailable,
    totalEvidenceAvailable,
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
): Side | null {
  const reads = splitReads(observations, market).filter((read) => read.provenance === provenance);
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

function marketTrails(observations: Observation[], market: Market): Trail[] {
  const bySource = new Map<string, Array<{
    opening: CfbForwardContextFamily[4];
    current: CfbForwardContextFamily[5];
  }>>();
  for (const observation of observations) {
    for (const family of targetExcludedFamilies(observation, market)) {
      const source = canonical(family[0]);
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
    const opening = ordered
      .flatMap((row) => row.opening ? [row.opening] : [])
      .sort((left, right) => Date.parse(left[0]) - Date.parse(right[0]))[0] ?? first.current;
    const deltas: number[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      const prior = ordered[index - 1]!.current;
      const current = ordered[index]!.current;
      const priorValue = market === "moneyline" ? probabilityValue(market, prior) : axisValue(market, prior);
      const currentValue = market === "moneyline" ? probabilityValue(market, current) : axisValue(market, current);
      if (priorValue !== null && currentValue !== null && Math.abs(currentValue - priorValue) > 1e-9) {
        deltas.push(currentValue - priorValue);
      }
    }
    let reversalCount = 0;
    for (let index = 1; index < deltas.length; index += 1) {
      if (Math.sign(deltas[index]!) !== Math.sign(deltas[index - 1]!)) reversalCount += 1;
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
      firstMoveAt: deltas.length ? ordered[1]?.current[0] ?? last.current[0] : null,
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

function splitReads(observations: Observation[], market: Market): SplitRead[] {
  const buckets = new Map<string, Array<{
    at: string;
    side: Side;
    gap: number;
    money: number;
    tickets: number;
    provenance: SplitRead["provenance"];
  }>>();
  for (const observation of observations) {
    const publicSplit = observation.playbookSplits?.[market] ?? null;
    const publicRead = publicSplit ? playbookSide(publicSplit, market) : null;
    if (publicSplit && publicRead) {
      buckets.set("public", [...(buckets.get("public") ?? []), {
        at: publicSplit.capturedAt,
        ...publicRead,
        provenance: "public",
      }]);
    }
    for (const record of observation.sharpApiSplits) {
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
}, axis: Axis): Record<string, number> {
  const output: Record<string, number> = {
    independent_margin: args.independentMargin,
    independent_margin_abs: Math.abs(args.independentMargin),
    independent_total: args.independentTotal,
    both_fbs: Number(args.awayFbs && args.homeFbs),
    fbs_mismatch: Number(args.awayFbs !== args.homeFbs),
    same_conference: Number(args.awayConferenceId !== null && args.awayConferenceId === args.homeConferenceId),
  };
  const primaryMarket: Market = axis === "margin" ? "spread" : "total";
  const primaryTrails = marketTrails(args.observations, primaryMarket);
  addTrailFeatures(output, primaryMarket, primaryTrails, args.kickoffAt);
  if (axis === "margin") {
    addTrailFeatures(output, "moneyline", marketTrails(args.observations, "moneyline"), args.kickoffAt);
  }
  const primaryCurrent = median(primaryTrails.flatMap((trail) => trail.currentAxis === null ? [] : [trail.currentAxis]));
  const primaryOpening = median(primaryTrails.flatMap((trail) => trail.openingAxis === null ? [] : [trail.openingAxis]));
  const independent = axis === "margin" ? args.independentMargin : args.independentTotal;
  if (primaryCurrent !== null) output.market_disagreement = primaryCurrent - independent;
  if (primaryOpening !== null) output.opening_disagreement = primaryOpening - independent;
  if (primaryCurrent !== null && primaryOpening !== null) output.market_path = primaryCurrent - primaryOpening;
  const reads = splitReads(args.observations, primaryMarket);
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
