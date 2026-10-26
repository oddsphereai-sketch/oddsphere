/**
 * SELECT-only chronological NFL unified market-interpreter tournament.
 *
 * This audit uses the frozen exact independent score replay as the prior and
 * the append-only forward market evidence as a time-ordered residual vector.
 * It never writes predictions, grades, locks, or production state.
 */

import { readFileSync } from "node:fs";

import { supabase } from "@/lib/db/supabase";
import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "@/lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "@/lib/services/football/nflForwardEvidenceStore";
import {
  buildNflMarketState,
  type NflMarketState,
  type NflMarketStateMarket,
} from "@/lib/services/football/nflMarketState";
import { resolveNflTargetExcludedMarketAnchor } from "@/lib/services/football/nflTargetExcludedMarketOutcome";

type Market = "moneyline" | "spread" | "total";
type Grade = { actual_home_score: number | null; actual_away_score: number | null };
type RecordRow = {
  id: number;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};
type ReplayScore = {
  date: string;
  home: string;
  away: string;
  expectedHomeScore: number;
  expectedAwayScore: number;
};
type FeatureRow = {
  gameId: string;
  game: string;
  scheduledStart: string;
  independentMargin: number;
  independentTotal: number;
  incumbentMargin: number;
  incumbentTotal: number;
  actualMargin: number;
  actualTotal: number;
  features: Record<string, number>;
};
type RidgeModel = {
  featureNames: string[];
  means: number[];
  scales: number[];
  coefficients: number[];
};

const RELEASE = "nfl_unified_market_interpreter_tournament_2026_10_25_r1";
const ALPHAS = [0.1, 1, 10, 100, 1_000] as const;
const MARGIN_FEATURE_GROUPS = {
  consensus: [
    "market_margin_gap", "spread_fair_home_centered",
    "market_margin_gap_x_family_depth",
  ],
  sequence: [
    "market_margin_gap", "spread_fair_home_centered",
    "market_margin_gap_x_family_depth", "market_margin_gap_x_persistence",
    "market_margin_gap_x_instability",
    "ml_named_probability_move", "ml_retail_probability_move",
    "spread_named_number_move", "spread_retail_number_move",
  ],
  complete: [
    "market_margin_gap", "spread_fair_home_centered",
    "market_margin_gap_x_family_depth", "market_margin_gap_x_persistence",
    "market_margin_gap_x_instability",
    "ml_named_probability_move", "ml_retail_probability_move",
    "spread_named_number_move", "spread_retail_number_move",
    "playbook_ml_gap", "sharp_ml_gap", "playbook_spread_gap", "sharp_spread_gap",
    "margin_flow_consensus", "margin_flow_x_market_direction",
  ],
  nonlinear: [
    "market_margin_gap_soft", "market_margin_gap_tail",
    "spread_fair_home_centered", "market_margin_gap_x_family_depth",
    "market_margin_gap_x_persistence", "market_margin_gap_x_instability",
    "market_margin_gap_x_flow_alignment", "market_margin_gap_x_movement_alignment",
    "ml_named_move_x_persistence", "spread_named_move_x_persistence",
  ],
} as const;

