/**
 * READ ONLY. Chronological, prior-only audit of pitcher strikeout opportunity/rate
 * candidates against immutable locked market and active-model probabilities.
 */
import { supabase } from "../../lib/db/supabase";
import { MLBStatsGameLogClient } from "../../lib/mlb/props/providerClients";
import type { MlbHistoricalStatRow } from "../../lib/mlb/props/providers";

type Raw = {
  id: number;
  slate_date: string;
  external_game_id: string;
  mlb_player_id: number;
  line: number;
  side: "over" | "under";
  locked_model_probability: number;
  locked_market_probability: number;
  locked_final_probability: number;
  result_status: "win" | "loss";
  result_value: number;
  metadata_json: Record<string, unknown> | null;
};
type Row = {
  date: string;
  gameId: string;
  playerId: number;
  line: number;
  overWon: number;
  marketOver: number;
  currentOver: number;
  weakPitcherBaseline: boolean;
  prior: MlbHistoricalStatRow[];
};
type Parameters = {
  recentStarts: number;
  priorBattersFaced: number;
  recentRateWeight: number;
  recentOpportunityWeight: number;
  concentration: number;
  independentWeight: number;
};

const DISCOVERY_THROUGH = "2026-07-21";
const VALIDATION_FROM = "2026-07-22";
const VALIDATION_THROUGH = "2026-07-25";
const HOLDOUT_FROM = "2026-07-26";

async function loadTracking(): Promise<Raw[]> {
  const output: Raw[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("mlb_prop_tracking_entries")
      .select("id,slate_date,external_game_id,mlb_player_id,line,side,locked_model_probability,locked_market_probability,locked_final_probability,result_status,result_value,metadata_json")
      .eq("market_key", "pitcher_strikeouts")
      .in("result_status", ["win", "loss"])
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    output.push(...(data ?? []));
    if ((data ?? []).length < 1000) return output;
  }
}

async function loadLogs(playerIds: number[]): Promise<Map<number, MlbHistoricalStatRow[]>> {
  const client = new MLBStatsGameLogClient();
  const output = new Map<number, MlbHistoricalStatRow[]>();
  let cursor = 0;
  async function worker() {
    while (cursor < playerIds.length) {
      const id = playerIds[cursor++]!;
      const rows = await client.getPlayerGameLogs({
        playerId: `mlbstats-player-${id}`,
        before: "2026-12-31",
        limit: 200,
      });
      output.set(id, rows);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, playerIds.length) }, worker));
  return output;
}

