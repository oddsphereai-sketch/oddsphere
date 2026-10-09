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
  "cfb_complete_market_reader_2026_10_09_r4_joint_moneyline_spread_reconciliation" as const;
export const CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE =
  "cfb_market_reader_artifact_2026_10_09_r4_joint_moneyline_spread_reconciliation" as const;

type Market = "moneyline" | "spread" | "total";
type Axis = "margin" | "total";
type Side = "first" | "second";
type RidgeModel = {
  names: string[];
  means: number[];
  scales: number[];
  beta: number[];
  prior: number;
};
type Artifact = {
  release: string;
  trainedThrough: string;
  games: number;
  margin: { evidenceScale: number; model: RidgeModel };
  total: {
    evidenceScale: number;
    reflectionSupport: { maximumChronologicalActiveMarketDistance: number };
    model: RidgeModel;
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
  const marginFeatures = professionalReconciliationMarginFeatures(
    residualFeatures(base, "margin"),
    args.forecast.expectedMarginHome,
    args.independentForecast.expectedMarginHome,
    observations,
  );
  const totalFeatures = constrainedMarketFeatures(residualFeatures(base, "total"), "total");
  const marginEvidenceAvailable = hasObservedAxisEvidence(marginFeatures, "margin");
  const totalEvidenceAvailable = hasObservedAxisEvidence(totalFeatures, "total");
  const proposedMargin = marginEvidenceAvailable
    ? posteriorResidualAxis(args.forecast.expectedMarginHome, marginFeatures, "margin", ARTIFACT.margin.model, ARTIFACT.margin.evidenceScale)
    : args.forecast.expectedMarginHome;
  const proposedTotal = totalEvidenceAvailable
    ? posteriorResidualAxis(args.forecast.expectedTotal, totalFeatures, "total", ARTIFACT.total.model, ARTIFACT.total.evidenceScale)
    : args.forecast.expectedTotal;
  const totalBoundary = totalFeatures.total_all_current_axis;
  const totalSideFlipped = totalBoundary !== undefined &&
    lineWinner(proposedTotal, totalBoundary) !== lineWinner(args.forecast.expectedTotal, totalBoundary);
  const finalTotal = totalSideFlipped
    ? resolveCfbSupportAwareTotalFlip({
      active: args.forecast.expectedTotal,
      boundary: totalBoundary!,
      proposed: proposedTotal,
      maximumChronologicalActiveMarketDistance:
        ARTIFACT.total.reflectionSupport.maximumChronologicalActiveMarketDistance,
    })
    : args.forecast.expectedTotal;

  const marginPmf = tiltCfbMarginWithinTotals(
    args.forecast.pmf,
    proposedMargin - args.forecast.expectedMarginHome,
  );
  const marginSummary = summarizePmf(marginPmf);
  const finalPmf = tiltCfbTotalWithinMargins(
    marginPmf,
    finalTotal - marginSummary.expectedTotal,
  );
  const summary = summarizePmf(finalPmf);
  return {
    forecast: { ...args.forecast, ...summary, pmf: finalPmf },
    marginShiftPoints: summary.expectedMarginHome - args.forecast.expectedMarginHome,
    totalShiftPoints: summary.expectedTotal - args.forecast.expectedTotal,
    totalSideFlipped,
    marginEvidenceAvailable,
    totalEvidenceAvailable,
  };
}

export function resolveCfbSupportAwareTotalFlip(args: {
  active: number;
  boundary: number;
  proposed: number;
  maximumChronologicalActiveMarketDistance: number;
}): number {
  const reflected = 2 * args.boundary - args.active;
  const activeMarketDistance = Math.abs(args.active - args.boundary);
  const support = args.maximumChronologicalActiveMarketDistance;
  if (activeMarketDistance <= support) return reflected;

  const proposedDirection = Math.sign(args.proposed - args.boundary);
  const supportedProposed = args.boundary + proposedDirection * Math.min(
    Math.abs(args.proposed - args.boundary),
    support,
  );
  const reflectionWeight = Math.exp(-(activeMarketDistance - support) / support);
  return reflectionWeight * reflected + (1 - reflectionWeight) * supportedProposed;
}

function assertArtifact(): void {
  if (
    ARTIFACT.release !== CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE ||
    ARTIFACT.games !== 301 ||
    !Number.isFinite(ARTIFACT.total.reflectionSupport.maximumChronologicalActiveMarketDistance) ||
    ARTIFACT.total.reflectionSupport.maximumChronologicalActiveMarketDistance <= 0 ||
    ARTIFACT.margin.model.beta.length !== ARTIFACT.margin.model.names.length + 1 ||
    ARTIFACT.total.model.beta.length !== ARTIFACT.total.model.names.length + 1
  ) {
    throw new Error("CFB complete market-reader artifact contract mismatch.");
  }
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

function reconciliationMarginFeatures(
  raw: Record<string, number>,
  activeMargin: number,
  independentMargin: number,
): Record<string, number> {
  const output = { ...raw };
  const legacyShift = activeMargin - independentMargin;
  output.active_margin = activeMargin;
  output.legacy_margin_shift = legacyShift;
  output.legacy_margin_shift_abs = Math.abs(legacyShift);
  output.legacy_moneyline_side_changed = Number(lineWinner(activeMargin, 0) !== lineWinner(independentMargin, 0));
  const current = output.spread_all_current_axis;
  if (current !== undefined) {
    output.active_market_disagreement = current - activeMargin;
    output.active_market_disagreement_abs = Math.abs(current - activeMargin);
    output.independent_market_disagreement_abs = Math.abs(current - independentMargin);
    output.legacy_market_distance_change = Math.abs(current - activeMargin) - Math.abs(current - independentMargin);
    output.legacy_spread_side_changed = Number(lineWinner(activeMargin, current) !== lineWinner(independentMargin, current));
    output.legacy_reflection_signature = legacyShift * (current - independentMargin);
  }
  return output;
}

function professionalReconciliationMarginFeatures(
  raw: Record<string, number>,
  activeMargin: number,
  independentMargin: number,
  observations: Observation[],
): Record<string, number> {
  const output = reconciliationMarginFeatures(raw, activeMargin, independentMargin);
  const moneylineReads = splitReads(observations, "moneyline");
  for (const provenance of ["named_sharp", "fallback", "public"] as const) {
    const selected = moneylineReads.filter((read) => read.provenance === provenance);
    const signed = average(selected.map((read) => signedSplit(read, "margin")));
    const signedMoneyMajority = average(selected.map((read) => {
      const positive = read.side === "second";
      return (positive ? 1 : -1) * (read.moneyPct - 50);
    }));
    const signedTicketMajority = average(selected.map((read) => {
      const positive = read.side === "second";
      return (positive ? 1 : -1) * (read.ticketsPct - 50);
    }));
    const acceleration = average(selected.flatMap((read) => read.moneyAccelerationPp === null
      ? []
      : [Math.sign(signedSplit(read, "margin")) * Math.abs(read.moneyAccelerationPp)]));
    if (signed !== null) output[`moneyline_split_${provenance}`] = signed;
    if (signedMoneyMajority !== null) output[`moneyline_split_${provenance}_money_majority`] = signedMoneyMajority;
    if (signedTicketMajority !== null) output[`moneyline_split_${provenance}_ticket_majority`] = signedTicketMajority;
    if (acceleration !== null) output[`moneyline_split_${provenance}_acceleration`] = acceleration;
    output[`moneyline_split_${provenance}_count`] = selected.length;
    const spreadSplit = output[`split_${provenance}`];
    if (signed !== null && spreadSplit !== undefined) {
      output[`cross_market_split_${provenance}_product`] = signed * spreadSplit;
      output[`cross_market_split_${provenance}_agreement`] = Math.sign(signed) === Math.sign(spreadSplit) ? 1 : -1;
    }
  }
  const spreadMove = output.spread_all_axis_move;
  const moneylineMove = output.moneyline_all_probability_move;
  if (spreadMove !== undefined && moneylineMove !== undefined) {
    output.cross_market_move_product = spreadMove * moneylineMove;
    output.cross_market_move_agreement = Math.sign(spreadMove) === Math.sign(moneylineMove) ? 1 : -1;
  }
  const currentSpread = output.spread_all_current_axis;
  if (currentSpread !== undefined) {
    output.short_spread_3 = Number(Math.abs(currentSpread) <= 3);
    output.short_spread_7 = Number(Math.abs(currentSpread) <= 7);
    if (moneylineMove !== undefined) {
      output.short_spread_3_moneyline_move = output.short_spread_3 * moneylineMove;
    }
    for (const provenance of ["named_sharp", "fallback", "public"] as const) {
      const moneylineSplit = output[`moneyline_split_${provenance}`];
      const spreadSplit = output[`split_${provenance}`];
      if (moneylineSplit !== undefined) {
        output[`short_spread_3_moneyline_split_${provenance}`] = output.short_spread_3 * moneylineSplit;
      }
      if (spreadSplit !== undefined) {
        output[`short_spread_3_spread_split_${provenance}`] = output.short_spread_3 * spreadSplit;
      }
    }
  }
  return output;
}

function constrainedMarketFeatures(raw: Record<string, number>, axis: Axis): Record<string, number> {
  const market = axis === "margin" ? "spread" : "total";
  const names = [
    axis === "margin" ? "independent_margin" : "independent_total",
    "independent_margin_abs",
    "both_fbs",
    "fbs_mismatch",
    "same_conference",
    "market_disagreement",
    "opening_disagreement",
    "market_path",
    `${market}_all_current_axis`,
    `${market}_all_axis_move`,
    `${market}_all_probability_move`,
    `${market}_all_reversal_count`,
    `${market}_all_late_6h_count`,
    `${market}_named_axis_move`,
    `${market}_named_probability_move`,
    `${market}_named_reversal_count`,
    `${market}_named_late_6h_count`,
    `${market}_retail_axis_move`,
    `${market}_retail_probability_move`,
    `${market}_retail_reversal_count`,
    `${market}_retail_late_6h_count`,
    "named_retail_axis_gap",
    "named_retail_move_product",
    "split_named_sharp",
    "split_named_sharp_money_majority",
    "split_named_sharp_ticket_majority",
    "split_named_sharp_acceleration",
    "split_named_sharp_path_alignment",
    "split_fallback",
    "split_fallback_money_majority",
    "split_fallback_ticket_majority",
    "split_fallback_acceleration",
    "split_fallback_path_alignment",
    "split_public",
    "split_public_money_majority",
    "split_public_ticket_majority",
    "split_public_acceleration",
    "split_public_path_alignment",
  ];
  return Object.fromEntries(names.flatMap((name) => raw[name] === undefined ? [] : [[name, raw[name]!]]));
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-Math.min(value, 35)));
  const exponential = Math.exp(Math.max(value, -35));
  return exponential / (1 + exponential);
}