const TOTAL_FEATURE_GROUPS = {
  consensus: [
    "market_total_gap", "total_fair_over_centered", "total_family_count",
  ],
  sequence: [
    "market_total_gap", "total_fair_over_centered", "total_family_count",
    "total_named_number_move", "total_retail_number_move",
    "total_persistence", "total_reversal", "total_buyback_share",
  ],
  complete: [
    "market_total_gap", "total_fair_over_centered", "total_family_count",
    "total_named_number_move", "total_retail_number_move",
    "total_persistence", "total_reversal", "total_buyback_share",
    "playbook_total_gap", "sharp_total_gap", "total_signal_agreement", "hours_to_start",
  ],
} as const;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizeTeam(team: string): string {
  return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[team] ?? team;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function splitGap(payload: NflForwardEvidencePayload, market: Market, source: "playbook" | "sharp"): number {
  const split = source === "playbook" ? payload.market.playbookSplits?.[market] : payload.market.sharpApiSplits?.[market];
  if (!split) return 0;
  const money = market === "total" ? split.overMoneyPct : split.homeMoneyPct;
  const bets = market === "total" ? split.overBetsPct : split.homeBetsPct;
  return typeof money === "number" && typeof bets === "number" ? (money - bets) / 100 : 0;
}

function trailMean(state: NflMarketState, sourceClass: "named" | "retail", field: "fairProbabilityDeltaPp" | "numberDelta"): number {
  return mean(state.trails.filter((trail) => trail.sourceClass === sourceClass)
    .map((trail) => trail[field] ?? 0)) / (field === "fairProbabilityDeltaPp" ? 100 : 1);
}

function stateSummary(state: NflMarketState) {
  return {
    persistence: mean(state.trails.map((trail) => trail.persistenceTimeShare)),
    reversal: mean(state.trails.map((trail) => trail.reversalMagnitude)),
    buyback: state.trails.length === 0 ? 0 : state.trails.filter((trail) => trail.buybackToOpening).length / state.trails.length,
  };
}

function signalAgreement(values: readonly number[]): number {
  const directions = values.map(sign).filter((value) => value !== 0);
  return directions.length === 0 ? 0 : Math.abs(directions.reduce((sum, value) => sum + value, 0)) / directions.length;
}

function featureRow(args: {
  payload: NflForwardEvidencePayload;
  histories: NflForwardStoredEvidence[];
  independentMargin: number;
  independentTotal: number;
  actualHome: number;
  actualAway: number;
}): FeatureRow | null {
  const decisions = new Map(args.payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
  const moneylineBook = decisions.get("moneyline")?.evaluatedQuote.sportsbook;
  const spreadBook = decisions.get("spread")?.evaluatedQuote.sportsbook;
  const totalBook = decisions.get("total")?.evaluatedQuote.sportsbook;
  if (!moneylineBook || !spreadBook || !totalBook) return null;
  const marginExcluded = [...new Set([moneylineBook, spreadBook].map(normalizeBook))];
  const totalExcluded = [normalizeBook(totalBook)];
  const anchor = resolveNflTargetExcludedMarketAnchor({
    books: args.payload.market.comparableCurrentBooks,
    marginExcludedSportsbooks: marginExcluded,
    totalExcludedSportsbooks: totalExcluded,
    evaluatedAt: args.payload.capturedAt,
  });
  if (!anchor) return null;
  const snapshots = args.histories.flatMap((row) => row.payload.contextualEvidenceCapture
    ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
    : []);
  const state = (market: NflMarketStateMarket) => buildNflMarketState({
    market,
    evaluatedAt: args.payload.capturedAt,
    snapshots,
    excludedFamilies: market === "total" ? totalExcluded : marginExcluded,
    current: args.payload.market.current,
    playbookLine: args.payload.market.playbookLine,
    playbookSplits: args.payload.market.playbookSplits,
    sharpSplits: args.payload.market.sharpApiSplits,
  });
  const ml = state("moneyline");
  const spread = state("spread");
  const total = state("total");
  const mlSummary = stateSummary(ml);
  const spreadSummary = stateSummary(spread);
  const totalSummary = stateSummary(total);
  const playbookMl = splitGap(args.payload, "moneyline", "playbook");
  const sharpMl = splitGap(args.payload, "moneyline", "sharp");
  const playbookSpread = splitGap(args.payload, "spread", "playbook");
  const sharpSpread = splitGap(args.payload, "spread", "sharp");
  const playbookTotal = splitGap(args.payload, "total", "playbook");
  const sharpTotal = splitGap(args.payload, "total", "sharp");
  const marginGap = anchor.homeMargin - args.independentMargin;
  const totalGap = anchor.total - args.independentTotal;
  const marginPersistence = mean([mlSummary.persistence, spreadSummary.persistence]);
  const marginInstability = mean([
    mlSummary.reversal, spreadSummary.reversal, mlSummary.buyback, spreadSummary.buyback,
  ]);
  const marginFlowConsensus = median([playbookMl, sharpMl, playbookSpread, sharpSpread]);
  const namedMarginMovement = median([
    trailMean(ml, "named", "fairProbabilityDeltaPp") * 6,
    trailMean(spread, "named", "numberDelta"),
  ]);
  const softMarginGap = 3 * Math.tanh(marginGap / 3);
  const features = {
    market_margin_gap: marginGap,
    market_total_gap: totalGap,
    spread_fair_home_centered: anchor.spreadHomeFairProbability - 0.5,
    total_fair_over_centered: anchor.totalOverFairProbability - 0.5,
    margin_family_count: anchor.marginFamilyCount,
    total_family_count: anchor.totalFamilyCount,
    market_margin_gap_x_family_depth: marginGap * Math.min(1, anchor.marginFamilyCount / 5),
    market_margin_gap_x_persistence: marginGap * marginPersistence,
    market_margin_gap_x_instability: marginGap * marginInstability,
    market_margin_gap_soft: softMarginGap,
    market_margin_gap_tail: marginGap - softMarginGap,
    market_margin_gap_x_flow_alignment: marginGap * Math.tanh(4 * marginGap * marginFlowConsensus),
    market_margin_gap_x_movement_alignment: marginGap * Math.tanh(marginGap * namedMarginMovement),
    ml_named_probability_move: trailMean(ml, "named", "fairProbabilityDeltaPp"),
    ml_retail_probability_move: trailMean(ml, "retail", "fairProbabilityDeltaPp"),
    spread_named_number_move: trailMean(spread, "named", "numberDelta"),
    spread_retail_number_move: trailMean(spread, "retail", "numberDelta"),
    total_named_number_move: trailMean(total, "named", "numberDelta"),
    total_retail_number_move: trailMean(total, "retail", "numberDelta"),
    ml_persistence: mlSummary.persistence,
    spread_persistence: spreadSummary.persistence,
    total_persistence: totalSummary.persistence,
    ml_reversal: mlSummary.reversal,
    spread_reversal: spreadSummary.reversal,
    total_reversal: totalSummary.reversal,
    ml_buyback_share: mlSummary.buyback,
    spread_buyback_share: spreadSummary.buyback,
    total_buyback_share: totalSummary.buyback,
    playbook_ml_gap: playbookMl,
    sharp_ml_gap: sharpMl,
    playbook_spread_gap: playbookSpread,
    sharp_spread_gap: sharpSpread,
    playbook_total_gap: playbookTotal,
    sharp_total_gap: sharpTotal,
    margin_flow_consensus: marginFlowConsensus,
    margin_flow_x_market_direction: marginFlowConsensus * sign(marginGap),
    ml_named_move_x_persistence: trailMean(ml, "named", "fairProbabilityDeltaPp") * mlSummary.persistence,
    spread_named_move_x_persistence: trailMean(spread, "named", "numberDelta") * spreadSummary.persistence,
    margin_signal_agreement: signalAgreement([
      marginGap, trailMean(ml, "named", "fairProbabilityDeltaPp"),
      trailMean(spread, "named", "numberDelta"), playbookMl, sharpMl, playbookSpread, sharpSpread,
    ]),
    total_signal_agreement: signalAgreement([
      totalGap, trailMean(total, "named", "numberDelta"), playbookTotal, sharpTotal,
    ]),
    hours_to_start: Math.max(0, (Date.parse(args.payload.game.scheduledStart) - Date.parse(args.payload.capturedAt)) / 3_600_000),
  };
  return {
    gameId: args.payload.game.providerGameId,
    game: `${args.payload.game.away.abbreviation}@${args.payload.game.home.abbreviation}`,
    scheduledStart: args.payload.game.scheduledStart,
    independentMargin: args.independentMargin,
    independentTotal: args.independentTotal,
    incumbentMargin: args.payload.outcomeForecast.expectedHomeScore - args.payload.outcomeForecast.expectedAwayScore,
    incumbentTotal: args.payload.outcomeForecast.expectedHomeScore + args.payload.outcomeForecast.expectedAwayScore,
    actualMargin: args.actualHome - args.actualAway,
    actualTotal: args.actualHome + args.actualAway,
    features,
  };
}

function solve(matrix: number[][], vector: number[]): number[] {
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < augmented.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < augmented.length; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    if (Math.abs(divisor) < 1e-12) throw new Error("Singular ridge system.");
    for (let value = column; value <= augmented.length; value += 1) augmented[column]![value] /= divisor;
    for (let row = 0; row < augmented.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let value = column; value <= augmented.length; value += 1) {
        augmented[row]![value] -= factor * augmented[column]![value]!;
      }
    }
  }
  return augmented.map((row) => row.at(-1)!);
}

