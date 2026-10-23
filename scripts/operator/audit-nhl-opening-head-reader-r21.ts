/**
 * SELECT-only NHL opening-head and market-reader audit.
 *
 * Replays exact immutable r18-r20 feature snapshots through three already
 * shipped model heads. It never calls a provider and never writes a row.
 */

import { supabase } from "../../lib/db/supabase";
import {
  nhlRegularModelV1,
  resolveNhlPriceAwareVerdict,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
  type NhlVerdictKey,
} from "../../lib/automodel/nhlRegularModelV1";

type Market = "moneyline" | "spread" | "total";
type Side = -1 | 1;
type Result = "win" | "loss" | "push";
type Head = "fast" | "roster" | "mature";
type Phase = "selection" | "confirmation" | "full";

const RELEASES = [
  "nhl_regular_2026_r18_fast_state_direct_probability",
  "nhl_regular_2026_r19_fresh_quote_authority",
  "nhl_regular_2026_r20_verified_current_board",
] as const;
const HEADS: Head[] = ["fast", "roster", "mature"];
const MARKETS: Market[] = ["moneyline", "spread", "total"];

type Grade = {
  result: string | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
};

type LockedLine = {
  market_type?: string;
  sportsbook?: string;
  side?: string;
  line_value?: number | null;
  odds_american?: number | null;
};

type StoredSnapshot = {
  feature_inputs?: NhlFeatureSnapshot;
  model_output?: NhlModelOutput;
  market_at_lock?: { lines_snapshot?: LockedLine[] };
};

type Row = {
  id: number;
  game_id: number;
  slate_date: string;
  locked_at: string;
  matchup: string;
  market: Market;
  side: "home" | "away" | "over" | "under";
  line_value: number | null;
  odds_american: number | null;
  model_probability: number;
  play_grade: string | null;
  no_bet: boolean | null;
  model_version: string;
  snapshot_json: StoredSnapshot | null;
  prediction_grades: Grade | Grade[] | null;
};

type Forecast = {
  margin: number;
  total: number;
  homeWin: number;
  homeCover: number | null;
  over: number | null;
  output: NhlModelOutput;
};

type Game = {
  id: number;
  date: string;
  lockedAt: string;
  matchup: string;
  release: string;
  phase: Exclude<Phase, "full">;
  actualHome: number;
  actualAway: number;
  snapshot: NhlFeatureSnapshot;
  storedOutput: NhlModelOutput;
  lockedLines: LockedLine[];
  rows: Record<Market, Row>;
  forecasts: Record<Head, { independent: Forecast; final: Forecast }>;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function poissonPmf(lambda: number, maximum = 12): number[] {
  const values = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maximum; goals += 1) {
    values.push(values[goals - 1]! * lambda / goals);
  }
  values[maximum] = values[maximum]! + Math.max(0, 1 - values.reduce((sum, value) => sum + value, 0));
  return values;
}

function distribution(margin: number, total: number) {
  const homeGoals = Math.max(0.01, (total + margin) / 2);
  const awayGoals = Math.max(0.01, (total - margin) / 2);
  const homePmf = poissonPmf(homeGoals);
  const awayPmf = poissonPmf(awayGoals);
  const margins = new Map<number, number>();
  const totals = new Map<number, number>();
  let homeRegulation = 0;
  let tie = 0;
  for (let home = 0; home < homePmf.length; home += 1) {
    for (let away = 0; away < awayPmf.length; away += 1) {
      const probability = homePmf[home]! * awayPmf[away]!;
      margins.set(home - away, (margins.get(home - away) ?? 0) + probability);
      totals.set(home + away, (totals.get(home + away) ?? 0) + probability);
      if (home > away) homeRegulation += probability;
      else if (home === away) tie += probability;
    }
  }
  const overtimeHome = 1 / (1 + Math.exp(-0.42 * (homeGoals - awayGoals)));
  return { homeWin: homeRegulation + tie * overtimeHome, margins, totals };
}

function probabilityAbove(values: ReadonlyMap<number, number>, line: number): number {
  let probability = 0;
  for (const [value, mass] of values) if (value > line) probability += mass;
  return probability;
}

function probabilityBelow(values: ReadonlyMap<number, number>, line: number): number {
  let probability = 0;
  for (const [value, mass] of values) if (value < line) probability += mass;
  return probability;
}