function logit(value: number): number {
  const bounded = Math.min(1 - 1e-6, Math.max(1e-6, value));
  return Math.log(bounded / (1 - bounded));
}

function predictPosterior(model: RidgeModel, features: Record<string, number>): number {
  return sigmoid(model.beta[0]! + model.names.reduce((sum, name, index) =>
    sum + model.beta[index + 1]! *
      (((features[name] ?? model.means[index]!) - model.means[index]!) / model.scales[index]!), 0));
}

function posteriorResidualAxis(
  active: number,
  features: Record<string, number>,
  axis: Axis,
  model: RidgeModel,
  evidenceScale: number,
): number {
  const market = axis === "margin" ? "spread" : "total";
  const boundary = features[`${market}_all_current_axis`];
  if (boundary === undefined) return active;
  const alternative = 2 * boundary - active;
  const strength = Math.tanh(evidenceScale * (logit(predictPosterior(model, features)) - logit(model.prior)));
  return active + strength * (alternative - active);
}

function hasObservedMarketEvidence(features: Record<string, number>, market: Market): boolean {
  const movementKeys = [
    `${market}_all_axis_move`,
    `${market}_all_probability_move`,
    `${market}_named_axis_move`,
    `${market}_named_probability_move`,
    `${market}_retail_axis_move`,
    `${market}_retail_probability_move`,
  ];
  const sequenceKeys = [
    `${market}_all_reversal_count`,
    `${market}_named_reversal_count`,
    `${market}_retail_reversal_count`,
  ];
  const splitKeys = ["split_named_sharp", "split_fallback", "split_public"];
  return movementKeys.some((key) => Math.abs(features[key] ?? 0) > 1e-12) ||
    sequenceKeys.some((key) => (features[key] ?? 0) > 0) ||
    splitKeys.some((key) => features[key] !== undefined);
}

function hasObservedAxisEvidence(features: Record<string, number>, axis: Axis): boolean {
  return axis === "total"
    ? hasObservedMarketEvidence(features, "total")
    : hasObservedMarketEvidence(features, "spread") || hasObservedMarketEvidence(features, "moneyline");
}

function lineWinner(value: number, boundary: number): Side | "push" {
  const difference = value - boundary;
  return Math.abs(difference) < 1e-9 ? "push" : difference > 0 ? "first" : "second";
}