function fit(
  rows: readonly FeatureRow[],
  featureNames: readonly string[],
  target: "margin" | "total",
  alpha: number,
  intercept: boolean,
): RidgeModel {
  const means = featureNames.map((name) => mean(rows.map((row) => row.features[name] ?? 0)));
  const scales = featureNames.map((name, index) => {
    const variance = mean(rows.map((row) => ((row.features[name] ?? 0) - means[index]!) ** 2));
    return Math.sqrt(variance) || 1;
  });
  const x = rows.map((row) => [
    ...(intercept ? [1] : []),
    ...featureNames.map((name, index) => ((row.features[name] ?? 0) - means[index]!) / scales[index]!),
  ]);
  const y = rows.map((row) => target === "margin"
    ? row.actualMargin - row.independentMargin
    : row.actualTotal - row.independentTotal);
  const width = featureNames.length + (intercept ? 1 : 0);
  const gram = Array.from({ length: width }, (_, first) => Array.from({ length: width }, (_, second) =>
    x.reduce((sum, row) => sum + row[first]! * row[second]!, 0) +
      (first === second && (!intercept || first > 0) ? alpha : 0)));
  const rhs = Array.from({ length: width }, (_, column) => x.reduce((sum, row, index) => sum + row[column]! * y[index]!, 0));
  return {
    featureNames: [...featureNames], means, scales,
    coefficients: intercept ? solve(gram, rhs) : [0, ...solve(gram, rhs)],
  };
}

