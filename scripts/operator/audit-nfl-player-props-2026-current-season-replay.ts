#!/usr/bin/env tsx

/** SELECT-only, release-separated replay of 2026 NFL player-props locked decisions. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import {
  readNflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonStat,
} from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";

loadEnvConfig(process.cwd());

type Decision = {
  gameId: string;
  providerPlayerId: string | null;
  playerName: string;
  market: string;
  line: number;
  side: "over" | "under" | "yes";
  projection: number;
  rawModelProbability: number;
  marketProbability: number;
  finalProbability: number;
  marketMovement: string;
  decisionRelease: string;
  projectionEvidence?: Record<string, unknown> | null;
  bookEvidence?: Array<{
    sportsbook?: string;
    americanPrice?: number;
    openingAmericanPrice?: number;
    openingLine?: number;
  }>;
  sportsbook: string;
  americanPrice: number;
};

type LedgerRow = {
  provider_game_id: string;
  provider_player_id: string | null;
  player_name: string;
  market: string;
  line: number;
  side: "over" | "under" | "yes";
  sportsbook: string;
  result: "pending" | "win" | "loss" | "push" | "void";
  actual_value: number | null;
  locked_at: string;
  decision_release: string;
  snapshot_json: { decision?: Decision };
};

type ReplayRow = {
  week: number;
  gameId: string;
  providerPlayerId: string | null;
  playerName: string;
  team: string | null;
  market: string;
  line: number;
  side: Decision["side"];
  sportsbook: string;
  decisionRelease: string;
  lockedAt: string;
  ledgerResult: LedgerRow["result"];
  actual: number;
  outcome: 0 | 1;
  raw: number | null;
  rawProvenance: "locked_independent" | "unavailable_market_dominant_point";
  marketProbability: number;
  final: number;
  independentProjection: number | null;
  publishedProjection: number | null;
  movement: string;
  openingLine: number | null;
  openingPrice: number | null;
  lockedPrice: number;
};

type ProbabilitySummary = {
  n: number;
  games: number;
  wins: number;
  accuracy: number | null;
  meanProbability: number | null;
  observedRate: number | null;
  calibrationGap: number | null;
  brier: number | null;
  logLoss: number | null;
};

const WEIGHTS = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1];

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const state = await readNflPlayerPropsCurrentSeasonState({ client, season: 2026 });
  if (!state || state.completeThroughWeek < 4) throw new Error("2026 current-season state is not complete through Week 4.");

  const { data, error } = await client.from("nfl_player_prop_records")
    .select("provider_game_id,provider_player_id,player_name,market,line,side,sportsbook,result,actual_value,locked_at,decision_release,snapshot_json")
    .order("locked_at", { ascending: true });
  if (error) throw new Error(`NFL player-props ledger read failed: ${error.message}`);
  const ledger = (data ?? []) as LedgerRow[];
  const indexed = indexState(state);
  const replay: ReplayRow[] = [];
  let malformedLockedPayloads = 0;
  let unmatchedOutcomes = 0;
  let researchMatchedPending = 0;
  let ledgerOutcomeDisagreements = 0;

  for (const row of ledger) {
    const decision = row.snapshot_json?.decision;
    if (!decision) { malformedLockedPayloads += 1; continue; }
    const game = indexed.games.get(row.provider_game_id);
    if (!game || game.week > 4) continue;
    const stat = findStat(indexed, row, decision);
    const actual = stat ? actualFor(row.market, stat) : finite(row.actual_value);
    if (actual === null) { unmatchedOutcomes += 1; continue; }
    const outcome = outcomeFor(row.side, Number(row.line), actual);
    if (outcome === null) continue;
    if (row.result === "pending") researchMatchedPending += 1;
    if ((row.result === "win" || row.result === "loss") && (row.result === "win") !== Boolean(outcome)) {
      ledgerOutcomeDisagreements += 1;
    }
    const evidence = decision.bookEvidence?.find((item) => item.sportsbook === row.sportsbook)
      ?? decision.bookEvidence?.[0];
    replay.push({
      week: game.week,
      gameId: row.provider_game_id,
      providerPlayerId: row.provider_player_id ?? decision.providerPlayerId,
      playerName: row.player_name,
      team: stat?.team ?? null,
      market: row.market,
      line: Number(row.line),
      side: row.side,
      sportsbook: row.sportsbook,
      decisionRelease: row.decision_release,
      lockedAt: row.locked_at,
      ledgerResult: row.result,
      actual,
      outcome,
      raw: decision.projectionEvidence?.source === "market_dominant_expected_starter"
        ? null
        : clampProbability(decision.rawModelProbability),
      rawProvenance: decision.projectionEvidence?.source === "market_dominant_expected_starter"
        ? "unavailable_market_dominant_point"
        : "locked_independent",
      marketProbability: clampProbability(decision.marketProbability),
      final: clampProbability(decision.finalProbability),
      independentProjection: independentProjection(decision),
      publishedProjection: finite(decision.projection),
      movement: decision.marketMovement ?? "unknown",
      openingLine: finite(evidence?.openingLine),
      openingPrice: finite(evidence?.openingAmericanPrice),
      lockedPrice: Number(decision.americanPrice),
    });
  }

  const canonical = canonicalize(replay);
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify({
      release: "nfl_player_props_2026_locked_replay_rows_2026_10_08_r1",
      readOnlySource: true,
      rows: canonical,
    }, null, 2) + "\n", "utf8");
  }
  const canonicalProbability = canonical.filter((row) => row.raw !== null);
  const probabilityBootstrap = clusterBootstrap(canonicalProbability, (rows) => {
    const raw = brier(rows, "raw");
    const market = brier(rows, "marketProbability");
    const final = brier(rows, "final");
    return [raw - final, raw - market];
  });
  const pointRows = canonical.filter((row) => row.independentProjection !== null && row.publishedProjection !== null);
  const pointBootstrap = clusterBootstrap(pointRows, (rows) => [
    mae(rows, "independentProjection") - mae(rows, "publishedProjection"),
  ]);
  const movementBootstrap = clusterBootstrap(canonical, (rows) => {
    const support = rows.filter((row) => movementSignal(row) === "supports_pick");
    const against = rows.filter((row) => movementSignal(row) === "against_pick");
    return [mean(support.map((row) => row.outcome)) - mean(against.map((row) => row.outcome))];
  });

  const report = {
    release: "nfl_player_props_2026_current_season_replay_2026_10_08_r1",
    readOnly: true,
    writes: 0,
    providerCalls: 0,
    scope: {
      season: 2026,
      completedThroughWeek: state.completeThroughWeek,
      completedGames: state.games.filter((game) => game.week <= 4).length,
      ledgerRecords: ledger.length,
      coveredGames: new Set(ledger.map((row) => row.provider_game_id)).size,
      outcomeMatchedExactRecords: replay.length,
      outcomeMatchedCanonicalScopes: canonical.length,
      exactIndependentProbabilityScopes: canonicalProbability.length,
      marketDominantRawProbabilityScopesExcluded: canonical.length - canonicalProbability.length,
      malformedLockedPayloads,
      unmatchedOutcomes,
      researchMatchedPending,
      ledgerOutcomeDisagreements,
      fullBoardRetention: {
        weeks1To3: "unavailable",
        week4: "available_as_separate_exact_board_replay",
        blendedIntoLedgerMetrics: false,
      },
    },
    archiveAggregateNotCurrentModelPerformance: summarize(canonical),
    exactLockedRecordView: summarize(replay),
    byWeek: groupSummary(canonical, (row) => String(row.week)),
    byMarket: groupSummary(canonical, (row) => row.market),
    byDecisionRelease: groupSummary(canonical, (row) => row.decisionRelease),
    movement: movementSummary(canonical),
    residualWeightDiagnosticInSample: Object.fromEntries(WEIGHTS.map((weight) => [weight.toFixed(2), probabilitySummary(
      canonicalProbability,
      (row) => residualProbability(row.marketProbability, Number(row.raw), weight),
    )])),
    gameClusterBootstrap95: {
      resamples: 4000,
      independentMinusFinalBrier: interval(probabilityBootstrap.map((row) => row[0]!)),
      independentMinusMarketBrier: interval(probabilityBootstrap.map((row) => row[1]!)),
      independentMinusPublishedPointMae: interval(pointBootstrap.map((row) => row[0]!)),
      movementSupportMinusAgainstWinRate: interval(movementBootstrap.map((row) => row[0]!).filter(Number.isFinite)),
    },
    interpretationContract: {
      probabilityDirectionallySupported: false,
      productionPromotionAuthorized: false,
      reason: "Four completed weeks are diagnostic and any residual weight selected here would be evaluated in-sample; an untouched later confirmation window is required.",
    },
  };
  const raw = report.archiveAggregateNotCurrentModelPerformance.probability.raw.brier;
  const market = report.archiveAggregateNotCurrentModelPerformance.probability.market.brier;
  const final = report.archiveAggregateNotCurrentModelPerformance.probability.final.brier;
  const rawFinalInterval = report.gameClusterBootstrap95.independentMinusFinalBrier;
  const rawMarketInterval = report.gameClusterBootstrap95.independentMinusMarketBrier;
  report.interpretationContract.probabilityDirectionallySupported = raw !== null && market !== null && final !== null
    && rawFinalInterval.upper !== null && rawMarketInterval.upper !== null
    && raw < market && raw < final && rawFinalInterval.upper < 0 && rawMarketInterval.upper < 0;
  console.log(JSON.stringify(report, null, 2));
}

function summarize(rows: ReplayRow[]) {
  const probabilityRows = rows.filter((row) => row.raw !== null);
  return {
    records: rows.length,
    games: new Set(rows.map((row) => row.gameId)).size,
    probability: {
      excludedMarketDominantRawRows: rows.length - probabilityRows.length,
      raw: probabilitySummary(probabilityRows, (row) => Number(row.raw)),
      market: probabilitySummary(probabilityRows, (row) => row.marketProbability),
      final: probabilitySummary(probabilityRows, (row) => row.final),
      allPublishedRows: probabilitySummary(rows, (row) => row.final),
    },
    point: pointSummary(rows),
  };
}

function groupSummary(rows: ReplayRow[], key: (row: ReplayRow) => string) {
  const values = [...new Set(rows.map(key))].sort();
  return Object.fromEntries(values.map((value) => [value, summarize(rows.filter((row) => key(row) === value))]));
}

function probabilitySummary(rows: ReplayRow[], probability: (row: ReplayRow) => number): ProbabilitySummary {
  if (!rows.length) return { n: 0, games: 0, wins: 0, accuracy: null, meanProbability: null, observedRate: null, calibrationGap: null, brier: null, logLoss: null };
  const probabilities = rows.map(probability);
  const observed = mean(rows.map((row) => row.outcome));
  const expected = mean(probabilities);
  return {
    n: rows.length,
    games: new Set(rows.map((row) => row.gameId)).size,
    wins: rows.reduce((sum, row) => sum + row.outcome, 0),
    accuracy: observed,
    meanProbability: expected,
    observedRate: observed,
    calibrationGap: Math.abs(expected - observed),
    brier: mean(rows.map((row, index) => (probabilities[index]! - row.outcome) ** 2)),
    logLoss: mean(rows.map((row, index) => {
      const p = clampProbability(probabilities[index]!);
      return -(row.outcome * Math.log(p) + (1 - row.outcome) * Math.log(1 - p));
    })),
  };
}

function pointSummary(rows: ReplayRow[]) {
  const values = rows.filter((row) => row.independentProjection !== null && row.publishedProjection !== null);
  if (!values.length) return { n: 0, games: 0 };
  return {
    n: values.length,
    games: new Set(values.map((row) => row.gameId)).size,
    independent: pointMetrics(values, "independentProjection"),
    published: pointMetrics(values, "publishedProjection"),
    offeredLineDescriptiveBenchmark: pointMetrics(values, "line"),
  };
}

function pointMetrics(rows: ReplayRow[], field: "independentProjection" | "publishedProjection" | "line") {
  const errors = rows.map((row) => Number(row[field]) - row.actual);
  const directionCorrect = field === "line" ? null : mean(rows.map((row) => {
    const projection = Number(row[field]);
    const predicted = projection > row.line ? "over" : projection < row.line ? "under" : "push";
    const actual = row.actual > row.line ? "over" : row.actual < row.line ? "under" : "push";
    return Number(predicted === actual);
  }));
  return {
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((error) => error ** 2))),
    bias: mean(errors),
    directionAccuracy: directionCorrect,
  };
}

function movementSummary(rows: ReplayRow[]) {
  const withOpening = rows.filter((row) => row.openingLine !== null || row.openingPrice !== null);
  const classified = withOpening.map((row) => ({ row, signal: movementSignal(row) }));
  return {
    storedClassification: groupSummary(rows, (row) => row.movement),
    sameBookOpeningCoverage: {
      records: withOpening.length,
      line: withOpening.filter((row) => row.openingLine !== null).length,
      price: withOpening.filter((row) => row.openingPrice !== null).length,
    },
    measuredSignal: Object.fromEntries(["supports_pick", "against_pick", "mixed_or_neutral"].map((signal) => [
      signal,
      summarize(classified.filter((item) => item.signal === signal).map((item) => item.row)),
    ])),
    sharpBookClaimAuthorized: false,
  };
}

function movementSignal(row: ReplayRow): string {
  const lineSignal = row.openingLine === null ? 0
    : row.side === "over" ? Math.sign(row.openingLine - row.line)
      : row.side === "under" ? Math.sign(row.line - row.openingLine) : 0;
  const priceSignal = row.openingPrice === null ? 0
    : Math.sign(americanImplied(row.lockedPrice) - americanImplied(row.openingPrice));
  if (lineSignal === 0 && priceSignal === 0) return "mixed_or_neutral";
  if (lineSignal >= 0 && priceSignal >= 0) return "supports_pick";
  if (lineSignal <= 0 && priceSignal <= 0) return "against_pick";
  return "mixed_or_neutral";
}

function canonicalize(rows: ReplayRow[]): ReplayRow[] {
  const grouped = new Map<string, ReplayRow[]>();
  for (const row of rows) {
    const key = [row.gameId, normalize(row.playerName), row.market, row.line, row.side].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.values()].map((values) => values.slice().sort((a, b) => a.sportsbook.localeCompare(b.sportsbook))[0]!);
}

function indexState(state: NflPlayerPropsCurrentSeasonState) {
  return {
    games: new Map(state.games.map((game) => [game.gameId, game])),
    byId: new Map(state.stats.map((stat) => [`${stat.gameId}|${stat.playerId}`, stat])),
    byName: new Map(state.stats.map((stat) => [`${stat.gameId}|${normalize(stat.playerName)}`, stat])),
  };
}

function findStat(indexed: ReturnType<typeof indexState>, row: LedgerRow, decision: Decision) {
  const id = row.provider_player_id ?? decision.providerPlayerId;
  return (id ? indexed.byId.get(`${row.provider_game_id}|${id}`) : undefined)
    ?? indexed.byName.get(`${row.provider_game_id}|${normalize(row.player_name)}`);
}

function actualFor(market: string, stat: NflPlayerPropsCurrentSeasonStat): number | null {
  if (market === "anytime_td") return stat.rushing_touchdowns + stat.receiving_touchdowns
    + stat.kick_return_touchdowns + stat.punt_return_touchdowns + stat.fumbles_touchdowns;
  const value = stat[market as keyof NflPlayerPropsCurrentSeasonStat];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function outcomeFor(side: Decision["side"], line: number, actual: number): 0 | 1 | null {
  if (side === "yes") return actual >= 1 ? 1 : 0;
  if (actual === line) return null;
  return side === "over" ? actual > line ? 1 : 0 : actual < line ? 1 : 0;
}

function independentProjection(decision: Decision): number | null {
  const evidence = decision.projectionEvidence ?? {};
  return finite(evidence.independentProjection) ?? finite(evidence.roleProjection);
}

function residualProbability(market: number, independent: number, weight: number): number {
  const marketLogit = logit(market);
  return logistic(marketLogit + weight * (logit(independent) - marketLogit));
}

function brier(rows: ReplayRow[], field: "raw" | "marketProbability" | "final"): number {
  return mean(rows.map((row) => (Number(row[field]) - row.outcome) ** 2));
}

function mae(rows: ReplayRow[], field: "independentProjection" | "publishedProjection"): number {
  return mean(rows.map((row) => Math.abs(Number(row[field]) - row.actual)));
}

function clusterBootstrap(rows: ReplayRow[], statistic: (sample: ReplayRow[]) => number[], resamples = 4000): number[][] {
  if (!rows.length) return [];
  const games = [...new Set(rows.map((row) => row.gameId))];
  const byGame = new Map(games.map((game) => [game, rows.filter((row) => row.gameId === game)]));
  const random = seededRandom(20261008);
  const output: number[][] = [];
  for (let iteration = 0; iteration < resamples; iteration += 1) {
    const sample: ReplayRow[] = [];
    for (let index = 0; index < games.length; index += 1) {
      const game = games[Math.floor(random() * games.length)]!;
      sample.push(...(byGame.get(game) ?? []));
    }
    output.push(statistic(sample));
  }
  return output;
}

function interval(values: number[]) {
  if (!values.length) return { lower: null, median: null, upper: null };
  const sorted = values.slice().sort((a, b) => a - b);
  return { lower: quantile(sorted, 0.025), median: quantile(sorted, 0.5), upper: quantile(sorted, 0.975) };
}

function quantile(sorted: number[], probability: number): number {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower]! + fraction * ((sorted[lower + 1] ?? sorted[lower]!) - sorted[lower]!);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function americanImplied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function logit(value: number): number { const p = clampProbability(value); return Math.log(p / (1 - p)); }
function logistic(value: number): number { return 1 / (1 + Math.exp(-value)); }
function clampProbability(value: number): number { return Math.min(1 - 1e-9, Math.max(1e-9, Number(value))); }
function finite(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function normalize(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, ""); }

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
