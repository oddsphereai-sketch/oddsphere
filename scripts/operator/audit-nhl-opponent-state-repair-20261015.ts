/**
 * SELECT-only counterfactual for the October 15 NHL opponent-state repair.
 *
 * Replays immutable feature snapshots through the current model after adding
 * only MoneyPuck game rows strictly earlier than each slate. It never mutates
 * a stored lock and never writes to the database.
 */

import { supabase } from "../../lib/db/supabase";
import {
  NHL_REGULAR_TRANSITION_MODEL_RELEASES,
  nhlRegularModelV1,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
} from "../../lib/automodel/nhlRegularModelV1";
import { loadNhlOpponentAdjustedState } from "../../lib/services/nhl/loadNhlOpponentAdjustedState";

const INCUMBENT_RELEASE = "nhl_regular_2026_r17_target_excluded_total_reconciliation";

type Market = "moneyline" | "spread" | "total";
type Outcome = "win" | "loss" | "push";

type Grade = {
  result: string | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_total: number | null;
};

type Row = {
  game_id: number;
  slate_date: string;
  game_date: string;
  matchup: string;
  market: Market;
  side: "home" | "away" | "over" | "under";
  line_value: number | null;
  model_version: string;
  snapshot_json: {
    feature_inputs?: NhlFeatureSnapshot;
    model_output?: NhlModelOutput;
  } | null;
  prediction_grades: Grade | Grade[] | null;
};

