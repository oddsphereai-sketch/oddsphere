/**
 * READ ONLY. Market-by-market player-prop feature/weight tournament.
 *
 * Uses immutable T-60 tracking rows and official MLB game logs strictly before
 * each slate date. Candidate selection uses validation only; the August window
 * remains untouched until the final report.
 */
import { supabase } from "../../lib/db/supabase";
import { MLBStatsGameLogClient } from "../../lib/mlb/props/providerClients";
import type { MlbHistoricalStatRow } from "../../lib/mlb/props/providers";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Raw = {
  id: number;
  slate_date: string;
  external_game_id: string;
  mlb_player_id: number;
  market_key: string;
  side: "over" | "under";
  line: number;
  locked_american_odds: number;
  locked_market_probability: number;
  locked_final_probability: number;
  result_status: "win" | "loss";
  result_value: number;
  tracking_cohort: string;
  metadata_json: Record<string, unknown> | null;
};

type Observation = {
  key: string;
  date: string;
  gameId: string;
  playerId: number;
  market: string;
  line: number;
  actual: number;
  outcomeOver: number;
  marketOver: number;
  currentOver: number;
  bestOverOdds: number | null;
  bestUnderOdds: number | null;
  prior: MlbHistoricalStatRow[];
  features: number[];
  hasFrozenContext: boolean;
  context: Record<string, unknown> | null;
  currentActionSide: "over" | "under" | null;
  currentActionOdds: number | null;
};

type Candidate = {
  name: string;
  predict: (row: Observation) => number;
};

const DISCOVERY_THROUGH = "2026-07-23";
const VALIDATION_FROM = "2026-07-24";
const VALIDATION_THROUGH = "2026-07-31";
const HOLDOUT_FROM = "2026-08-01";
const LOG_CACHE = "/private/tmp/oddsphere-all-market-feature-log-cache.json";
const CONTEXT_CACHE = "/private/tmp/oddsphere-mlb-props-locked-feature-context.json";
const REPORT_PATH = "/private/tmp/oddsphere-all-market-feature-tournament.json";

const STAT_KEY: Record<string, string> = {
  pitcher_strikeouts: "strikeouts",
  pitcher_outs: "outs",
  pitcher_hits_allowed: "hits_allowed",
  pitcher_walks: "walks",
  pitcher_earned_runs: "earned_runs",
  batter_strikeouts: "strikeouts",
  batter_hits: "hits",
  batter_total_bases: "total_bases",
  batter_home_runs: "home_runs",
  batter_rbis: "rbis",
  batter_runs_scored: "runs",
  batter_hits_runs_rbis: "hits_runs_rbis",
  batter_singles: "singles",
  batter_doubles: "doubles",
  batter_triples: "triples",
  batter_walks: "walks",
  batter_stolen_bases: "stolen_bases",
};

async function loadTracking(): Promise<Raw[]> {
  const output: Raw[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("mlb_prop_tracking_entries")
      .select([
        "id", "slate_date", "external_game_id", "mlb_player_id", "market_key",
        "side", "line", "locked_american_odds", "locked_market_probability",
        "locked_final_probability", "result_status", "result_value",
        "tracking_cohort", "metadata_json",
      ].join(","))
      .in("result_status", ["win", "loss"])
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as unknown as Raw[]));
    if ((data ?? []).length < 1000) return output;
  }
}