function correction(model: RidgeModel, row: FeatureRow): number {
  return model.coefficients[0]! + model.featureNames.reduce((sum, name, index) =>
    sum + model.coefficients[index + 1]! * ((row.features[name] ?? 0) - model.means[index]!) / model.scales[index]!, 0);
}

function metrics(rows: readonly FeatureRow[], marginModel: RidgeModel | null, totalModel: RidgeModel | null) {
  const scored = rows.map((row) => {
    const margin = row.independentMargin + (marginModel ? correction(marginModel, row) : 0);
    const total = row.independentTotal + (totalModel ? correction(totalModel, row) : 0);
    return { row, margin, total };
  });
  const resolvedWinners = scored.filter(({ row }) => row.actualMargin !== 0);
  return {
    games: rows.length,
    winnerAccuracy: resolvedWinners.length === 0 ? null : resolvedWinners.filter(({ row, margin }) => sign(margin) === sign(row.actualMargin)).length / resolvedWinners.length,
    marginMae: mean(scored.map(({ row, margin }) => Math.abs(margin - row.actualMargin))),
    totalMae: mean(scored.map(({ row, total }) => Math.abs(total - row.actualTotal))),
    meanAbsoluteMarginCorrection: mean(scored.map(({ row, margin }) => Math.abs(margin - row.independentMargin))),
    meanAbsoluteTotalCorrection: mean(scored.map(({ row, total }) => Math.abs(total - row.independentTotal))),
  };
}