function makeForecast(output: NhlModelOutput, snapshot: NhlFeatureSnapshot, source: "independent" | "final"): Forecast {
  const margin = source === "independent" ? output.independent_goal_diff : output.expected_goal_diff;
  const total = source === "independent" ? output.independent_total_goals : output.expected_total_goals;
  const values = distribution(margin, total);
  const homeLine = snapshot.market.market_home_puck_line;
  const totalLine = snapshot.market.market_total_line;
  let homeCover: number | null = null;
  if (homeLine !== null) {
    homeCover = 0;
    for (const [resultMargin, mass] of values.margins) if (resultMargin + homeLine > 0) homeCover += mass;
  }
  const overMass = totalLine === null ? null : probabilityAbove(values.totals, totalLine);
  const underMass = totalLine === null ? null : probabilityBelow(values.totals, totalLine);
  const over = overMass === null || underMass === null || overMass + underMass <= 0
    ? null
    : overMass / (overMass + underMass);
  return { margin, total, homeWin: values.homeWin, homeCover, over, output };
}

function snapshotForHead(snapshot: NhlFeatureSnapshot, head: Head): NhlFeatureSnapshot {
  const candidate = structuredClone(snapshot);
  if (head === "fast") return candidate;
  candidate.home.fast_state = null;
  candidate.away.fast_state = null;
  if (head === "mature") {
    candidate.home.current_season_games = 10;
    candidate.away.current_season_games = 10;
  }
  return candidate;
}

function resultFor(game: Game, market: Market, side: Side): Result {
  const actualMargin = game.actualHome - game.actualAway;
  const line = market === "spread"
    ? game.snapshot.market.market_home_puck_line
    : market === "total" ? game.snapshot.market.market_total_line : null;
  if ((market === "spread" || market === "total") && line === null) return "push";
  const axis = market === "moneyline"
    ? actualMargin
    : market === "spread"
      ? actualMargin + line!
      : game.actualHome + game.actualAway - line!;
  if (Math.abs(axis) < 1e-9) return "push";
  return (axis > 0 ? 1 : -1) === side ? "win" : "loss";
}

function sideFor(forecast: Forecast, market: Market): Side {
  const probability = market === "moneyline" ? forecast.homeWin : market === "spread" ? forecast.homeCover : forecast.over;
  return (probability ?? 0.5) >= 0.5 ? 1 : -1;
}

function probabilityFor(forecast: Forecast, market: Market, side: Side): number {
  const first = market === "moneyline" ? forecast.homeWin : market === "spread" ? forecast.homeCover : forecast.over;
  return first === null ? 0.5 : side === 1 ? first : 1 - first;
}

function settledUnit(result: Result, odds: number | null): number {
  if (odds === null || result === "push") return 0;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / -odds;
}

function storedVerdict(row: Row): NhlVerdictKey {
  if (row.play_grade === "best_angle" || row.play_grade === "best_signal") return "best_angle";
  if (row.play_grade === "lean" || row.play_grade === "model_only") return row.no_bet ? "pass" : "lean";
  if (row.play_grade === "watchlist" || row.play_grade === "market_watch") return "watchlist";
  return "pass";
}

function isActionable(verdict: NhlVerdictKey): boolean {
  return verdict === "best_angle" || verdict === "lean";
}

function lineMatches(candidate: number | null | undefined, target: number | null): boolean {
  return target === null || (candidate !== null && candidate !== undefined && Math.abs(candidate - target) < 0.01);
}

function bestLockedPrice(game: Game, market: Market, side: Side, targetLine: number | null): number | null {
  const sideName = market === "total" ? side === 1 ? "over" : "under" : side === 1 ? "home" : "away";
  const prices = game.lockedLines.flatMap((line): number[] => {
    const lineMarket = line.market_type === "puck_line" ? "spread" : line.market_type;
    return lineMarket === market
      && line.side === sideName
      && lineMatches(line.line_value, targetLine)
      && Number.isFinite(line.odds_american)
      ? [Number(line.odds_american)] : [];
  });
  return prices.length ? Math.max(...prices) : null;
}

