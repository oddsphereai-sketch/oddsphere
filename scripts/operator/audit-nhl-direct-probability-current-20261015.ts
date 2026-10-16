/** SELECT-only seven-lane replay for the October 15 NHL direct-probability candidate. */

import fs from "node:fs";
import { supabase } from "../../lib/db/supabase";
import { NHL_REGULAR_TRANSITION_MODEL_RELEASES } from "../../lib/automodel/nhlRegularModelV1";

type Outcome = "win" | "loss" | "push";
type Candidate = {
  external_id: number;
  home_probability: number;
  independent_total: number;
  independent_goal_diff: number;
};
type Grade = { actual_home_score: number | null; actual_away_score: number | null; result: string | null };
type Market = {
  market_home_prob: number | null;
  market_home_puck_line: number | null;
  market_away_puck_line: number | null;
  market_total_line: number | null;
  market_book_count: number;
  ml_home_bets_pct: number | null;
  ml_home_money_pct: number | null;
  ml_split_confidence: "high" | "medium" | "low" | "none";
  same_book_home_prob_move: number | null;
  same_book_total_move: number | null;
  target_excluded_total_read?: {
    exact_line: number;
    over_probability: number;
    complete_book_count: number;
    named_book_count: number;
    stable_sequence_direction: "over" | "under" | null;
  } | null;
};
type RecordRow = {
  id: number;
  game_id: number;
  market: "moneyline" | "spread" | "total";
  model_version: string;
  side: string;
  line_value: number | null;
  snapshot_json: { feature_inputs?: { market?: Market } } | null;
  prediction_grades: Grade | Grade[] | null;
};

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function poisson(lambda: number, maximum = 12) {
  const values = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maximum; goals += 1) values.push(values[goals - 1]! * lambda / goals);
  values[maximum] = values[maximum]! + Math.max(0, 1 - values.reduce((sum, value) => sum + value, 0));
  return values;
}

function distribution(total: number, margin: number) {
  const homePmf = poisson(Math.max(0, (total + margin) / 2));
  const awayPmf = poisson(Math.max(0, (total - margin) / 2));
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
  const overtimeHome = 1 / (1 + Math.exp(-0.42 * margin));
  return { homeWin: homeRegulation + tie * overtimeHome, margins, totals };
}

function marginForProbability(total: number, target: number) {
  let low = -Math.min(5, total - 2.5);
  let high = Math.min(5, total - 2.5);
  for (let index = 0; index < 50; index += 1) {
    const margin = (low + high) / 2;
    if (distribution(total, margin).homeWin < target) low = margin;
    else high = margin;
  }
  return (low + high) / 2;
}

function overProbability(totals: Map<number, number>, line: number) {
  let value = 0;
  for (const [goals, probability] of totals) if (goals > line) value += probability;
  return value;
}

function underProbability(totals: Map<number, number>, line: number) {
  let value = 0;
  for (const [goals, probability] of totals) if (goals < line) value += probability;
  return value;
}

function totalForOverProbability(line: number, target: number) {
  let low = 3.5;
  let high = 9;
  for (let index = 0; index < 50; index += 1) {
    const total = (low + high) / 2;
    if (overProbability(distribution(total, 0).totals, line) < target) low = total;
    else high = total;
  }
  return (low + high) / 2;
}

function marketCorroborated(market: Market, marketHome: boolean) {
  if (market.market_book_count < 2) return false;
  if (market.ml_split_confidence !== "high" && market.ml_split_confidence !== "medium") return false;
  if (market.ml_home_bets_pct === null || market.ml_home_money_pct === null) return false;
  if (market.same_book_home_prob_move === null || Math.abs(market.same_book_home_prob_move) < 0.01) return false;
  const moveAgrees = marketHome ? market.same_book_home_prob_move > 0 : market.same_book_home_prob_move < 0;
  const splitsAgree = marketHome
    ? market.ml_home_bets_pct >= 55 && market.ml_home_money_pct >= 55
    : market.ml_home_bets_pct <= 45 && market.ml_home_money_pct <= 45;
  return moveAgrees && splitsAgree;
}