type Game = {
  id: number;
  slateDate: string;
  matchup: string;
  release: string;
  actualHome: number;
  actualAway: number;
  snapshot: NhlFeatureSnapshot;
  incumbent: NhlModelOutput;
  candidate: NhlModelOutput;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function round(value: number | null, digits = 5): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function summarize(outcomes: readonly Outcome[]) {
  const wins = outcomes.filter((outcome) => outcome === "win").length;
  const losses = outcomes.filter((outcome) => outcome === "loss").length;
  const pushes = outcomes.filter((outcome) => outcome === "push").length;
  return {
    wins,
    losses,
    pushes,
    settled: outcomes.length,
    winPct: wins + losses === 0 ? null : round(100 * wins / (wins + losses), 2),
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function correlation(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index]! - mx;
    const dy = ys[index]! - my;
    covariance += dx * dy;
    xVariance += dx * dx;
    yVariance += dy * dy;
  }
  return xVariance > 0 && yVariance > 0 ? covariance / Math.sqrt(xVariance * yVariance) : null;
}

function side(model: NhlModelOutput, market: Market, home: string): Row["side"] {
  if (market === "total") return model.total.pick.startsWith("OVER") ? "over" : "under";
  const pick = market === "moneyline" ? model.moneyline.pick : model.puck_line.pick;
  return pick.startsWith(home) ? "home" : "away";
}

function outcome(args: {
  market: Market;
  selectedSide: Row["side"];
  line: number | null;
  actualHome: number;
  actualAway: number;
  favorableDelta?: number;
}): Outcome {
  const delta = args.favorableDelta ?? 0;
  if (args.market === "moneyline") {
    const homeWon = args.actualHome > args.actualAway;
    return (args.selectedSide === "home") === homeWon ? "win" : "loss";
  }
  if (args.line === null) throw new Error(`missing ${args.market} line`);
  if (args.market === "spread") {
    const selectedMargin = args.selectedSide === "home"
      ? args.actualHome - args.actualAway
      : args.actualAway - args.actualHome;
    const result = selectedMargin + args.line + delta;
    return result === 0 ? "push" : result > 0 ? "win" : "loss";
  }
  const actualTotal = args.actualHome + args.actualAway;
  const adjustedLine = args.selectedSide === "over" ? args.line - delta : args.line + delta;
  return actualTotal === adjustedLine
    ? "push"
    : args.selectedSide === "over"
      ? actualTotal > adjustedLine ? "win" : "loss"
      : actualTotal < adjustedLine ? "win" : "loss";
}

function marketLine(game: Game, model: NhlModelOutput, market: Market): number | null {
  if (market === "moneyline") return null;
  return market === "total"
    ? game.snapshot.market.market_total_line
    : model.puck_line.puck_line_value;
}

function record(games: readonly Game[], key: "incumbent" | "candidate", market: Market, delta = 0) {
  return summarize(games.map((game) => {
    const model = game[key];
    return outcome({
      market,
      selectedSide: side(model, market, game.snapshot.home.abbreviation),
      line: marketLine(game, model, market),
      actualHome: game.actualHome,
      actualAway: game.actualAway,
      favorableDelta: delta,
    });
  }));
}

function correctionSummary(games: readonly Game[], market: Market) {
  let sideChanges = 0;
  let corrections = 0;
  let harms = 0;
  let pushChanges = 0;
  const changedGames: Array<Record<string, unknown>> = [];
  for (const game of games) {
    const home = game.snapshot.home.abbreviation;
    const beforeSide = side(game.incumbent, market, home);
    const afterSide = side(game.candidate, market, home);
    const beforeLine = marketLine(game, game.incumbent, market);
    const afterLine = marketLine(game, game.candidate, market);
    if (beforeSide === afterSide && beforeLine === afterLine) continue;
    sideChanges += 1;
    const before = outcome({ market, selectedSide: beforeSide, line: beforeLine, actualHome: game.actualHome, actualAway: game.actualAway });
    const after = outcome({ market, selectedSide: afterSide, line: afterLine, actualHome: game.actualHome, actualAway: game.actualAway });
    if (before === "loss" && after === "win") corrections += 1;
    else if (before === "win" && after === "loss") harms += 1;
    else if (before !== after) pushChanges += 1;
    changedGames.push({
      gameId: game.id,
      date: game.slateDate,
      matchup: game.matchup,
      beforeSide,
      afterSide,
      beforeLine,
      afterLine,
      before,
      after,
    });
  }
  return { sideChanges, corrections, harms, pushChanges, changedGames };
}

function diagnostics(games: readonly Game[], key: "incumbent" | "candidate") {
  const actualMargins = games.map((game) => game.actualHome - game.actualAway);
  const actualTotals = games.map((game) => game.actualHome + game.actualAway);
  const margins = games.map((game) => game[key].expected_goal_diff);
  const totals = games.map((game) => game[key].expected_total_goals);
  return {
    marginMae: round(mean(margins.map((value, index) => Math.abs(value - actualMargins[index]!)))),
    totalMae: round(mean(totals.map((value, index) => Math.abs(value - actualTotals[index]!)))),
    marginBias: round(mean(margins.map((value, index) => value - actualMargins[index]!))),
    totalBias: round(mean(totals.map((value, index) => value - actualTotals[index]!))),
    marginCorrelation: round(correlation(margins, actualMargins)),
    totalCorrelation: round(correlation(totals, actualTotals)),
  };
}

function verdict(model: NhlModelOutput, market: Market): NhlModelOutput["moneyline"]["verdict"] {
  return market === "moneyline"
    ? model.moneyline.verdict
    : market === "spread" ? model.puck_line.verdict : model.total.verdict;
}

function verdictImpact(games: readonly Game[]) {
  const order = { pass: 0, watchlist: 1, lean: 2, best_angle: 3 } as const;
  const counts = (key: "incumbent" | "candidate") => {
    const values = games.flatMap((game) => (["moneyline", "spread", "total"] as const)
      .map((market) => verdict(game[key], market)));
    return {
      bestAngle: values.filter((value) => value === "best_angle").length,
      lean: values.filter((value) => value === "lean").length,
      watchlist: values.filter((value) => value === "watchlist").length,
      pass: values.filter((value) => value === "pass").length,
      actionable: values.filter((value) => value === "best_angle" || value === "lean").length,
    };
  };
  let promotions = 0;
  let demotions = 0;
  for (const game of games) {
    for (const market of ["moneyline", "spread", "total"] as const) {
      const before = verdict(game.incumbent, market);
      const after = verdict(game.candidate, market);
      if (order[after] > order[before]) promotions += 1;
      if (order[after] < order[before]) demotions += 1;
    }
  }
  return { incumbent: counts("incumbent"), candidate: counts("candidate"), promotions, demotions };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function poissonPmf(lambda: number, k: number): number {
  let value = Math.exp(-lambda);
  for (let index = 1; index <= k; index += 1) value *= lambda / index;
  return value;
}

function totalSide(expectedTotal: number, line: number): "over" | "under" {
  let over = 0;
  let under = 0;
  for (let goals = 0; goals <= 24; goals += 1) {
    const probability = poissonPmf(expectedTotal, goals);
    if (goals > line) over += probability;
    else if (goals < line) under += probability;
  }
  return over >= under ? "over" : "under";
}

function totalAuthorityGrid(games: readonly Game[], key: "incumbent" | "candidate") {
  return [0, 0.25, 0.5, 0.75, 1].map((scale) => {
    const rows = games.map((game) => {
      const model = game[key];
      const movement = clamp((game.snapshot.market.same_book_total_move ?? 0) * 0.35, -0.25, 0.25);
      const independent = clamp(model.independent_total_goals + movement, 4.5, 8);
      const target = model.layers.total_market_target_goals;
      const authority = model.layers.total_market_authority * scale;
      const expected = target === null
        ? independent
        : clamp(independent + authority * (target - independent), 4.5, 8);
      const line = game.snapshot.market.market_total_line;
      if (line === null) throw new Error(`missing Total line for ${game.matchup}`);
      const selectedSide = totalSide(expected, line);
      return {
        outcome: outcome({
          market: "total",
          selectedSide,
          line,
          actualHome: game.actualHome,
          actualAway: game.actualAway,
        }),
        error: Math.abs(expected - (game.actualHome + game.actualAway)),
        storedSideContradiction: scale === 1
          && selectedSide !== side(model, "total", game.snapshot.home.abbreviation),
      };
    });
    return {
      scale,
      record: summarize(rows.map((row) => row.outcome)),
      totalMae: round(mean(rows.map((row) => row.error))),
      storedSideContradictions: rows.filter((row) => row.storedSideContradiction).length,
    };
  });
}

function report(games: readonly Game[]) {
  return {
    games: games.length,
    records: {
      incumbent: {
        moneyline: record(games, "incumbent", "moneyline"),
        puckLine: record(games, "incumbent", "spread"),
        puckPlus1: record(games, "incumbent", "spread", 1),
        puckPlus2: record(games, "incumbent", "spread", 2),
        total: record(games, "incumbent", "total"),
        totalPlus1: record(games, "incumbent", "total", 1),
        totalPlus2: record(games, "incumbent", "total", 2),
      },
      candidate: {
        moneyline: record(games, "candidate", "moneyline"),
        puckLine: record(games, "candidate", "spread"),
        puckPlus1: record(games, "candidate", "spread", 1),
        puckPlus2: record(games, "candidate", "spread", 2),
        total: record(games, "candidate", "total"),
        totalPlus1: record(games, "candidate", "total", 1),
        totalPlus2: record(games, "candidate", "total", 2),
      },
    },
    diagnostics: {
      incumbent: diagnostics(games, "incumbent"),
      candidate: diagnostics(games, "candidate"),
    },
    rawModelVerdictImpact: verdictImpact(games),
    changes: {
      moneyline: correctionSummary(games, "moneyline"),
      puckLine: correctionSummary(games, "spread"),
      total: correctionSummary(games, "total"),
    },
    totalAuthoritySensitivity: {
      incumbentInputs: totalAuthorityGrid(games, "incumbent"),
      repairedInputs: totalAuthorityGrid(games, "candidate"),
    },
  };
}

async function main(): Promise<void> {
  const { data, error } = await supabase.from("prediction_records")
    .select("game_id,slate_date,game_date,matchup,market,side,line_value,model_version,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result,actual_home_score,actual_away_score,actual_total)")
    .eq("sport", "nhl")
    .in("model_version", [...NHL_REGULAR_TRANSITION_MODEL_RELEASES])
    .in("market", ["moneyline", "spread", "total"])
    .not("locked_at", "is", null)
    .order("game_date", { ascending: true });
  if (error) throw new Error(error.message);

  const byGame = new Map<number, Row[]>();
  for (const row of (data ?? []) as unknown as Row[]) {
    byGame.set(row.game_id, [...(byGame.get(row.game_id) ?? []), row]);
  }
  const stateByDate = new Map<string, Awaited<ReturnType<typeof loadNhlOpponentAdjustedState>>>();
  const games: Game[] = [];
  for (const [gameId, rows] of byGame) {
    const first = rows[0]!;
    const grade = one(first.prediction_grades);
    const snapshot = first.snapshot_json?.feature_inputs;
    const incumbent = first.snapshot_json?.model_output;
    if (rows.length !== 3 || !grade || grade.actual_home_score === null || grade.actual_away_score === null || !snapshot || !incumbent) continue;
    let loaded = stateByDate.get(first.slate_date);
    if (!loaded) {
      loaded = await loadNhlOpponentAdjustedState(2026, first.slate_date);
      if (!loaded.complete) throw new Error(`opponent state incomplete for ${first.slate_date}: ${loaded.error ?? "unknown"}`);
      stateByDate.set(first.slate_date, loaded);
    }
    const homeState = loaded.states.get(snapshot.home.abbreviation);
    const awayState = loaded.states.get(snapshot.away.abbreviation);
    const homeFastState = loaded.fastStates.get(snapshot.home.abbreviation);
    const awayFastState = loaded.fastStates.get(snapshot.away.abbreviation);
    if (!homeState || !awayState || !homeFastState || !awayFastState) throw new Error(`missing state for ${first.matchup}`);
    const repairedSnapshot: NhlFeatureSnapshot = {
      ...structuredClone(snapshot),
      home: {
        ...structuredClone(snapshot.home),
        opponent_adjusted_attack: homeState.attack,
        opponent_adjusted_defense_weakness: homeState.defenseWeakness,
        fast_state: homeFastState,
      },
      away: {
        ...structuredClone(snapshot.away),
        opponent_adjusted_attack: awayState.attack,
        opponent_adjusted_defense_weakness: awayState.defenseWeakness,
        fast_state: awayFastState,
      },
    };
    games.push({
      id: gameId,
      slateDate: first.slate_date,
      matchup: first.matchup,
      release: first.model_version,
      actualHome: grade.actual_home_score,
      actualAway: grade.actual_away_score,
      snapshot,
      incumbent,
      candidate: nhlRegularModelV1(repairedSnapshot),
    });
  }

  const allTransitionLocks = report(games);
  const active = games.filter((game) => game.release === INCUMBENT_RELEASE);
  const activeR17Only = report(active);
  const cut = Math.floor(active.length * 0.70);
  const activeR17Chronology = {
    selection: report(active.slice(0, cut)),
    confirmation: report(active.slice(cut)),
  };
  const output = {
    provenance: {
      note: "Opened reconstruction using current MoneyPuck rows; every replay includes only games strictly before its slate date.",
      dates: [...stateByDate.entries()].map(([date, value]) => ({ date, gamesApplied: value.gamesApplied, source: value.source, requests: value.requestCount })),
    },
    allTransitionLocks,
    activeR17Only,
    activeR17Chronology,
  };
  if (process.argv.includes("--compact")) {
    const compact = (value: ReturnType<typeof report>) => ({
      games: value.games,
      records: value.records,
      diagnostics: value.diagnostics,
      rawModelVerdictImpact: value.rawModelVerdictImpact,
      changes: Object.fromEntries(Object.entries(value.changes).map(([market, change]) => [market, {
        sideChanges: change.sideChanges,
        corrections: change.corrections,
        harms: change.harms,
        pushChanges: change.pushChanges,
      }])),
    });
    console.log(JSON.stringify({
      provenance: output.provenance,
      allTransitionLocks: compact(allTransitionLocks),
      activeR17Only: compact(activeR17Only),
      activeR17Chronology: {
        selection: compact(activeR17Chronology.selection),
        confirmation: compact(activeR17Chronology.confirmation),
      },
    }, null, 2));
    return;
  }
  if (process.argv.includes("--sensitivity-only")) {
    console.log(JSON.stringify({
      allTransitionLocks: allTransitionLocks.totalAuthoritySensitivity,
      activeR17Only: activeR17Only.totalAuthoritySensitivity,
      activeR17Chronology: {
        selection: activeR17Chronology.selection.totalAuthoritySensitivity,
        confirmation: activeR17Chronology.confirmation.totalAuthoritySensitivity,
      },
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