function rawVerdict(output: NhlModelOutput, market: Market): NhlVerdictKey {
  return market === "moneyline" ? output.moneyline.verdict : market === "spread" ? output.puck_line.verdict : output.total.verdict;
}

function candidateDecision(game: Game, head: Head, market: Market) {
  const forecast = game.forecasts[head].final;
  const side = sideFor(forecast, market);
  const probability = probabilityFor(forecast, market, side);
  const targetLine = market === "spread"
    ? side === 1 ? game.snapshot.market.market_home_puck_line : game.snapshot.market.market_away_puck_line
    : market === "total" ? game.snapshot.market.market_total_line : null;
  const stored = game.rows[market];
  const storedSide: Side = ["home", "over"].includes(stored.side) ? 1 : -1;
  const storedLineMatches = lineMatches(stored.line_value, targetLine);
  const price = storedSide === side && storedLineMatches && stored.odds_american !== null
    ? stored.odds_american
    : bestLockedPrice(game, market, side, targetLine);
  const verdict = resolveNhlPriceAwareVerdict(market, rawVerdict(forecast.output, market), price, probability);
  return { side, probability, price, verdict, result: resultFor(game, market, side) };
}

function round(value: number | null, digits = 5): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function directionalSummary(games: readonly Game[], head: Head, source: "independent" | "final", market: Market) {
  const entries = games.map((game) => {
    const forecast = game.forecasts[head][source];
    const side = sideFor(forecast, market);
    return { result: resultFor(game, market, side), probability: probabilityFor(forecast, market, side) };
  });
  const resolved = entries.filter((entry) => entry.result !== "push");
  const wins = resolved.filter((entry) => entry.result === "win").length;
  return {
    rows: entries.length,
    wins,
    losses: resolved.length - wins,
    pushes: entries.length - resolved.length,
    accuracy: round(resolved.length ? wins / resolved.length : null),
    brier: round(resolved.length ? resolved.reduce((sum, entry) => (
      sum + (entry.probability - (entry.result === "win" ? 1 : 0)) ** 2
    ), 0) / resolved.length : null),
    logLoss: round(resolved.length ? resolved.reduce((sum, entry) => {
      const probability = clamp(entry.probability, 0.001, 0.999);
      return sum - Math.log(entry.result === "win" ? probability : 1 - probability);
    }, 0) / resolved.length : null),
  };
}

function scoreSummary(games: readonly Game[], head: Head, source: "independent" | "final") {
  const forecasts = games.map((game) => ({ game, forecast: game.forecasts[head][source] }));
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    teamMae: round(mean(forecasts.map(({ game, forecast }) => (
      Math.abs((forecast.total + forecast.margin) / 2 - game.actualHome)
      + Math.abs((forecast.total - forecast.margin) / 2 - game.actualAway)
    ) / 2))),
    marginMae: round(mean(forecasts.map(({ game, forecast }) => Math.abs(
      forecast.margin - (game.actualHome - game.actualAway),
    )))),
    totalMae: round(mean(forecasts.map(({ game, forecast }) => Math.abs(
      forecast.total - (game.actualHome + game.actualAway),
    )))),
    meanAbsPredictedMargin: round(mean(forecasts.map(({ forecast }) => Math.abs(forecast.margin)))),
    meanAbsActualMargin: round(mean(forecasts.map(({ game }) => Math.abs(game.actualHome - game.actualAway)))),
    predictedBeyond1_5: round(mean(forecasts.map(({ forecast }) => Math.abs(forecast.margin) > 1.5 ? 1 : 0))),
    actualBeyond1_5: round(mean(forecasts.map(({ game }) => Math.abs(game.actualHome - game.actualAway) > 1.5 ? 1 : 0))),
    predictedBeyond2_5: round(mean(forecasts.map(({ forecast }) => Math.abs(forecast.margin) > 2.5 ? 1 : 0))),
    actualBeyond2_5: round(mean(forecasts.map(({ game }) => Math.abs(game.actualHome - game.actualAway) > 2.5 ? 1 : 0))),
  };
}