function buildRows(raw: Raw[], logs: Map<number, MlbHistoricalStatRow[]>): Row[] {
  const groups = new Map<string, Raw[]>();
  for (const row of raw) {
    if (row.metadata_json?.publicDisplayEnabledAtLock !== true) continue;
    if (row.side !== "over" && row.side !== "under") continue;
    if (![row.line, row.locked_model_probability, row.locked_market_probability, row.result_value]
      .every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    const key = `${row.slate_date}|${row.external_game_id}|${row.mlb_player_id}|${row.line}`;
    const values = groups.get(key) ?? [];
    values.push(row);
    groups.set(key, values);
  }
  const output: Row[] = [];
  for (const values of groups.values()) {
    const first = values[0]!;
    const prior = (logs.get(Number(first.mlb_player_id)) ?? [])
      .filter((log) => log.gameDate < first.slate_date)
      .sort((left, right) => right.gameDate.localeCompare(left.gameDate));
    if (prior.length < 10) continue;
    output.push({
      date: first.slate_date,
      gameId: String(first.external_game_id),
      playerId: Number(first.mlb_player_id),
      line: Number(first.line),
      overWon: Number(first.result_value > first.line),
      marketOver: mean(values.map((row) => sideToOver(row.side, row.locked_market_probability))),
      currentOver: mean(values.map((row) => sideToOver(row.side, row.locked_final_probability))),
      weakPitcherBaseline: values.some((row) =>
        Array.isArray(row.metadata_json?.modelInputWarnings)
        && row.metadata_json.modelInputWarnings.includes("weak_pitcher_baseline")),
      prior,
    });
  }
  return output.sort((left, right) => left.date.localeCompare(right.date));
}

function predictIndependent(row: Row, parameters: Parameters): number {
  const recent = row.prior.slice(0, parameters.recentStarts);
  const seasonStrikeouts = statSum(row.prior, "strikeouts");
  const seasonBattersFaced = statSum(row.prior, "batters_faced");
  const recentStrikeouts = statSum(recent, "strikeouts");
  const recentBattersFaced = statSum(recent, "batters_faced");
  if (seasonBattersFaced <= 0 || recentBattersFaced <= 0) return 0.5;
  const seasonRate = seasonStrikeouts / seasonBattersFaced;
  const recentPosterior = (recentStrikeouts + 0.225 * parameters.priorBattersFaced)
    / (recentBattersFaced + parameters.priorBattersFaced);
  const rate = clamp(
    seasonRate * (1 - parameters.recentRateWeight)
      + recentPosterior * parameters.recentRateWeight,
    0.05,
    0.45,
  );
  const seasonOpportunity = seasonBattersFaced / row.prior.length;
  const recentOpportunity = recentBattersFaced / recent.length;
  const opportunity = clamp(
    seasonOpportunity * (1 - parameters.recentOpportunityWeight)
      + recentOpportunity * parameters.recentOpportunityWeight,
    12,
    32,
  );
  const low = Math.floor(opportunity);
  const high = Math.ceil(opportunity);
  const highWeight = opportunity - low;
  const alpha = rate * parameters.concentration;
  const beta = (1 - rate) * parameters.concentration;
  const threshold = Math.floor(row.line);
  return clamp(
    betaBinomialOver(low, threshold, alpha, beta) * (1 - highWeight)
      + betaBinomialOver(high, threshold, alpha, beta) * highWeight,
  );
}

function predict(row: Row, parameters: Parameters): number {
  const independent = predictIndependent(row, parameters);
  return clamp(row.marketOver * (1 - parameters.independentWeight)
    + independent * parameters.independentWeight);
}

function candidates(): Parameters[] {
  const output: Parameters[] = [];
  for (const recentStarts of [5, 10, 15])
    for (const priorBattersFaced of [50, 100, 200])
      for (const recentRateWeight of [0.25, 0.5, 0.75])
        for (const recentOpportunityWeight of [0.25, 0.5, 0.75])
          for (const concentration of [50, 100, 200, 500])
            for (const independentWeight of [0.1, 0.25, 0.5, 0.75, 1]) {
              output.push({
                recentStarts,
                priorBattersFaced,
                recentRateWeight,
                recentOpportunityWeight,
                concentration,
                independentWeight,
              });
            }
  return output;
}

function metrics(rows: Row[], probability: (row: Row) => number) {
  if (!rows.length) return null;
  const scored = rows.map((row) => ({ row, probability: clamp(probability(row)) }));
  const confidence = scored.filter(({ probability }) => probability >= 0.55 || probability <= 0.45);
  const wins = confidence.filter(({ row, probability }) =>
    probability >= 0.5 ? row.overWon === 1 : row.overWon === 0).length;
  return {
    rows: rows.length,
    dates: new Set(rows.map((row) => row.date)).size,
    brier: round(mean(scored.map(({ row, probability }) => (probability - row.overWon) ** 2))),
    logLoss: round(mean(scored.map(({ row, probability }) =>
      -(row.overWon * Math.log(probability) + (1 - row.overWon) * Math.log(1 - probability))))),
    calibrationGap: round(mean(scored.map(({ row, probability }) => probability - row.overWon))),
    decisionsAt55: confidence.length,
    hitRateAt55: confidence.length ? round(wins / confidence.length) : null,
  };
}

async function main() {
  const raw = await loadTracking();
  const playerIds = [...new Set(raw.map((row) => Number(row.mlb_player_id)).filter(Number.isSafeInteger))];
  const logs = await loadLogs(playerIds);
  const rows = buildRows(raw, logs);
  const discovery = rows.filter((row) => row.date <= DISCOVERY_THROUGH);
  const validation = rows.filter((row) => row.date >= VALIDATION_FROM && row.date <= VALIDATION_THROUGH);
  const holdout = rows.filter((row) => row.date >= HOLDOUT_FROM);
  const tournament = candidates().map((parameters) => ({
    parameters,
    validation: metrics(validation, (row) => predict(row, parameters))!,
  })).sort((left, right) => left.validation.brier - right.validation.brier
    || left.validation.logLoss - right.validation.logLoss);
  const selected = tournament[0]!;
  console.log(JSON.stringify({
    methodology: {
      writesToProduction: false,
      leakageControl: "Official starter logs strictly before each locked slate date; immutable T-60 lines and probabilities.",
      selection: `grid selected only on ${VALIDATION_FROM}..${VALIDATION_THROUGH}; ${HOLDOUT_FROM}+ untouched until final evaluation`,
      excludedFromThisAudit: "Opponent and arsenal modifiers lack historically frozen feature snapshots and are not credited as validated.",
    },
    coverage: {
      trackingRows: raw.length,
      pitchers: playerIds.length,
      pitchersWithLogs: [...logs.values()].filter((value) => value.length).length,
      observations: rows.length,
      discovery: discovery.length,
      validation: validation.length,
      holdout: holdout.length,
    },
    selected,
    holdout: {
      market: metrics(holdout, (row) => row.marketOver),
      active: metrics(holdout, (row) => row.currentOver),
      challenger: metrics(holdout, (row) => predict(row, selected.parameters)),
      independentOnly: metrics(holdout, (row) => predictIndependent(row, selected.parameters)),
      weakPitcherBaseline: {
        rows: holdout.filter((row) => row.weakPitcherBaseline).length,
        market: metrics(holdout.filter((row) => row.weakPitcherBaseline), (row) => row.marketOver),
        active: metrics(holdout.filter((row) => row.weakPitcherBaseline), (row) => row.currentOver),
      },
      establishedPitcherBaseline: {
        rows: holdout.filter((row) => !row.weakPitcherBaseline).length,
        market: metrics(holdout.filter((row) => !row.weakPitcherBaseline), (row) => row.marketOver),
        active: metrics(holdout.filter((row) => !row.weakPitcherBaseline), (row) => row.currentOver),
      },
    },
    topFiveValidation: tournament.slice(0, 5),
  }, null, 2));
}

function sideToOver(side: "over" | "under", probability: number): number {
  return side === "over" ? probability : 1 - probability;
}
function statSum(rows: MlbHistoricalStatRow[], name: string): number {
  return rows.reduce((sum, row) => sum + (typeof row.stats[name] === "number" ? row.stats[name] : 0), 0);
}
function betaBinomialOver(trials: number, threshold: number, alpha: number, beta: number): number {
  if (threshold < 0) return 1;
  if (threshold >= trials) return 0;
  let cumulative = 0;
  for (let successes = 0; successes <= threshold; successes++) {
    cumulative += Math.exp(
      logGamma(trials + 1) - logGamma(successes + 1) - logGamma(trials - successes + 1)
      + logBeta(successes + alpha, trials - successes + beta) - logBeta(alpha, beta),
    );
  }
  return clamp(1 - cumulative);
}
function logBeta(alpha: number, beta: number): number {
  return logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
}
function logGamma(value: number): number {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let result = 0.9999999999998099;
  const shifted = value - 1;
  for (let index = 0; index < coefficients.length; index++) result += coefficients[index]! / (shifted + index + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(result);
}
function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function clamp(value: number, low = 0.001, high = 0.999): number {
  return Math.min(high, Math.max(low, value));
}
function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