async function loadLogs(raw: Raw[]): Promise<Map<string, MlbHistoricalStatRow[]>> {
  const client = new MLBStatsGameLogClient();
  const identities = [...new Map(raw
    .filter((row) => STAT_KEY[row.market_key])
    .map((row) => [`${row.market_key.startsWith("pitcher_") ? "pitcher" : "batter"}|${row.mlb_player_id}`, {
      family: row.market_key.startsWith("pitcher_") ? "pitcher" : "batter",
      playerId: Number(row.mlb_player_id),
    }])).values()];
  const cached = existsSync(LOG_CACHE)
    ? JSON.parse(readFileSync(LOG_CACHE, "utf8")) as Record<string, MlbHistoricalStatRow[]>
    : {};
  const output = new Map<string, MlbHistoricalStatRow[]>(Object.entries(cached));
  const missing = identities.filter((identity) => !output.has(`${identity.family}|${identity.playerId}`));
  let cursor = 0;
  async function worker() {
    while (cursor < missing.length) {
      const identity = missing[cursor++]!;
      const rows = identity.family === "pitcher"
        ? await client.getPlayerGameLogs({ playerId: `mlbstats-player-${identity.playerId}`, before: "2026-12-31", limit: 200 })
        : await client.getHitterGameLogs({ playerId: `mlbstats-player-${identity.playerId}`, before: "2026-12-31", limit: 200 });
      output.set(`${identity.family}|${identity.playerId}`, rows);
    }
  }
  await Promise.all(Array.from({ length: Math.min(12, missing.length) }, worker));
  writeFileSync(LOG_CACHE, JSON.stringify(Object.fromEntries(output)));
  return output;
}