function readerImpact(games: readonly Game[], head: Head, market: Market) {
  const entries = games.map((game) => {
    const before = sideFor(game.forecasts[head].independent, market);
    const after = sideFor(game.forecasts[head].final, market);
    const beforeResult = resultFor(game, market, before);
    const afterResult = resultFor(game, market, after);
    return { changed: before !== after, beforeResult, afterResult };
  });
  return {
    changes: entries.filter((entry) => entry.changed).length,
    corrections: entries.filter((entry) => entry.changed && entry.beforeResult === "loss" && entry.afterResult === "win").length,
    harms: entries.filter((entry) => entry.changed && entry.beforeResult === "win" && entry.afterResult === "loss").length,
    changedPushes: entries.filter((entry) => entry.changed && (entry.beforeResult === "push" || entry.afterResult === "push")).length,
    unchanged: entries.filter((entry) => !entry.changed).length,
  };
}

function actionabilitySummary(games: readonly Game[], head: Head) {
  const entries = games.flatMap((game) => MARKETS.map((market) => ({ game, market, ...candidateDecision(game, head, market) })));
  const actionable = entries.filter((entry) => isActionable(entry.verdict));
  const summarize = (rows: typeof entries) => {
    const resolved = rows.filter((entry) => entry.result !== "push");
    const wins = resolved.filter((entry) => entry.result === "win").length;
    const units = rows.reduce((sum, entry) => sum + settledUnit(entry.result, entry.price), 0);
    return {
      rows: rows.length,
      wins,
      losses: resolved.length - wins,
      pushes: rows.length - resolved.length,
      accuracy: round(resolved.length ? wins / resolved.length : null),
      units: round(units),
      roi: round(rows.length ? units / rows.length : null),
      missingPrices: rows.filter((entry) => entry.price === null).length,
      brier: round(resolved.length ? resolved.reduce((sum, entry) => (
        sum + (entry.probability - (entry.result === "win" ? 1 : 0)) ** 2
      ), 0) / resolved.length : null),
    };
  };
  const changes = entries.map((entry) => {
    const before = storedVerdict(entry.game.rows[entry.market]);
    return { before, after: entry.verdict };
  });
  return {
    actionable: summarize(actionable),
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(actionable.filter((entry) => entry.market === market))])),
    promotions: changes.filter((entry) => !isActionable(entry.before) && isActionable(entry.after)).length,
    demotions: changes.filter((entry) => isActionable(entry.before) && !isActionable(entry.after)).length,
    gradeChanges: changes.filter((entry) => entry.before !== entry.after).length,
  };
}

function modelSummary(games: readonly Game[], head: Head) {
  const summarize = (source: "independent" | "final") => ({
    moneyline: directionalSummary(games, head, source, "moneyline"),
    spread: directionalSummary(games, head, source, "spread"),
    total: directionalSummary(games, head, source, "total"),
    score: scoreSummary(games, head, source),
  });
  return {
    independent: summarize("independent"),
    final: {
      ...summarize("final"),
      readerImpact: Object.fromEntries(MARKETS.map((market) => [market, readerImpact(games, head, market)])),
    },
  };
}

function binaryAccuracy(games: readonly Game[], sideForGame: (game: Game) => Side) {
  const results = games.map((game) => resultFor(game, "moneyline", sideForGame(game)));
  const wins = results.filter((result) => result === "win").length;
  return { rows: results.length, wins, losses: results.length - wins, accuracy: round(results.length ? wins / results.length : null) };
}

function bucketSummary(games: readonly Game[], keyFor: (game: Game) => string) {
  const groups = new Map<string, Game[]>();
  for (const game of games) {
    const key = keyFor(game);
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, values]) => [key, {
    fastIndependent: binaryAccuracy(values, (game) => sideFor(game.forecasts.fast.independent, "moneyline")),
    fastFinal: binaryAccuracy(values, (game) => sideFor(game.forecasts.fast.final, "moneyline")),
    marketFavorite: binaryAccuracy(values, (game) => (game.snapshot.market.market_home_prob ?? 0.5) >= 0.5 ? 1 : -1),
  }]));
}

