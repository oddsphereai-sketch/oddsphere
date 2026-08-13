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
  modelSpec?: LogisticModelSpec;
};

type LogisticModelSpec = {
  mode: "independent" | "market_plus";
  lambda: number;
  means: number[];
  scales: number[];
  coefficients: number[];
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
  if (discovery[0]?.market === "batter_home_runs") {
    for (const window of [20, 40, 80]) {
      for (const priorPa of [50, 100, 200]) {
        for (const marketWeight of [0, 0.25, 0.5, 0.75]) {
          candidates.push({
            name: `hr_pa_w${window}_p${priorPa}_m${marketWeight}`,
            predict: (row) => {
              const logs = row.prior
                .filter((log) => (numeric(log.stats.plate_appearances) ?? 0) > 0)
                .slice(0, window);
              const homeRuns = logs.reduce((sum, log) => sum + (numeric(log.stats.home_runs) ?? 0), 0);
              const plateAppearances = logs.reduce((sum, log) => sum + (numeric(log.stats.plate_appearances) ?? 0), 0);
              const leagueRate = 0.032;
              const rate = (homeRuns + leagueRate * priorPa) / Math.max(1, plateAppearances + priorPa);
              const battingOrder = numeric(row.context?.battingOrder);
              const expectedPlateAppearances = battingOrder === null
                ? 4.15
                : Math.max(3.65, Math.min(4.75, 4.85 - (battingOrder - 1) * 0.13));
              const parkDelta = numeric(row.context?.parkHomeRunFactor) ?? 0;
              const temperature = numeric(row.context?.temperatureF);
              const outdoor = row.context?.roofStatus === "outdoor";
              const environmentMultiplier = Math.max(0.75, Math.min(1.3,
                1 + parkDelta + (!outdoor || temperature === null ? 0 : (temperature - 70) * 0.003),
              ));
              const independent = 1 - Math.exp(-rate * expectedPlateAppearances * environmentMultiplier);
              return clamp(independent * (1 - marketWeight) + row.marketOver * marketWeight);
            },
          });
        }
      }
    }
  }
  for (const mode of ["independent", "market_plus"] as const) {
    const fitted = [1, 20, 100].map((lambda) => {
      const model = fitLogistic(discovery, mode, lambda);
      const candidate = {
        name: `ridge_${mode}_l${lambda}`,
        predict: model.predict,
        modelSpec: { mode, lambda, ...model.spec },
      };
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
  return {
    predict: (row: Observation) => clamp(sigmoid(dot(coefficients, vector(row)))),
    spec: { means, scales, coefficients },
  };
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
      modelSpec: candidate.modelSpec ?? null,
      action: (() => {
      const policy = selectActionPolicy(validation, candidate.predict);
      return policy ? {
        policy,
        validation: actionMetrics(validation, candidate.predict, policy),
        holdout: actionMetrics(holdout, candidate.predict, policy),
        holdoutAudit: actionAudit(holdout, candidate.predict, policy),
      } : null;
    })(),
      actionPolicySensitivity: actionPolicySensitivity(validation, holdout, candidate.predict),
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
  const homeRunPortfolio = rows[0]?.market === "batter_home_runs"
    ? evaluateHomeRunPortfolio({
        validation,
        holdout,
        candidates: [
          candidates.find((candidate) => candidate.name === "market")!,
          candidates.find((candidate) => candidate.name === "current")!,
          ...candidates.filter((candidate) => candidate.name.startsWith("hr_pa_")),
        ],
      })
    : null;
  const valuePortfolio = rows[0]?.market !== "batter_home_runs"
    ? evaluateValuePortfolio({
        validation,
        holdout,
        candidates: [
          candidates.find((candidate) => candidate.name === "market")!,
          candidates.find((candidate) => candidate.name === "current")!,
          selectedSimple.candidate,
          ...selectedRidge,
        ],
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
    homeRunPortfolio,
    valuePortfolio,
  };
}

type ValuePortfolioPolicy = {
  playsPerSlate: number;
  minimumEdge: number;
  minimumExpectedValue: number;
  minimumOdds: number;
  maximumOdds: number;
  maximumPerGame: number;
  maximumPerPlayer: number;
};

function evaluateValuePortfolio(args: {
  validation: Observation[];
  holdout: Observation[];
  candidates: Candidate[];
}) {
  const policies: ValuePortfolioPolicy[] = [];
  for (const playsPerSlate of [1, 2, 3])
    for (const minimumEdge of [0, 0.01, 0.02])
      for (const minimumExpectedValue of [0, 0.02, 0.05]) {
        policies.push({
          playsPerSlate,
          minimumEdge,
          minimumExpectedValue,
          minimumOdds: -200,
          maximumOdds: 300,
          maximumPerGame: 2,
          maximumPerPlayer: 1,
        });
      }
  const validationCandidates = args.candidates.flatMap((candidate) => policies.map((policy) => {
    const selections = valuePortfolioSelections(args.validation, candidate.predict, policy);
    return { candidate, policy, metrics: portfolioMetrics(selections) };
  })).filter((item) =>
    item.metrics.decisions >= 8
    && item.metrics.dates >= 5
    && item.metrics.roi !== null
    && item.metrics.roi > 0
  ).sort((left, right) =>
    right.metrics.units - left.metrics.units
    || (right.metrics.roi ?? 0) - (left.metrics.roi ?? 0)
    || right.metrics.decisions - left.metrics.decisions
  );
  const selected = validationCandidates[0] ?? null;
  if (!selected) return {
    status: "no_positive_validation_portfolio",
    policiesTested: args.candidates.length * policies.length,
    selected: null,
  };
  const holdoutSelections = valuePortfolioSelections(args.holdout, selected.candidate.predict, selected.policy);
  const fixedPolicySensitivity = [1, 2, 3].map((playsPerSlate) => {
    const policy = { ...selected.policy, playsPerSlate };
    const validationSelections = valuePortfolioSelections(args.validation, selected.candidate.predict, policy);
    const candidateHoldoutSelections = valuePortfolioSelections(args.holdout, selected.candidate.predict, policy);
    return {
      playsPerSlate,
      validation: portfolioMetrics(validationSelections),
      holdout: portfolioMetrics(candidateHoldoutSelections),
      holdoutBootstrap: actionDateBootstrap(candidateHoldoutSelections, 5_000),
    };
  });
  const incrementalRankSensitivity = [1, 2, 3].map((rank) => {
    const atRank = (rows: Observation[]) => {
      const upper = valuePortfolioSelections(rows, selected.candidate.predict, {
        ...selected.policy,
        playsPerSlate: rank,
      });
      if (rank === 1) return upper;
      const lowerKeys = new Set(valuePortfolioSelections(rows, selected.candidate.predict, {
        ...selected.policy,
        playsPerSlate: rank - 1,
      }).map((item) => `${item.row.key}|${item.side}`));
      return upper.filter((item) => !lowerKeys.has(`${item.row.key}|${item.side}`));
    };
    const validationSelections = atRank(args.validation);
    const candidateHoldoutSelections = atRank(args.holdout);
    return {
      rank,
      validation: portfolioMetrics(validationSelections),
      holdout: portfolioMetrics(candidateHoldoutSelections),
      holdoutBootstrap: actionDateBootstrap(candidateHoldoutSelections, 5_000),
    };
  });
  return {
    status: "holdout_evaluated",
    policiesTested: args.candidates.length * policies.length,
    selected: {
      model: selected.candidate.name,
      policy: selected.policy,
      validation: selected.metrics,
      holdout: portfolioMetrics(holdoutSelections),
      holdoutBootstrap: actionDateBootstrap(holdoutSelections, 5_000),
      holdoutDaily: portfolioDaily(holdoutSelections),
      fixedPolicySensitivity,
      incrementalRankSensitivity,
    },
    validationLeaderboard: validationCandidates.slice(0, 20).map((item) => ({
      model: item.candidate.name,
      policy: item.policy,
      validation: item.metrics,
      holdout: portfolioMetrics(valuePortfolioSelections(args.holdout, item.candidate.predict, item.policy)),
    })),
  };
}

function valuePortfolioSelections(
  rows: Observation[],
  probability: (row: Observation) => number,
  policy: ValuePortfolioPolicy,
) {
  const selections: ReturnType<typeof actionSelections> = [];
  for (const date of [...new Set(rows.map((row) => row.date))].sort()) {
    const ranked = rows.filter((row) => row.date === date).flatMap((row) => {
      const overProbability = clamp(probability(row));
      const side = overProbability >= 0.5 ? "over" as const : "under" as const;
      const predicted = side === "over" ? overProbability : 1 - overProbability;
      const market = side === "over" ? row.marketOver : 1 - row.marketOver;
      const odds = side === "over" ? row.bestOverOdds : row.bestUnderOdds;
      if (odds === null || odds < policy.minimumOdds || odds > policy.maximumOdds) return [];
      const expectedValue = predicted * decimalOdds(odds) - 1;
      const edge = predicted - market;
      if (edge < policy.minimumEdge || expectedValue < policy.minimumExpectedValue) return [];
      return [{ row, side, odds, predicted, expectedValue, edge }];
    }).sort((left, right) =>
      right.expectedValue - left.expectedValue
      || right.edge - left.edge
      || right.predicted - left.predicted
      || left.row.key.localeCompare(right.row.key)
    );
    const perGame = new Map<string, number>();
    const perPlayer = new Map<number, number>();
    for (const candidate of ranked) {
      if (selections.filter((item) => item.row.date === date).length >= policy.playsPerSlate) break;
      if ((perGame.get(candidate.row.gameId) ?? 0) >= policy.maximumPerGame) continue;
      if ((perPlayer.get(candidate.row.playerId) ?? 0) >= policy.maximumPerPlayer) continue;
      perGame.set(candidate.row.gameId, (perGame.get(candidate.row.gameId) ?? 0) + 1);
      perPlayer.set(candidate.row.playerId, (perPlayer.get(candidate.row.playerId) ?? 0) + 1);
      const won = candidate.side === "over" ? candidate.row.outcomeOver === 1 : candidate.row.outcomeOver === 0;
      selections.push({
        row: candidate.row,
        side: candidate.side,
        odds: candidate.odds,
        won,
        units: won ? (candidate.odds > 0 ? candidate.odds / 100 : 100 / Math.abs(candidate.odds)) : -1,
      });
    }
  }
  return selections;
}

type HomeRunPortfolioPolicy = {
  playsPerSlate: number;
  minimumEdge: number;
  minimumExpectedValue: number;
  minimumOdds: number;
  maximumOdds: number;
  maximumPerGame: number;
};

type HomeRunComplementPolicy = HomeRunPortfolioPolicy & {
  minimumProbability: number;
  score: "probability" | "expected_value" | "edge";
};

function evaluateHomeRunPortfolio(args: {
  validation: Observation[];
  holdout: Observation[];
  candidates: Candidate[];
}) {
  const policies: HomeRunPortfolioPolicy[] = [];
  for (const playsPerSlate of [3, 4, 5, 6])
    for (const minimumEdge of [0, 0.02, 0.04])
      for (const minimumExpectedValue of [0, 0.05, 0.1]) {
        policies.push({
          playsPerSlate,
          minimumEdge,
          minimumExpectedValue,
          minimumOdds: 150,
          maximumOdds: 1000,
          maximumPerGame: 1,
        });
      }
  const validationCandidates = args.candidates.flatMap((candidate) => policies.map((policy) => {
    const selections = homeRunPortfolioSelections(args.validation, candidate.predict, policy);
    return { candidate, policy, selections, metrics: portfolioMetrics(selections) };
  })).filter((item) =>
    item.metrics.decisions >= 16 &&
    item.metrics.dates >= 5 &&
    item.metrics.roi !== null &&
    item.metrics.roi > 0
  ).sort((left, right) =>
    right.metrics.units - left.metrics.units ||
    (right.metrics.roi ?? 0) - (left.metrics.roi ?? 0) ||
    right.metrics.decisions - left.metrics.decisions
  );
  const selected = validationCandidates[0] ?? null;
  if (selected === null) return {
    status: "no_positive_validation_portfolio",
    policiesTested: args.candidates.length * policies.length,
    selected: null,
  };
  const holdoutSelections = homeRunPortfolioSelections(
    args.holdout,
    selected.candidate.predict,
    selected.policy,
  );
  const complementarySleeve = evaluateComplementaryHomeRunSleeve(args);
  const fixedPolicySensitivity = [3, 4, 5, 6].map((playsPerSlate) => {
    const policy = { ...selected.policy, playsPerSlate };
    const validationSelections = homeRunPortfolioSelections(args.validation, selected.candidate.predict, policy);
    const candidateHoldoutSelections = homeRunPortfolioSelections(args.holdout, selected.candidate.predict, policy);
    return {
      playsPerSlate,
      validation: portfolioMetrics(validationSelections),
      holdout: portfolioMetrics(candidateHoldoutSelections),
      holdoutBootstrap: actionDateBootstrap(candidateHoldoutSelections, 5_000),
    };
  });
  const incrementalRankSensitivity = [1, 2, 3, 4, 5, 6].map((rank) => {
    const atRank = (rows: Observation[]) => {
      const upper = homeRunPortfolioSelections(rows, selected.candidate.predict, {
        ...selected.policy,
        playsPerSlate: rank,
      });
      if (rank === 1) return upper;
      const lowerKeys = new Set(homeRunPortfolioSelections(rows, selected.candidate.predict, {
        ...selected.policy,
        playsPerSlate: rank - 1,
      }).map((item) => `${item.row.key}|${item.side}`));
      return upper.filter((item) => !lowerKeys.has(`${item.row.key}|${item.side}`));
    };
    const validationSelections = atRank(args.validation);
    const candidateHoldoutSelections = atRank(args.holdout);
    return {
      rank,
      validation: portfolioMetrics(validationSelections),
      holdout: portfolioMetrics(candidateHoldoutSelections),
      holdoutBootstrap: actionDateBootstrap(candidateHoldoutSelections, 5_000),
    };
  });
  return {
    status: "holdout_evaluated",
    policiesTested: args.candidates.length * policies.length,
    selected: {
      model: selected.candidate.name,
      policy: selected.policy,
      validation: selected.metrics,
      holdout: portfolioMetrics(holdoutSelections),
      holdoutBootstrap: actionDateBootstrap(holdoutSelections, 5_000),
      holdoutDaily: portfolioDaily(holdoutSelections),
      fixedPolicySensitivity,
      incrementalRankSensitivity,
      complementarySleeve,
      holdoutSelections: holdoutSelections.map((item) => ({
        date: item.row.date,
        gameId: item.row.gameId,
        playerId: item.row.playerId,
        odds: item.odds,
        marketProbability: round(item.row.marketOver),
        modelProbability: round(selected.candidate.predict(item.row)),
        outcome: item.won ? "win" : "loss",
        units: round(item.units),
      })),
    },
    validationLeaderboard: validationCandidates.slice(0, 20).map((item) => ({
      model: item.candidate.name,
      policy: item.policy,
      validation: item.metrics,
      holdout: portfolioMetrics(homeRunPortfolioSelections(args.holdout, item.candidate.predict, item.policy)),
    })),
  };
}

function evaluateComplementaryHomeRunSleeve(args: {
  validation: Observation[];
  holdout: Observation[];
  candidates: Candidate[];
}) {
  const baseModel = args.candidates.find((candidate) => candidate.name === "hr_pa_w20_p100_m0.25");
  if (!baseModel) return { status: "base_model_missing" };
  const basePolicy: HomeRunPortfolioPolicy = {
    playsPerSlate: 3,
    minimumEdge: 0,
    minimumExpectedValue: 0,
    minimumOdds: 150,
    maximumOdds: 1000,
    maximumPerGame: 1,
  };
  const tune = args.validation.filter((row) => row.date <= "2026-07-27");
  const confirm = args.validation.filter((row) => row.date >= "2026-07-28");
  const policies: HomeRunComplementPolicy[] = [];
  for (const playsPerSlate of [1, 2, 3])
    for (const minimumProbability of [0.1, 0.12, 0.14, 0.16])
      for (const minimumEdge of [-0.02, 0, 0.02])
        for (const minimumExpectedValue of [-0.05, 0, 0.05])
          for (const [minimumOdds, maximumOdds] of [[150, 350], [351, 650], [651, 1000], [150, 1000]] as const)
            for (const score of ["probability", "expected_value", "edge"] as const)
              policies.push({ playsPerSlate, minimumProbability, minimumEdge, minimumExpectedValue,
                minimumOdds, maximumOdds, maximumPerGame: 1, score });
  const evaluated = args.candidates.flatMap((candidate) => policies.map((policy) => {
    const tuneSelections = complementaryHomeRunSelections(tune, candidate.predict, policy, baseModel.predict, basePolicy);
    const confirmSelections = complementaryHomeRunSelections(confirm, candidate.predict, policy, baseModel.predict, basePolicy);
    return {
      candidate,
      policy,
      tune: portfolioMetrics(tuneSelections),
      confirm: portfolioMetrics(confirmSelections),
    };
  })).filter((item) =>
    item.tune.decisions >= 4 && item.confirm.decisions >= 4
    && item.tune.units > 0 && item.confirm.units > 0
  ).sort((left, right) =>
    Math.min(right.tune.units, right.confirm.units) - Math.min(left.tune.units, left.confirm.units)
    || right.tune.units + right.confirm.units - left.tune.units - left.confirm.units
    || right.confirm.decisions - left.confirm.decisions
  );
  const selected = evaluated[0] ?? null;
  if (!selected) return { status: "no_candidate_profitable_in_both_validation_halves", policiesTested: args.candidates.length * policies.length };
  const holdoutSelections = complementaryHomeRunSelections(
    args.holdout, selected.candidate.predict, selected.policy, baseModel.predict, basePolicy,
  );
  const incrementalRankSensitivity = [1, 2, 3].map((rank) => {
    const atRank = (rows: Observation[]) => {
      const upper = complementaryHomeRunSelections(rows, selected.candidate.predict,
        { ...selected.policy, playsPerSlate: rank }, baseModel.predict, basePolicy);
      if (rank === 1) return upper;
      const lowerKeys = new Set(complementaryHomeRunSelections(rows, selected.candidate.predict,
        { ...selected.policy, playsPerSlate: rank - 1 }, baseModel.predict, basePolicy)
        .map((item) => `${item.row.key}|${item.side}`));
      return upper.filter((item) => !lowerKeys.has(`${item.row.key}|${item.side}`));
    };
    const tuneSelections = atRank(tune);
    const confirmSelections = atRank(confirm);
    const candidateHoldoutSelections = atRank(args.holdout);
    return {
      rank,
      tune: portfolioMetrics(tuneSelections),
      confirm: portfolioMetrics(confirmSelections),
      holdout: portfolioMetrics(candidateHoldoutSelections),
      holdoutBootstrap: actionDateBootstrap(candidateHoldoutSelections, 5_000),
    };
  });
  return {
    status: "untouched_holdout_evaluated",
    policiesTested: args.candidates.length * policies.length,
    selected: {
      model: selected.candidate.name,
      policy: selected.policy,
      tune: selected.tune,
      confirm: selected.confirm,
      holdout: portfolioMetrics(holdoutSelections),
      holdoutBootstrap: actionDateBootstrap(holdoutSelections, 5_000),
      holdoutDaily: portfolioDaily(holdoutSelections),
      incrementalRankSensitivity,
    },
    validationLeaderboard: evaluated.slice(0, 20).map((item) => ({
      model: item.candidate.name,
      policy: item.policy,
      tune: item.tune,
      confirm: item.confirm,
      holdout: portfolioMetrics(complementaryHomeRunSelections(
        args.holdout, item.candidate.predict, item.policy, baseModel.predict, basePolicy,
      )),
    })),
  };
}

function complementaryHomeRunSelections(
  rows: Observation[],
  probability: (row: Observation) => number,
  policy: HomeRunComplementPolicy,
  baseProbability: (row: Observation) => number,
  basePolicy: HomeRunPortfolioPolicy,
) {
  const base = homeRunPortfolioSelections(rows, baseProbability, basePolicy);
  const baseKeys = new Set(base.map((item) => item.row.key));
  const baseGames = new Set(base.map((item) => `${item.row.date}|${item.row.gameId}`));
  const selections: ReturnType<typeof actionSelections> = [];
  for (const date of [...new Set(rows.map((row) => row.date))].sort()) {
    const ranked = rows.filter((row) => row.date === date).flatMap((row) => {
      if (baseKeys.has(row.key) || baseGames.has(`${row.date}|${row.gameId}`)) return [];
      const odds = row.bestOverOdds;
      if (odds === null || odds < policy.minimumOdds || odds > policy.maximumOdds) return [];
      const predicted = clamp(probability(row));
      const expectedValue = predicted * decimalOdds(odds) - 1;
      const edge = predicted - row.marketOver;
      if (predicted < policy.minimumProbability || edge < policy.minimumEdge || expectedValue < policy.minimumExpectedValue) return [];
      const score = policy.score === "probability" ? predicted : policy.score === "edge" ? edge : expectedValue;
      return [{ row, odds, score, predicted, expectedValue, edge }];
    }).sort((left, right) =>
      right.score - left.score || right.expectedValue - left.expectedValue
      || right.predicted - left.predicted || left.row.key.localeCompare(right.row.key)
    );
    const usedGames = new Set<string>();
    for (const candidate of ranked) {
      if (selections.filter((item) => item.row.date === date).length >= policy.playsPerSlate) break;
      if (usedGames.has(candidate.row.gameId)) continue;
      usedGames.add(candidate.row.gameId);
      const won = candidate.row.outcomeOver === 1;
      selections.push({ row: candidate.row, side: "over", odds: candidate.odds, won,
        units: won ? candidate.odds / 100 : -1 });
    }
  }
  return selections;
}

function homeRunPortfolioSelections(
  rows: Observation[],
  probability: (row: Observation) => number,
  policy: HomeRunPortfolioPolicy,
) {
  const selections: ReturnType<typeof actionSelections> = [];
  for (const date of [...new Set(rows.map((row) => row.date))].sort()) {
    const ranked = rows.filter((row) => row.date === date).flatMap((row) => {
      const odds = row.bestOverOdds;
      if (odds === null || odds < policy.minimumOdds || odds > policy.maximumOdds) return [];
      const predicted = clamp(probability(row));
      const expectedValue = predicted * decimalOdds(odds) - 1;
      const edge = predicted - row.marketOver;
      if (edge < policy.minimumEdge || expectedValue < policy.minimumExpectedValue) return [];
      return [{ row, odds, predicted, expectedValue, edge }];
    }).sort((left, right) =>
      right.expectedValue - left.expectedValue ||
      right.edge - left.edge ||
      right.predicted - left.predicted ||
      left.row.key.localeCompare(right.row.key)
    );
    const perGame = new Map<string, number>();
    for (const candidate of ranked) {
      if (selections.filter((item) => item.row.date === date).length >= policy.playsPerSlate) break;
      if ((perGame.get(candidate.row.gameId) ?? 0) >= policy.maximumPerGame) continue;
      perGame.set(candidate.row.gameId, (perGame.get(candidate.row.gameId) ?? 0) + 1);
      const won = candidate.row.outcomeOver === 1;
      selections.push({
        row: candidate.row,
        side: "over",
        odds: candidate.odds,
        won,
        units: won ? candidate.odds / 100 : -1,
      });
    }
  }
  return selections;
}

function portfolioMetrics(selections: ReturnType<typeof actionSelections>) {
  const decisions = selections.length;
  const wins = selections.filter((item) => item.won).length;
  const units = selections.reduce((sum, item) => sum + item.units, 0);
  return {
    dates: new Set(selections.map((item) => item.row.date)).size,
    decisions,
    record: `${wins}-${decisions - wins}`,
    hitRate: decisions ? round(wins / decisions) : null,
    units: round(units),
    roi: decisions ? round(units / decisions) : null,
  };
}

function portfolioDaily(selections: ReturnType<typeof actionSelections>) {
  return Object.fromEntries([...new Set(selections.map((item) => item.row.date))].sort().map((date) => {
    const slate = selections.filter((item) => item.row.date === date);
    return [date, portfolioMetrics(slate)];
  }));
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

function actionPolicySensitivity(
  validation: Observation[],
  holdout: Observation[],
  probability: (row: Observation) => number,
) {
  const rows = [];
  for (const minimumProbability of [0.54, 0.56, 0.58, 0.6])
    for (const minimumEdge of [0.01, 0.02, 0.03, 0.05])
      for (const minimumEv of [0, 0.01, 0.03, 0.05]) {
        const policy = { probability: minimumProbability, edge: minimumEdge, ev: minimumEv };
        const validationMetrics = actionMetrics(validation, probability, policy);
        if (
          validationMetrics.decisions < 10
          || validationMetrics.hitRate === null
          || validationMetrics.roi === null
          || validationMetrics.hitRate <= 0.5
          || validationMetrics.roi <= 0
        ) continue;
        rows.push({
          policy,
          validation: validationMetrics,
          holdout: actionMetrics(holdout, probability, policy),
        });
      }
  return rows;
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
    homeRunPortfolio: result.homeRunPortfolio,
    valuePortfolio: result.valuePortfolio,
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