function settle(value: number): Outcome {
  return value > 0 ? "win" : value < 0 ? "loss" : "push";
}

function summarize(values: Outcome[]) {
  const wins = values.filter((value) => value === "win").length;
  const losses = values.filter((value) => value === "loss").length;
  const pushes = values.filter((value) => value === "push").length;
  return { wins, losses, pushes, record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`, winPct: Number((100 * wins / Math.max(1, wins + losses)).toFixed(2)) };
}

async function main() {
  const path = process.argv.find((value) => value.startsWith("--candidate="))?.slice("--candidate=".length);
  if (!path) throw new Error("missing --candidate=<json>");
  const payload = JSON.parse(fs.readFileSync(path, "utf8")) as { games: Candidate[] };
  const candidateByExternal = new Map(payload.games.map((game) => [game.external_id, game]));
  const { data, error } = await supabase.from("prediction_records")
    .select("id,game_id,market,model_version,side,line_value,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(actual_home_score,actual_away_score,result)")
    .eq("sport", "nhl")
    .in("model_version", [...NHL_REGULAR_TRANSITION_MODEL_RELEASES])
    .not("locked_at", "is", null)
    .in("market", ["moneyline", "spread", "total"]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RecordRow[];
  const gameIds = [...new Set(rows.map((row) => row.game_id))];
  const gameResult = await supabase.from("games").select("id,external_id").in("id", gameIds);
  if (gameResult.error) throw new Error(gameResult.error.message);
  const externalByInternal = new Map((gameResult.data ?? []).map((game) => [Number(game.id), Number(game.external_id)]));
  const representative = new Map<number, RecordRow>();
  for (const row of rows) {
    const grade = one(row.prediction_grades);
    if (grade?.actual_home_score === null || grade?.actual_away_score === null) continue;
    if (!representative.has(row.game_id)) representative.set(row.game_id, row);
  }
  const outcomes = {
    independentMoneyline: [] as Outcome[], moneyline: [] as Outcome[], spread: [] as Outcome[], spreadPlus1: [] as Outcome[], spreadPlus2: [] as Outcome[],
    total: [] as Outcome[], totalPlus1: [] as Outcome[], totalPlus2: [] as Outcome[],
  };
  let flips = 0;
  let flipCorrections = 0;
  let flipHarms = 0;
  let totalReads = 0;
  const ledger = [];
  for (const [gameId, row] of representative) {
    const externalId = externalByInternal.get(gameId);
    const candidate = externalId === undefined ? undefined : candidateByExternal.get(externalId);
    const grade = one(row.prediction_grades);
    const market = row.snapshot_json?.feature_inputs?.market;
    if (!candidate || !grade || !market || grade.actual_home_score === null || grade.actual_away_score === null) continue;
    const actualMargin = grade.actual_home_score - grade.actual_away_score;
    const actualTotal = grade.actual_home_score + grade.actual_away_score;
    const marketHome = market.market_home_prob;
    const marketSideHome = marketHome === null ? candidate.home_probability >= .5 : marketHome >= .5;
    const marketStrong = marketHome !== null && (marketSideHome ? marketHome >= .54 : marketHome <= .46);
    const conflict = marketHome !== null && marketSideHome !== (candidate.home_probability >= .5);
    const flip = marketStrong && conflict && marketCorroborated(market, marketSideHome);
    if (flip) flips += 1;
    const finalHomeProbability = flip ? marketHome! : candidate.home_probability;
    const movement = market.same_book_total_move === null ? 0 : clamp(market.same_book_total_move * .35, -.25, .25);
    const incumbentTotal = clamp(candidate.independent_total + movement, 4.5, 8);
    const totalRead = market.target_excluded_total_read ?? null;
    const marketTotal = market.market_total_line;
    const readMatches = totalRead !== null && marketTotal !== null
      && Math.abs(totalRead.exact_line - marketTotal) < .01 && totalRead.complete_book_count >= 2;
    let authority = readMatches ? (totalRead!.named_book_count > 0 ? 1 : .8) : 0;
    const targetTotal = readMatches ? totalForOverProbability(marketTotal!, totalRead!.over_probability) : null;
    if (targetTotal !== null && totalRead!.stable_sequence_direction !== null) {
      const direction = targetTotal > incumbentTotal ? "over" : "under";
      if (direction !== totalRead!.stable_sequence_direction) authority *= .65;
    }
    if (targetTotal !== null) totalReads += 1;
    const finalTotal = targetTotal === null ? incumbentTotal : clamp(incumbentTotal + authority * (targetTotal - incumbentTotal), 4.5, 8);
    const finalMargin = marginForProbability(finalTotal, finalHomeProbability);
    const finalDistribution = distribution(finalTotal, finalMargin);
    const homeMl = finalHomeProbability >= .5;
    const independentHomeMl = candidate.home_probability >= .5;
    const independentMlOutcome = settle(independentHomeMl ? actualMargin : -actualMargin);
    outcomes.independentMoneyline.push(independentMlOutcome);
    outcomes.moneyline.push(settle(homeMl ? actualMargin : -actualMargin));
    if (flip) {
      const finalMlOutcome = settle(homeMl ? actualMargin : -actualMargin);
      if (finalMlOutcome === "win" && independentMlOutcome === "loss") flipCorrections += 1;
      if (finalMlOutcome === "loss" && independentMlOutcome === "win") flipHarms += 1;
    }
    const homeFavorite = marketHome === null ? finalMargin >= 0 : marketHome >= .5;
    const homeLine = market.market_home_puck_line ?? (homeFavorite ? -1.5 : 1.5);
    const awayLine = market.market_away_puck_line ?? -homeLine;
    let homeCover = 0;
    for (const [margin, probability] of finalDistribution.margins) if (margin + homeLine > 0) homeCover += probability;
    const homePuck = homeCover >= .5;
    const pickLine = homePuck ? homeLine : awayLine;
    const puckSettlement = (homePuck ? actualMargin : -actualMargin) + pickLine;
    outcomes.spread.push(settle(puckSettlement));
    outcomes.spreadPlus1.push(settle(puckSettlement + 1));
    outcomes.spreadPlus2.push(settle(puckSettlement + 2));
    if (marketTotal !== null) {
      const over = overProbability(finalDistribution.totals, marketTotal);
      const under = underProbability(finalDistribution.totals, marketTotal);
      const pickOver = over >= under;
      const totalSettlement = pickOver ? actualTotal - marketTotal : marketTotal - actualTotal;
      outcomes.total.push(settle(totalSettlement));
      outcomes.totalPlus1.push(settle(totalSettlement + 1));
      outcomes.totalPlus2.push(settle(totalSettlement + 2));
    }
    ledger.push({ externalId, candidateHomeProbability: candidate.home_probability, finalHomeProbability, flip, independentTotal: candidate.independent_total, finalTotal });
  }
  console.log(JSON.stringify({
    games: ledger.length,
    marketReader: { moneylineFlips: flips, flipCorrections, flipHarms, targetExcludedTotalReads: totalReads },
    candidate: {
      independentMoneyline: summarize(outcomes.independentMoneyline),
      moneyline: summarize(outcomes.moneyline),
      puckLine: summarize(outcomes.spread),
      puckLinePlus1: summarize(outcomes.spreadPlus1),
      puckLinePlus2: summarize(outcomes.spreadPlus2),
      total: summarize(outcomes.total),
      totalPlus1: summarize(outcomes.totalPlus1),
      totalPlus2: summarize(outcomes.totalPlus2),
    },
    competitor: {
      moneyline: "52-34 (60.5%)", puckLine: "49-37 (57.0%)", puckLinePlus1: "61-25 (70.9%)", puckLinePlus2: "75-11 (87.2%)",
      total: "44-42 (51.2%)", totalPlus1: "64-22 (74.4%)", totalPlus2: "70-16 (81.4%)",
    },
    ledger,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