function marketDiagnostics(games: readonly Game[]) {
  const relation = (signal: Side | null, independent: Side) => signal === null ? "unavailable" : signal === independent ? "supports" : "opposes";
  return {
    agreement: bucketSummary(games, (game) => {
      const market = (game.snapshot.market.market_home_prob ?? 0.5) >= 0.5 ? 1 : -1;
      return market === sideFor(game.forecasts.fast.independent, "moneyline") ? "agree" : "conflict";
    }),
    readerDecision: bucketSummary(games, (game) => game.forecasts.fast.final.output.layers.market_decision),
    marketStrength: bucketSummary(games, (game) => {
      const strength = Math.abs((game.snapshot.market.market_home_prob ?? 0.5) - 0.5);
      return strength < 0.04 ? "weak_lt_4pp" : strength < 0.08 ? "moderate_4_to_8pp" : "strong_ge_8pp";
    }),
    movementVsIndependent: bucketSummary(games, (game) => {
      const move = game.snapshot.market.same_book_home_prob_move;
      const signal: Side | null = move === null || Math.abs(move) < 0.005 ? null : move > 0 ? 1 : -1;
      return relation(signal, sideFor(game.forecasts.fast.independent, "moneyline"));
    }),
    splitMoneyVsIndependent: bucketSummary(games, (game) => {
      const confidence = game.snapshot.market.ml_split_confidence;
      const money = game.snapshot.market.ml_home_money_pct;
      const signal: Side | null = confidence === "none" || money === null ? null : money >= 50 ? 1 : -1;
      return relation(signal, sideFor(game.forecasts.fast.independent, "moneyline"));
    }),
  };
}

function parity(games: readonly Game[]) {
  const fields: Array<keyof Pick<NhlModelOutput, "independent_goal_diff" | "independent_total_goals" | "expected_goal_diff" | "expected_total_goals">> = [
    "independent_goal_diff", "independent_total_goals", "expected_goal_diff", "expected_total_goals",
  ];
  return {
    games: games.length,
    maxAbsoluteDifference: Object.fromEntries(fields.map((field) => [field, round(Math.max(...games.map((game) => (
      Math.abs(game.storedOutput[field] - game.forecasts.fast.final.output[field])
    ))), 12)])),
    pickMismatches: games.filter((game) => (
      game.storedOutput.moneyline.pick !== game.forecasts.fast.final.output.moneyline.pick
      || game.storedOutput.puck_line.pick !== game.forecasts.fast.final.output.puck_line.pick
      || game.storedOutput.total.pick !== game.forecasts.fast.final.output.total.pick
    )).length,
  };
}

function gateReport(selection: readonly Game[], confirmation: readonly Game[], candidate: Head) {
  const baselineSelection = modelSummary(selection, "fast");
  const candidateSelection = modelSummary(selection, candidate);
  const baselineConfirmation = modelSummary(confirmation, "fast");
  const candidateConfirmation = modelSummary(confirmation, candidate);
  const baselineAction = actionabilitySummary([...selection, ...confirmation], "fast");
  const candidateAction = actionabilitySummary([...selection, ...confirmation], candidate);
  const netWins = (summary: ReturnType<typeof directionalSummary>) => summary.wins - summary.losses;
  const compressionDistance = (score: ReturnType<typeof scoreSummary>) => Math.abs((score.predictedBeyond1_5 ?? 0) - (score.actualBeyond1_5 ?? 0))
    + Math.abs((score.predictedBeyond2_5 ?? 0) - (score.actualBeyond2_5 ?? 0));
  const gates = {
    selectionMoneylineAccuracyNonDecline: (candidateSelection.final.moneyline.accuracy ?? -Infinity) >= (baselineSelection.final.moneyline.accuracy ?? -Infinity),
    confirmationMoneylineAccuracyNonDecline: (candidateConfirmation.final.moneyline.accuracy ?? -Infinity) >= (baselineConfirmation.final.moneyline.accuracy ?? -Infinity),
    confirmationMoneylineBrierWithin005: (candidateConfirmation.final.moneyline.brier ?? Infinity) <= (baselineConfirmation.final.moneyline.brier ?? Infinity) + 0.005,
    confirmationMarginMaeWithin010: (candidateConfirmation.final.score.marginMae ?? Infinity) <= (baselineConfirmation.final.score.marginMae ?? Infinity) + 0.10,
    confirmationTotalMaeWithin010: (candidateConfirmation.final.score.totalMae ?? Infinity) <= (baselineConfirmation.final.score.totalMae ?? Infinity) + 0.10,
    confirmationSpreadLosesAtMostOneNetWin: netWins(candidateConfirmation.final.spread) >= netWins(baselineConfirmation.final.spread) - 1,
    confirmationTotalLosesAtMostOneNetWin: netWins(candidateConfirmation.final.total) >= netWins(baselineConfirmation.final.total) - 1,
    compressionMovesTowardActual: compressionDistance(candidateConfirmation.final.score) <= compressionDistance(baselineConfirmation.final.score),
    pairedBoardImpact: candidateAction.promotions > 0 && candidateAction.demotions > 0,
  };
  return { passes: Object.values(gates).every(Boolean), gates, fullActionabilityImpact: candidateAction, baselineActionability: baselineAction };
}