function incumbentMetrics(rows: readonly FeatureRow[]) {
  const resolved = rows.filter((row) => row.actualMargin !== 0);
  return {
    games: rows.length,
    winnerAccuracy: resolved.length === 0 ? null : resolved.filter((row) => sign(row.incumbentMargin) === sign(row.actualMargin)).length / resolved.length,
    marginMae: mean(rows.map((row) => Math.abs(row.incumbentMargin - row.actualMargin))),
    totalMae: mean(rows.map((row) => Math.abs(row.incumbentTotal - row.actualTotal))),
  };
}

async function main() {
  const replayPath = process.argv.find((value) => value.startsWith("--exact-replay="))?.slice("--exact-replay=".length);
  if (!replayPath) throw new Error("Pass --exact-replay=<frozen replay.json>.");
  const replay = JSON.parse(readFileSync(replayPath, "utf8")) as {
    replayRelease: string;
    candidates: Record<string, { scores: ReplayScore[] }>;
  };
  const scores = replay.candidates.exactProviderTotalR10R11?.scores;
  if (!scores) throw new Error("Exact replay is missing exactProviderTotalR10R11.");
  const exactByGame = new Map(scores.map((score) => [
    `${score.date}:${normalizeTeam(score.away)}@${normalizeTeam(score.home)}`,
    {
      margin: score.expectedHomeScore - score.expectedAwayScore,
      total: score.expectedHomeScore + score.expectedAwayScore,
    },
  ]));
  const read = await supabase.from("prediction_records")
    .select("id,snapshot_json,prediction_grades(actual_home_score,actual_away_score)")
    .eq("sport", "nfl").not("locked_at", "is", null)
    .in("market", ["moneyline", "spread", "total"])
    .order("id", { ascending: true });
  if (read.error) throw new Error(read.error.message);
  const records = ((read.data ?? []) as unknown as RecordRow[]).filter((row) =>
    typeof row.snapshot_json?.supersedes_prediction_record_id !== "number");
  const recordByHash = new Map<string, RecordRow>();
  for (const record of records) {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    if (typeof hash === "string" && !recordByHash.has(hash)) recordByHash.set(hash, record);
  }
  const history: NflForwardStoredEvidence[] = [];
  for (const week of [1, 2, 3, 4, 5, 6, 7]) history.push(...await readNflForwardEvidence({ client: supabase, season: 2026, week }));
  const rows: FeatureRow[] = [];
  const hashes = [...recordByHash.keys()];
  for (let index = 0; index < hashes.length; index += 100) {
    const evidence = await supabase.from("nfl_forward_evidence_snapshots")
      .select("payload_sha256,payload").in("payload_sha256", hashes.slice(index, index + 100));
    if (evidence.error) throw new Error(evidence.error.message);
    for (const value of evidence.data ?? []) {
      const payload = value.payload as NflForwardEvidencePayload;
      if (hashNflForwardEvidencePayload(payload) !== value.payload_sha256) throw new Error(`Checksum mismatch ${value.payload_sha256}.`);
      const record = recordByHash.get(value.payload_sha256);
      const grade = one(record?.prediction_grades ?? null);
      if (!grade || typeof grade.actual_home_score !== "number" || typeof grade.actual_away_score !== "number") continue;
      const key = `${payload.game.scheduledStart.slice(0, 10)}:${normalizeTeam(payload.game.away.abbreviation)}@${normalizeTeam(payload.game.home.abbreviation)}`;
      const exact = exactByGame.get(key);
      if (!exact) continue;
      const feature = featureRow({
        payload,
        histories: history.filter((candidate) => candidate.providerGameId === payload.game.providerGameId && candidate.capturedAt <= payload.capturedAt),
        independentMargin: exact.margin,
        independentTotal: exact.total,
        actualHome: grade.actual_home_score,
        actualAway: grade.actual_away_score,
      });
      if (feature) rows.push(feature);
    }
  }
  rows.sort((left, right) => left.scheduledStart.localeCompare(right.scheduledStart) || left.gameId.localeCompare(right.gameId));
  const unique = [...new Map(rows.map((row) => [row.gameId, row])).values()];
  if (unique.length < 30) throw new Error(`Expected at least 30 complete feature rows; got ${unique.length}.`);
  const trainEnd = Math.floor(unique.length * 0.53);
  const selectionEnd = Math.floor(unique.length * 0.77);
  const training = unique.slice(0, trainEnd);
  const selection = unique.slice(trainEnd, selectionEnd);
  const confirmation = unique.slice(selectionEnd);
  const marginTournaments = Object.entries(MARGIN_FEATURE_GROUPS).flatMap(([group, names]) => ALPHAS.map((alpha) => {
    const marginModel = fit(training, names, "margin", alpha, false);
    return { group, alpha, selection: metrics(selection, marginModel, null) };
  }));
  const totalTournaments = Object.entries(TOTAL_FEATURE_GROUPS).flatMap(([group, names]) => ALPHAS.map((alpha) => {
    const totalModel = fit(training, names, "total", alpha, true);
    return { group, alpha, selection: metrics(selection, null, totalModel) };
  }));
  const selectedMargin = [...marginTournaments].sort((left, right) =>
    left.selection.marginMae - right.selection.marginMae ||
    (right.selection.winnerAccuracy ?? 0) - (left.selection.winnerAccuracy ?? 0) ||
    left.alpha - right.alpha)[0]!;
  const selectedTotal = [...totalTournaments].sort((left, right) =>
    left.selection.totalMae - right.selection.totalMae || left.alpha - right.alpha)[0]!;
  const marginNames = MARGIN_FEATURE_GROUPS[selectedMargin.group as keyof typeof MARGIN_FEATURE_GROUPS];
  const totalNames = TOTAL_FEATURE_GROUPS[selectedTotal.group as keyof typeof TOTAL_FEATURE_GROUPS];
  const fitRows = [...training, ...selection];
  const marginModel = fit(fitRows, marginNames, "margin", selectedMargin.alpha, false);
  const totalModel = fit(fitRows, totalNames, "total", selectedTotal.alpha, true);
  const baseline = metrics(confirmation, null, null);
  const incumbent = incumbentMetrics(confirmation);
  const candidate = metrics(confirmation, marginModel, totalModel);
  const changes = confirmation.flatMap((row) => {
    const nextMargin = row.independentMargin + correction(marginModel, row);
    if (sign(nextMargin) === sign(row.independentMargin)) return [];
    return [{
      game: row.game,
      fromWinner: sign(row.independentMargin),
      toWinner: sign(nextMargin),
      actualWinner: sign(row.actualMargin),
      correction: sign(row.independentMargin) !== sign(row.actualMargin) && sign(nextMargin) === sign(row.actualMargin),
      harm: sign(row.independentMargin) === sign(row.actualMargin) && sign(nextMargin) !== sign(row.actualMargin),
    }];
  });
  console.log(JSON.stringify({
    release: RELEASE,
    readOnly: true,
    writes: 0,
    exactReplayRelease: replay.replayRelease,
    coverage: { rows: unique.length, training: training.length, selection: selection.length, confirmation: confirmation.length },
    selected: { margin: selectedMargin, total: selectedTotal },
    confirmation: { independent: baseline, deployedStoredEra: incumbent, candidate },
    winnerChanges: {
      rows: changes,
      corrections: changes.filter((row) => row.correction).length,
      harms: changes.filter((row) => row.harm).length,
    },
    models: { margin: marginModel, total: totalModel },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