function buildObservations(raw: Raw[], logs: Map<string, MlbHistoricalStatRow[]>, contexts: Record<string, Record<string, unknown>>): Observation[] {
  const groups = new Map<string, Raw[]>();
  for (const row of raw) {
    if (row.metadata_json?.publicDisplayEnabledAtLock !== true || !STAT_KEY[row.market_key]) continue;
    if (![row.line, row.locked_market_probability, row.locked_final_probability, row.result_value, row.locked_american_odds]
      .every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    const key = `${row.slate_date}|${row.external_game_id}|${row.mlb_player_id}|${row.market_key}|${row.line}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const output: Observation[] = [];
  for (const [key, rows] of groups) {
    const row = rows[0]!;
    const family = row.market_key.startsWith("pitcher_") ? "pitcher" : "batter";
    const prior = (logs.get(`${family}|${row.mlb_player_id}`) ?? [])
      .filter((log) => log.gameDate < row.slate_date)
      .sort((left, right) => right.gameDate.localeCompare(left.gameDate));
    const statKey = STAT_KEY[row.market_key]!;
    const values = prior.map((log) => numeric(log.stats[statKey])).filter((value): value is number => value !== null);
    if (values.length < 5) continue;
    const marketOver = mean(rows.map((item) => toOver(item.side, item.locked_market_probability)));
    const currentOver = mean(rows.map((item) => toOver(item.side, item.locked_final_probability)));
    const dateMs = Date.parse(`${row.slate_date}T12:00:00Z`);
    const priorMs = Date.parse(`${prior[0]!.gameDate}T12:00:00Z`);
    const daysRest = Number.isFinite(dateMs - priorMs) ? Math.max(0, Math.min(15, (dateMs - priorMs) / 86_400_000)) : 3;
    const context = contexts[key];
    const currentAction = rows.filter((item) => item.tracking_cohort === "actionable")
      .sort((left, right) => right.locked_final_probability - left.locked_final_probability)[0] ?? null;
    output.push({
      key,
      date: row.slate_date,
      gameId: row.external_game_id,
      playerId: Number(row.mlb_player_id),
      market: row.market_key,
      line: Number(row.line),
      actual: Number(row.result_value),
      outcomeOver: Number(row.result_value > row.line),
      marketOver,
      currentOver,
      bestOverOdds: bestOdds(rows.filter((item) => item.side === "over").map((item) => item.locked_american_odds)),
      bestUnderOdds: bestOdds(rows.filter((item) => item.side === "under").map((item) => item.locked_american_odds)),
      prior,
      features: [...featureVector(values, row.line, daysRest), ...contextFeatureVector(row.market_key, context)],
      hasFrozenContext: Boolean(context),
      context: context ?? null,
      currentActionSide: currentAction?.side ?? null,
      currentActionOdds: currentAction ? bestOdds(rows.filter((item) => item.side === currentAction.side).map((item) => item.locked_american_odds)) : null,
    });
  }
  return output.sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key));
}

function contextFeatureVector(market: string, context: Record<string, unknown> | undefined): number[] {
  const get = (key: string) => numeric(context?.[key]);
  const normalized = (key: string, center = 0, scale = 1) => {
    const current = get(key);
    return [current === null ? 0 : (current - center) / scale, Number(current === null)];
  };
  const common = [
    context?.homeAway === "home" ? 1 : context?.homeAway === "away" ? -1 : 0,
    context?.lineupStatus === "confirmed" ? 1 : 0,
    ...normalized("parkRunFactor", 0, 0.1),
    ...normalized("parkHomeRunFactor", 0, 0.1),
    ...normalized("parkStrikeoutFactor", 0, 0.1),
    ...normalized("temperatureF", 70, 15),
    ...normalized("windSpeedMph", 8, 8),
    ...normalized("precipitationProbability", 10, 25),
  ];
  if (market.startsWith("pitcher_")) return [
    ...common,
    ...normalized("opponentStrikeoutRateDelta", 0, 0.03),
    ...normalized("opponentWalkRateDelta", 0, 0.02),
    ...normalized("opponentBattingAverageDelta", 0, 0.025),
    ...normalized("opponentOpsDelta", 0, 0.08),
    ...normalized("opponentHomeRunRateDelta", 0, 0.01),
    ...normalized("arsenalPitchesTrackedLog", 6.5, 1.5),
    ...normalized("arsenalWhiffPercent", 25, 8),
    ...normalized("arsenalChasePercent", 30, 8),
    ...normalized("arsenalZonePercent", 45, 8),
    ...normalized("arsenalBattingAverageAllowed", 0.245, 0.06),
    ...normalized("arsenalXwobaAllowed", 0.32, 0.07),
  ];
  return [
    ...common,
    ...normalized("battingOrder", 5, 3),
    ...normalized("pitchMatchupCoverage", 75, 25),
    ...normalized("pitchMatchupPitchesSeenLog", 6, 1.5),
    ...normalized("pitchMatchupBattingAverage", 0.245, 0.07),
    ...normalized("pitchMatchupSlugging", 0.41, 0.14),
    ...normalized("pitchMatchupXwoba", 0.32, 0.08),
    ...normalized("pitchMatchupWhiffPercent", 25, 10),
    ...normalized("matchupPlateAppearancesLog", 2, 1.5),
    ...normalized("matchupBattingAverage", 0.245, 0.15),
    ...normalized("matchupOnBasePercentage", 0.32, 0.15),
    ...normalized("matchupSluggingPercentage", 0.41, 0.25),
    ...normalized("matchupOps", 0.73, 0.35),
    ...normalized("matchupStrikeoutRate", 0.22, 0.18),
    ...normalized("matchupWalkRate", 0.09, 0.12),
    ...normalized("matchupHomeRunRate", 0.03, 0.08),
  ];
}

function featureVector(values: number[], line: number, daysRest: number): number[] {
  const last5 = values.slice(0, 5);
  const last10 = values.slice(0, 10);
  const last20 = values.slice(0, 20);
  const season = values.slice(0, 80);
  return [
    mean(last5) - line,
    mean(last10) - line,
    mean(last20) - line,
    mean(season) - line,
    survival(last5, line) - 0.5,
    survival(last10, line) - 0.5,
    survival(last20, line) - 0.5,
    standardDeviation(last20),
    mean(last5) - mean(last20),
    Math.log1p(season.length),
    daysRest,
    line,
  ];
}

function buildCandidates(discovery: Observation[], validation: Observation[]): { candidates: Candidate[]; selectedRidge: Candidate[] } {
  const candidates: Candidate[] = [
    { name: "market", predict: (row) => row.marketOver },
    { name: "current", predict: (row) => row.currentOver },
  ];
  for (const window of [5, 10, 20, 80]) {
    for (const priorStrength of [2, 5, 10, 20]) {
      for (const marketWeight of [0, 0.25, 0.5, 0.75, 0.9]) {
        candidates.push({
          name: `survival_w${window}_p${priorStrength}_m${marketWeight}`,
          predict: (row) => {
            const values = statValues(row).slice(0, window);
            const empirical = (values.filter((value) => value > row.line).length + priorStrength * 0.5)
              / (values.length + priorStrength);
            return clamp(empirical * (1 - marketWeight) + row.marketOver * marketWeight);
          },
        });
      }
    }
  }
  for (const w5 of [0, 0.2, 0.4]) for (const w10 of [0.2, 0.4, 0.6]) {
    if (w5 + w10 > 0.8) continue;
    for (const marketWeight of [0, 0.25, 0.5, 0.75]) {
      candidates.push({
        name: `poisson_l5_${w5}_l10_${w10}_m${marketWeight}`,
        predict: (row) => {
          const values = statValues(row);
          const season = mean(values.slice(0, 80));
          const expected = Math.max(0.001,
            mean(values.slice(0, 5)) * w5
            + mean(values.slice(0, 10)) * w10
            + season * (1 - w5 - w10));
          const independent = poissonOver(expected, row.line);
          return clamp(independent * (1 - marketWeight) + row.marketOver * marketWeight);
        },
      });
    }
  }
  const selectedRidge: Candidate[] = [];
  for (const mode of ["independent", "market_plus"] as const) {
    const fitted = [1, 20, 100].map((lambda) => {
      const model = fitLogistic(discovery, mode, lambda);
      const candidate = { name: `ridge_${mode}_l${lambda}`, predict: model.predict };
      return { candidate, validation: metrics(validation, candidate.predict)! };
    }).sort(compareMetrics)[0];
    if (fitted) selectedRidge.push(fitted.candidate);
  }
  return { candidates, selectedRidge };
}

function fitLogistic(rows: Observation[], mode: "independent" | "market_plus", lambda: number) {
  const raw = (row: Observation) => mode === "market_plus"
    ? [logit(row.marketOver), ...row.features]
    : row.features;
  const width = raw(rows[0]!).length;
  const means = Array.from({ length: width }, (_, index) => mean(rows.map((row) => raw(row)[index]!)));
  const scales = Array.from({ length: width }, (_, index) => standardDeviation(rows.map((row) => raw(row)[index]!)) || 1);
  const vector = (row: Observation) => [1, ...raw(row).map((value, index) => (value - means[index]!) / scales[index]!)];
  let coefficients = Array(width + 1).fill(0);
  for (let iteration = 0; iteration < 1200; iteration++) {
    const gradient = Array(coefficients.length).fill(0);
    for (const row of rows) {
      const x = vector(row);
      const predicted = sigmoid(dot(coefficients, x));
      for (let index = 0; index < coefficients.length; index++) {
        gradient[index] += (predicted - row.outcomeOver) * x[index]!;
      }
    }
    for (let index = 1; index < coefficients.length; index++) gradient[index] += lambda * coefficients[index]!;
    const next = coefficients.map((value, index) => value - 0.12 * gradient[index]! / rows.length);
    const change = Math.max(...next.map((value, index) => Math.abs(value - coefficients[index]!)));
    coefficients = next;
    if (change < 1e-7) break;
  }
  return { predict: (row: Observation) => clamp(sigmoid(dot(coefficients, vector(row)))) };
}

function evaluateMarket(rows: Observation[]) {
  const discovery = rows.filter((row) => row.date <= DISCOVERY_THROUGH);
  const validation = rows.filter((row) => row.date >= VALIDATION_FROM && row.date <= VALIDATION_THROUGH);
  const holdout = rows.filter((row) => row.date >= HOLDOUT_FROM);
  if (discovery.length < 40 || validation.length < 25 || holdout.length < 25) {
    return { status: "insufficient_chronological_coverage", counts: { discovery: discovery.length, validation: validation.length, holdout: holdout.length } };
  }
  const { candidates, selectedRidge } = buildCandidates(discovery, validation);
  const selectedSimple = candidates
    .filter((candidate) => candidate.name !== "market" && candidate.name !== "current")
    .map((candidate) => ({ candidate, validation: metrics(validation, candidate.predict)! }))
    .sort(compareMetrics)[0]!;
  const ridgeNames = new Set(selectedRidge.map((candidate) => candidate.name));
  const finalists = [selectedSimple.candidate, ...selectedRidge];
  const selected = finalists.map((candidate) => ({ candidate, validation: metrics(validation, candidate.predict)! }))
    .sort(compareMetrics)[0]!;
  const holdoutMetrics = {
    market: metrics(holdout, (row) => row.marketOver)!,
    current: metrics(holdout, (row) => row.currentOver)!,
    challenger: metrics(holdout, selected.candidate.predict)!,
  };
  const finalistComparison = Object.fromEntries(finalists.map((candidate) => [candidate.name, {
    validation: metrics(validation, candidate.predict),
    holdout: metrics(holdout, candidate.predict),
    bootstrap: dateBlockBootstrapComparison(holdout, candidate.predict, 2_000),
    action: (() => {
      const policy = selectActionPolicy(validation, candidate.predict);
      return policy ? {
        policy,
        validation: actionMetrics(validation, candidate.predict, policy),
        holdout: actionMetrics(holdout, candidate.predict, policy),
        holdoutAudit: actionAudit(holdout, candidate.predict, policy),
      } : null;
    })(),
  }]));
  const bootstrap = dateBlockBootstrapComparison(holdout, selected.candidate.predict, 2_000);
  const actionPolicy = selectActionPolicy(validation, selected.candidate.predict);
  const validationActions = actionPolicy ? actionMetrics(validation, selected.candidate.predict, actionPolicy) : null;
  const holdoutActions = actionPolicy ? actionMetrics(holdout, selected.candidate.predict, actionPolicy) : null;
  const holdoutActionAudit = actionPolicy ? actionAudit(holdout, selected.candidate.predict, actionPolicy) : null;
  const exactHrrProductionPolicy = rows[0]?.market === "batter_hits_runs_rbis"
    ? exactActionPolicyAudit({
      validation,
      holdout,
      probability: selected.candidate.predict,
      policy: { probability: 0.6, edge: 0.01, ev: 0.03 },
    })
    : null;
  const qualifiesProbability = holdoutMetrics.challenger.brier < holdoutMetrics.market.brier
    && holdoutMetrics.challenger.logLoss < holdoutMetrics.market.logLoss
    && holdoutMetrics.challenger.brier < holdoutMetrics.current.brier
    && holdoutMetrics.challenger.logLoss < holdoutMetrics.current.logLoss
    && bootstrap.brierBeatBothProbability >= 0.9
    && bootstrap.logLossBeatBothProbability >= 0.9;
  return {
    status: qualifiesProbability ? "qualifies_probability" : "rejected_probability",
    counts: { discovery: discovery.length, validation: validation.length, holdout: holdout.length },
    selected: selected.candidate.name,
    selectedKind: ridgeNames.has(selected.candidate.name) ? "ridge" : "distribution",
    validation: {
      market: metrics(validation, (row) => row.marketOver),
      current: metrics(validation, (row) => row.currentOver),
      challenger: selected.validation,
    },
    holdout: holdoutMetrics,
    finalistComparison,
    holdoutDateBlockBootstrap: bootstrap,
    actionPolicy,
    validationActions,
    holdoutActions,
    holdoutActionAudit,
    exactHrrProductionPolicy,
  };
}

function exactActionPolicyAudit(args: {
  validation: Observation[];
  holdout: Observation[];
  probability: (row: Observation) => number;
  policy: ActionPolicy;
}) {
  return {
    line: "offered_line",
    policy: args.policy,
    validation: actionMetrics(args.validation, args.probability, args.policy),
    holdout: actionMetrics(args.holdout, args.probability, args.policy),
    holdoutAudit: actionAudit(args.holdout, args.probability, args.policy),
  };
}

function dateBlockBootstrapComparison(rows: Observation[], probability: (row: Observation) => number, iterations: number) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const byDate = new Map(dates.map((date) => [date, rows.filter((row) => row.date === date)]));
  let state = 0x6d2b79f5;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  let brierWins = 0;
  let logLossWins = 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sample = Array.from({ length: dates.length }, () => byDate.get(dates[Math.floor(random() * dates.length)]!) ?? []).flat();
    const market = metrics(sample, (row) => row.marketOver)!;
    const current = metrics(sample, (row) => row.currentOver)!;
    const challenger = metrics(sample, probability)!;
    if (challenger.brier < market.brier && challenger.brier < current.brier) brierWins++;
    if (challenger.logLoss < market.logLoss && challenger.logLoss < current.logLoss) logLossWins++;
  }
  return {
    iterations,
    brierBeatBothProbability: round(brierWins / iterations),
    logLossBeatBothProbability: round(logLossWins / iterations),
  };
}

type ActionPolicy = { probability: number; edge: number; ev: number };

function selectActionPolicy(rows: Observation[], probability: (row: Observation) => number): ActionPolicy | null {
  const candidates: Array<{ policy: ActionPolicy; result: ReturnType<typeof actionMetrics> }> = [];
  for (const minimumProbability of [0.54, 0.56, 0.58, 0.6])
    for (const minimumEdge of [0.01, 0.02, 0.03, 0.05])
      for (const minimumEv of [0, 0.01, 0.03, 0.05]) {
        const policy = { probability: minimumProbability, edge: minimumEdge, ev: minimumEv };
        const result = actionMetrics(rows, probability, policy);
        if (result.decisions >= 10 && result.hitRate !== null && result.roi !== null && result.hitRate > 0.5 && result.roi > 0) {
          candidates.push({ policy, result });
        }
      }
  return candidates.sort((left, right) =>
    (right.result.hitRate ?? 0) - (left.result.hitRate ?? 0)
    || (right.result.roi ?? 0) - (left.result.roi ?? 0)
    || right.result.decisions - left.result.decisions)[0]?.policy ?? null;
}

function actionMetrics(rows: Observation[], probability: (row: Observation) => number, policy: ActionPolicy) {
  const selections = actionSelections(rows, probability, policy);
  const wins = selections.filter((item) => item.won).length;
  const losses = selections.length - wins;
  const units = selections.reduce((sum, item) => sum + item.units, 0);
  const decisions = wins + losses;
  return { decisions, record: `${wins}-${losses}`, hitRate: decisions ? round(wins / decisions) : null, units: round(units), roi: decisions ? round(units / decisions) : null };
}

function actionSelections(rows: Observation[], probability: (row: Observation) => number, policy: ActionPolicy) {
  const selections: Array<{ row: Observation; side: "over" | "under"; odds: number; won: boolean; units: number }> = [];
  for (const row of rows) {
    const overProbability = clamp(probability(row));
    const side = overProbability >= 0.5 ? "over" : "under";
    const predicted = side === "over" ? overProbability : 1 - overProbability;
    const market = side === "over" ? row.marketOver : 1 - row.marketOver;
    const odds = side === "over" ? row.bestOverOdds : row.bestUnderOdds;
    if (odds === null) continue;
    const expectedValue = predicted * decimalOdds(odds) - 1;
    if (predicted < policy.probability || predicted - market < policy.edge || expectedValue < policy.ev) continue;
    const won = side === "over" ? row.outcomeOver === 1 : row.outcomeOver === 0;
    selections.push({ row, side, odds, won, units: won ? (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) : -1 });
  }
  return selections;
}

function actionAudit(rows: Observation[], probability: (row: Observation) => number, policy: ActionPolicy) {
  const selections = actionSelections(rows, probability, policy);
  const byDate = Object.fromEntries([...new Set(selections.map((item) => item.row.date))].sort().map((date) => {
    const selected = selections.filter((item) => item.row.date === date);
    const wins = selected.filter((item) => item.won).length;
    return [date, { decisions: selected.length, record: `${wins}-${selected.length - wins}`, units: round(selected.reduce((sum, item) => sum + item.units, 0)) }];
  }));
  const current = rows.filter((row) => row.currentActionSide && row.currentActionOdds !== null).map((row) => {
    const won = row.currentActionSide === "over" ? row.outcomeOver === 1 : row.outcomeOver === 0;
    const odds = row.currentActionOdds!;
    return { row, side: row.currentActionSide!, odds, won, units: won ? (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) : -1 };
  });
  const currentWins = current.filter((item) => item.won).length;
  const overlap = selections.filter((item) => item.row.currentActionSide === item.side).length;
  return {
    sideCounts: { over: selections.filter((item) => item.side === "over").length, under: selections.filter((item) => item.side === "under").length },
    lineCounts: Object.fromEntries([...new Set(selections.map((item) => item.row.line))].sort((a, b) => a - b).map((line) => [String(line), selections.filter((item) => item.row.line === line).length])),
    odds: selections.length ? { minimum: Math.min(...selections.map((item) => item.odds)), median: median(selections.map((item) => item.odds)), maximum: Math.max(...selections.map((item) => item.odds)) } : null,
    dates: byDate,
    currentActionables: { decisions: current.length, record: `${currentWins}-${current.length - currentWins}`, hitRate: current.length ? round(currentWins / current.length) : null, units: round(current.reduce((sum, item) => sum + item.units, 0)), roi: current.length ? round(current.reduce((sum, item) => sum + item.units, 0) / current.length) : null },
    overlapSameSide: overlap,
    incrementalDecisions: selections.length - overlap,
    bootstrap: actionDateBootstrap(selections, 5_000),
  };
}

function actionDateBootstrap(selections: ReturnType<typeof actionSelections>, iterations: number) {
  const dates = [...new Set(selections.map((item) => item.row.date))];
  if (!dates.length) return null;
  const byDate = new Map(dates.map((date) => [date, selections.filter((item) => item.row.date === date)]));
  let state = 0x9e3779b9;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  let hitAboveHalf = 0;
  let profitable = 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sample = Array.from({ length: dates.length }, () => byDate.get(dates[Math.floor(random() * dates.length)]!) ?? []).flat();
    if (!sample.length) continue;
    if (sample.filter((item) => item.won).length / sample.length > 0.5) hitAboveHalf++;
    if (sample.reduce((sum, item) => sum + item.units, 0) > 0) profitable++;
  }
  return { iterations, hitRateAboveHalfProbability: round(hitAboveHalf / iterations), profitableProbability: round(profitable / iterations) };
}

function metrics(rows: Observation[], probability: (row: Observation) => number) {
  if (!rows.length) return null;
  const probabilities = rows.map((row) => clamp(probability(row)));
  const brier = mean(rows.map((row, index) => (probabilities[index]! - row.outcomeOver) ** 2));
  const logLoss = mean(rows.map((row, index) => {
    const p = probabilities[index]!;
    return -(row.outcomeOver * Math.log(p) + (1 - row.outcomeOver) * Math.log(1 - p));
  }));
  const predicted = mean(probabilities);
  const observed = mean(rows.map((row) => row.outcomeOver));
  const selected = rows.map((row, index) => ({ row, p: probabilities[index]! })).filter(({ p }) => p >= 0.55 || p <= 0.45);
  const selectedWins = selected.filter(({ row, p }) => p >= 0.5 ? row.outcomeOver === 1 : row.outcomeOver === 0).length;
  return {
    rows: rows.length,
    dates: new Set(rows.map((row) => row.date)).size,
    playerGameClusters: new Set(rows.map((row) => `${row.date}|${row.gameId}|${row.playerId}`)).size,
    brier: round(brier),
    logLoss: round(logLoss),
    calibrationGap: round(predicted - observed),
    observedOverRate: round(observed),
    decisionsAt55: selected.length,
    selectedSideHitRateAt55: selected.length ? round(selectedWins / selected.length) : null,
  };
}

function compareMetrics(left: { validation: NonNullable<ReturnType<typeof metrics>> }, right: { validation: NonNullable<ReturnType<typeof metrics>> }) {
  return left.validation.brier - right.validation.brier || left.validation.logLoss - right.validation.logLoss;
}

async function main() {
  const raw = await loadTracking();
  const logs = await loadLogs(raw);
  if (!existsSync(CONTEXT_CACHE)) throw new Error(`Missing frozen context cache: run extract-mlb-props-locked-feature-context.ts first.`);
  const contexts = JSON.parse(readFileSync(CONTEXT_CACHE, "utf8")) as Record<string, Record<string, unknown>>;
  const observations = buildObservations(raw, logs, contexts);
  const requestedMarkets = process.argv.find((value) => value.startsWith("--markets="))?.slice("--markets=".length).split(",").filter(Boolean);
  const markets = [...new Set(observations.map((row) => row.market))].sort().filter((market) => !requestedMarkets?.length || requestedMarkets.includes(market));
  const report: Record<string, ReturnType<typeof evaluateMarket>> = {};
  for (const market of markets) {
    report[market] = evaluateMarket(observations.filter((row) => row.market === market));
    if (process.argv.includes("--compact")) console.error(`evaluated ${market}`);
  }
  const output = {
    generatedAt: new Date().toISOString(),
    methodology: {
      writesToProduction: false,
      tracking: "Immutable public-display T-60 rows collapsed to one player/game/market/line observation.",
      features: "Official MLB logs strictly before the slate plus exact locked-board context: lineup/order, home-away, opponent rates, pitch arsenal, pitch-type matchup, prior batter-pitcher matchup, park, and weather; missingness is modeled explicitly. Market-plus and independent fits are both tested.",
      selection: `Discovery through ${DISCOVERY_THROUGH}; select on ${VALIDATION_FROM}..${VALIDATION_THROUGH}; untouched holdout ${HOLDOUT_FROM}+.`,
      caution: "Only context recovered from the exact referenced locked snapshot is used; missing snapshots and fields remain explicit missing indicators.",
    },
    coverage: { trackingRows: raw.length, officialLogIdentities: logs.size, frozenContexts: Object.keys(contexts).length, observations: observations.length, observationsWithFrozenContext: observations.filter((row) => row.hasFrozenContext).length, markets: markets.length },
    reportPath: REPORT_PATH,
    markets: report,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(output, null, 2));
  if (process.argv.includes("--compact")) {
    console.log(JSON.stringify({
      coverage: output.coverage,
      reportPath: REPORT_PATH,
      markets: Object.fromEntries(Object.entries(report).map(([market, result]) => [market, compactResult(result)])),
    }, null, 2));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

function compactResult(result: ReturnType<typeof evaluateMarket>) {
  if (result.status === "insufficient_chronological_coverage") return result;
  return {
    status: result.status,
    counts: result.counts,
    selected: result.selected,
    holdout: result.holdout,
    finalistComparison: result.finalistComparison,
    bootstrap: result.holdoutDateBlockBootstrap,
    actionPolicy: result.actionPolicy,
    validationActions: result.validationActions,
    holdoutActions: result.holdoutActions,
    holdoutActionAudit: result.holdoutActionAudit,
    exactHrrProductionPolicy: result.exactHrrProductionPolicy,
  };
}

function statValues(row: Observation): number[] {
  const key = STAT_KEY[row.market]!;
  return row.prior.map((log) => numeric(log.stats[key])).filter((value): value is number => value !== null);
}

function toOver(side: "over" | "under", probability: number) { return side === "over" ? probability : 1 - probability; }
function bestOdds(values: number[]) { return values.length ? Math.max(...values) : null; }
function numeric(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2; }
function survival(values: number[], line: number) { return values.length ? values.filter((value) => value > line).length / values.length : 0.5; }
function standardDeviation(values: number[]) { const average = mean(values); return values.length ? Math.sqrt(mean(values.map((value) => (value - average) ** 2))) : 0; }
function clamp(value: number) { return Math.max(0.001, Math.min(0.999, value)); }
function logit(value: number) { const p = clamp(value); return Math.log(p / (1 - p)); }
function sigmoid(value: number) { return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value)); }
function dot(left: number[], right: number[]) { return left.reduce((sum, value, index) => sum + value * right[index]!, 0); }
function decimalOdds(odds: number) { return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds); }
function round(value: number) { return Number(value.toFixed(6)); }
function poissonOver(expected: number, line: number) {
  const threshold = Math.floor(line) + 1;
  let term = Math.exp(-expected);
  let cumulative = term;
  for (let count = 1; count < threshold; count++) { term *= expected / count; cumulative += term; }
  return clamp(1 - cumulative);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