async function main(): Promise<void> {
  const { data, error } = await supabase.from("prediction_records")
    .select("id,game_id,slate_date,locked_at,matchup,market,side,line_value,odds_american,model_probability,play_grade,no_bet,model_version,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result,actual_home_score,actual_away_score)")
    .eq("sport", "nhl")
    .in("model_version", [...RELEASES])
    .not("locked_at", "is", null)
    .in("market", [...MARKETS])
    .order("locked_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const grouped = new Map<number, Row[]>();
  for (const row of rows) grouped.set(row.game_id, [...(grouped.get(row.game_id) ?? []), row]);
  const games: Game[] = [];
  for (const gameRows of grouped.values()) {
    const first = gameRows[0]!;
    const grade = one(first.prediction_grades);
    const stored = first.snapshot_json;
    if (grade?.actual_home_score === null || grade?.actual_home_score === undefined
      || grade.actual_away_score === null || grade.actual_away_score === undefined
      || !stored?.feature_inputs || !stored.model_output) continue;
    const records = Object.fromEntries(MARKETS.map((market) => [market, gameRows.find((row) => row.market === market)])) as Partial<Record<Market, Row>>;
    if (MARKETS.some((market) => !records[market])) continue;
    const forecasts = Object.fromEntries(HEADS.map((head) => {
      const output = nhlRegularModelV1(snapshotForHead(stored.feature_inputs!, head));
      return [head, {
        independent: makeForecast(output, stored.feature_inputs!, "independent"),
        final: makeForecast(output, stored.feature_inputs!, "final"),
      }];
    })) as Game["forecasts"];
    games.push({
      id: first.game_id,
      date: first.slate_date,
      lockedAt: first.locked_at,
      matchup: first.matchup,
      release: first.model_version,
      phase: first.model_version === RELEASES[0] ? "selection" : "confirmation",
      actualHome: grade.actual_home_score,
      actualAway: grade.actual_away_score,
      snapshot: stored.feature_inputs,
      storedOutput: stored.model_output,
      lockedLines: stored.market_at_lock?.lines_snapshot ?? [],
      rows: records as Record<Market, Row>,
      forecasts,
    });
  }
  games.sort((left, right) => left.lockedAt.localeCompare(right.lockedAt));
  const selection = games.filter((game) => game.phase === "selection");
  const confirmation = games.filter((game) => game.phase === "confirmation");
  const cohorts: Record<Phase, Game[]> = { selection, confirmation, full: games };
  const report = {
    release: "nhl_opening_head_reader_audit_2026_10_23_r1",
    readOnly: true,
    writes: 0,
    chronology: {
      games: games.length,
      selectionGames: selection.length,
      confirmationGames: confirmation.length,
      selectionThrough: selection.at(-1)?.lockedAt ?? null,
      confirmationFrom: confirmation[0]?.lockedAt ?? null,
      byRelease: Object.fromEntries([...new Set(games.map((game) => game.release))].map((release) => [release, games.filter((game) => game.release === release).length])),
    },
    replayParity: parity(games),
    cohorts: Object.fromEntries((Object.entries(cohorts) as Array<[Phase, Game[]]>).map(([phase, phaseGames]) => [phase, {
      heads: Object.fromEntries(HEADS.map((head) => [head, {
        model: modelSummary(phaseGames, head),
        actionability: actionabilitySummary(phaseGames, head),
      }])),
      marketDiagnostics: marketDiagnostics(phaseGames),
    }])),
    advancementGates: Object.fromEntries((["roster", "mature"] as const).map((head) => [head, gateReport(selection, confirmation, head)])),
  };
  console.log(JSON.stringify(report, null, process.argv.includes("--compact") ? 0 : 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
