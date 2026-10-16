/**
 * SELECT-only NHL baseline used by the October 15 foundational audit.
 *
 * Reads immutable locked predictions and their stored grades. It does not
 * call providers and does not write to the database.
 */

import { supabase } from "../../lib/db/supabase";
import {
  NHL_REGULAR_MODEL_RELEASE,
  NHL_REGULAR_TRANSITION_MODEL_RELEASES,
  nhlRegularModelV1,
  type NhlFeatureSnapshot,
} from "../../lib/automodel/nhlRegularModelV1";
import { alternateLineOutcome } from "../../lib/services/tracking/alternateLinePerformance";

type Market = "moneyline" | "spread" | "total";
type Outcome = "win" | "loss" | "push";

type Grade = {
  result: string | null;
  win: boolean | null;
  loss: boolean | null;
  push: boolean | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_total: number | null;
};

type Row = {
  id: number;
  game_id: number;
  slate_date: string;
  game_date: string;
  matchup: string;
  market: Market;
  pick: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  play_grade: string | null;
  model_version: string;
  calibration_version: string;
  locked_at: string;
  snapshot_json: {
    goalie_assumption?: {
      home?: { player_name?: string | null; source?: string | null };
      away?: { player_name?: string | null; source?: string | null };
    };
    model_output?: {
      independent_goal_diff?: number;
      independent_total_goals?: number;
      expected_goal_diff?: number;
      expected_total_goals?: number;
      projected_home_goals?: number;
      projected_away_goals?: number;
      layers?: {
        market_decision?: string;
        total_market_authority?: number;
        total_market_complete_books?: number;
        total_market_named_books?: number;
        roster_prior_active?: boolean;
      };
    };
    feature_inputs?: {
      home?: {
        goalie_xgsaa_per_60?: number | null;
        roster_prior?: unknown;
        provider_metrics?: unknown;
        x_goals_for_per_60?: number | null;
        five_x_goals_for_per_60?: number | null;
        pp_x_goals_for_per_game?: number | null;
        pk_x_goals_against_per_game?: number | null;
        opponent_adjusted_attack?: number | null;
        opponent_adjusted_defense_weakness?: number | null;
        rest_days?: number | null;
      };
      away?: {
        goalie_xgsaa_per_60?: number | null;
        roster_prior?: unknown;
        provider_metrics?: unknown;
        x_goals_for_per_60?: number | null;
        five_x_goals_for_per_60?: number | null;
        pp_x_goals_for_per_game?: number | null;
        pk_x_goals_against_per_game?: number | null;
        opponent_adjusted_attack?: number | null;
        opponent_adjusted_defense_weakness?: number | null;
        rest_days?: number | null;
      };
      market?: {
        market_home_prob?: number | null;
        market_home_puck_line?: number | null;
        market_away_puck_line?: number | null;
        market_total_line?: number | null;
        market_book_count?: number;
        ml_home_bets_pct?: number | null;
        ml_home_money_pct?: number | null;
        total_over_bets_pct?: number | null;
        total_over_money_pct?: number | null;
      };
    };
  } | null;
  prediction_grades: Grade | Grade[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mean(values: number[]) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(5)) : null;
}

function correlation(xs: number[], ys: number[]) {
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
  return xVariance > 0 && yVariance > 0
    ? Number((covariance / Math.sqrt(xVariance * yVariance)).toFixed(5))
    : null;
}

function changedSideSummary(rows: Row[]) {
  const scoped = rows.flatMap((row) => {
    const final = storedOutcome(one(row.prediction_grades));
    const independent = independentOutcome(row);
    if (final === null || independent === null || final === independent) return [];
    return [{ final, independent }];
  });
  return {
    changedOutcomes: scoped.length,
    corrections: scoped.filter((row) => row.final === "win" && row.independent === "loss").length,
    harms: scoped.filter((row) => row.final === "loss" && row.independent === "win").length,
    pushChanges: scoped.filter((row) => row.final === "push" || row.independent === "push").length,
  };
}

function featureCoverage(rows: Row[]) {
  const games = [...new Map(rows.map((row) => [row.game_id, row])).values()];
  const present = (selector: (row: Row) => unknown) => games.filter((row) => {
    const value = selector(row);
    return value !== null && value !== undefined && value !== false;
  }).length;
  const pairPresent = (selector: (row: Row) => [unknown, unknown]) => games.filter((row) => {
    const [first, second] = selector(row);
    return first !== null && first !== undefined && second !== null && second !== undefined;
  }).length;
  return {
    games: games.length,
    assumedGoalieNamesBoth: pairPresent((row) => [row.snapshot_json?.goalie_assumption?.home?.player_name, row.snapshot_json?.goalie_assumption?.away?.player_name]),
    goalieQualityBoth: pairPresent((row) => [row.snapshot_json?.feature_inputs?.home?.goalie_xgsaa_per_60, row.snapshot_json?.feature_inputs?.away?.goalie_xgsaa_per_60]),
    rosterPriorBoth: pairPresent((row) => [row.snapshot_json?.feature_inputs?.home?.roster_prior, row.snapshot_json?.feature_inputs?.away?.roster_prior]),
    rosterPriorActive: present((row) => row.snapshot_json?.model_output?.layers?.roster_prior_active),
    providerMetricsBoth: pairPresent((row) => [row.snapshot_json?.feature_inputs?.home?.provider_metrics, row.snapshot_json?.feature_inputs?.away?.provider_metrics]),
    currentXgBoth: pairPresent((row) => [row.snapshot_json?.feature_inputs?.home?.x_goals_for_per_60, row.snapshot_json?.feature_inputs?.away?.x_goals_for_per_60]),
    fiveOnFiveBoth: pairPresent((row) => [row.snapshot_json?.feature_inputs?.home?.five_x_goals_for_per_60, row.snapshot_json?.feature_inputs?.away?.five_x_goals_for_per_60]),
    specialTeamsBoth: games.filter((row) => [
      row.snapshot_json?.feature_inputs?.home?.pp_x_goals_for_per_game,
      row.snapshot_json?.feature_inputs?.home?.pk_x_goals_against_per_game,
      row.snapshot_json?.feature_inputs?.away?.pp_x_goals_for_per_game,
      row.snapshot_json?.feature_inputs?.away?.pk_x_goals_against_per_game,
    ].every((value) => value !== null && value !== undefined)).length,
    opponentAdjustedBoth: games.filter((row) => [
      row.snapshot_json?.feature_inputs?.home?.opponent_adjusted_attack,
      row.snapshot_json?.feature_inputs?.home?.opponent_adjusted_defense_weakness,
      row.snapshot_json?.feature_inputs?.away?.opponent_adjusted_attack,
      row.snapshot_json?.feature_inputs?.away?.opponent_adjusted_defense_weakness,
    ].every((value) => value !== null && value !== undefined)).length,
    restBoth: pairPresent((row) => [row.snapshot_json?.feature_inputs?.home?.rest_days, row.snapshot_json?.feature_inputs?.away?.rest_days]),
    completeMarketBooks2Plus: games.filter((row) => Number(row.snapshot_json?.feature_inputs?.market?.market_book_count ?? 0) >= 2).length,
    moneylineSplitsComplete: games.filter((row) => [
      row.snapshot_json?.feature_inputs?.market?.ml_home_bets_pct,
      row.snapshot_json?.feature_inputs?.market?.ml_home_money_pct,
    ].every((value) => value !== null && value !== undefined)).length,
    totalSplitsComplete: games.filter((row) => [
      row.snapshot_json?.feature_inputs?.market?.total_over_bets_pct,
      row.snapshot_json?.feature_inputs?.market?.total_over_money_pct,
    ].every((value) => value !== null && value !== undefined)).length,
    targetExcludedTotalRead: games.filter((row) => Number(row.snapshot_json?.model_output?.layers?.total_market_complete_books ?? 0) >= 2).length,
  };
}

function diagnostics(rows: Row[]) {
  const games = [...new Map(rows.map((row) => [row.game_id, row])).values()];
  const vectors = games.flatMap((row) => {
    const grade = one(row.prediction_grades);
    const model = row.snapshot_json?.model_output;
    if (!grade || grade.actual_home_score === null || grade.actual_away_score === null || !model) return [];
    if (![model.independent_goal_diff, model.independent_total_goals, model.expected_goal_diff, model.expected_total_goals].every(Number.isFinite)) return [];
    return [{
      actualMargin: grade.actual_home_score - grade.actual_away_score,
      actualTotal: grade.actual_total ?? grade.actual_home_score + grade.actual_away_score,
      independentMargin: Number(model.independent_goal_diff),
      independentTotal: Number(model.independent_total_goals),
      finalMargin: Number(model.expected_goal_diff),
      finalTotal: Number(model.expected_total_goals),
    }];
  });
  return {
    independentMarginCorrelation: correlation(vectors.map((row) => row.independentMargin), vectors.map((row) => row.actualMargin)),
    finalMarginCorrelation: correlation(vectors.map((row) => row.finalMargin), vectors.map((row) => row.actualMargin)),
    independentTotalCorrelation: correlation(vectors.map((row) => row.independentTotal), vectors.map((row) => row.actualTotal)),
    finalTotalCorrelation: correlation(vectors.map((row) => row.finalTotal), vectors.map((row) => row.actualTotal)),
    independentMarginBias: mean(vectors.map((row) => row.independentMargin - row.actualMargin)),
    finalMarginBias: mean(vectors.map((row) => row.finalMargin - row.actualMargin)),
    independentTotalBias: mean(vectors.map((row) => row.independentTotal - row.actualTotal)),
    finalTotalBias: mean(vectors.map((row) => row.finalTotal - row.actualTotal)),
  };
}

function gradePerformance(rows: Row[]) {
  return Object.fromEntries([...new Set(rows.map((row) => row.play_grade ?? "unknown"))].sort().map((grade) => [
    grade,
    summarize(rows.filter((row) => (row.play_grade ?? "unknown") === grade).map((row) => storedOutcome(one(row.prediction_grades)))),
  ]));
}

function storedOutcome(grade: Grade | null): Outcome | null {
  if (!grade) return null;
  if (grade.result === "win" || grade.win) return "win";
  if (grade.result === "loss" || grade.loss) return "loss";
  if (grade.result === "push" || grade.push) return "push";
  return null;
}

function summarize(outcomes: Array<Outcome | null>) {
  const settled = outcomes.filter((outcome): outcome is Outcome => outcome !== null);
  const wins = settled.filter((outcome) => outcome === "win").length;
  const losses = settled.filter((outcome) => outcome === "loss").length;
  const pushes = settled.filter((outcome) => outcome === "push").length;
  return {
    wins,
    losses,
    pushes,
    settled: settled.length,
    winPct: wins + losses > 0 ? Number((100 * wins / (wins + losses)).toFixed(2)) : null,
  };
}

function independentOutcome(row: Row): Outcome | null {
  const grade = one(row.prediction_grades);
  const stored = row.snapshot_json?.feature_inputs;
  if (!grade || grade.actual_home_score === null || grade.actual_away_score === null || !stored) return null;
  const snapshot = structuredClone(stored) as unknown as NhlFeatureSnapshot;
  snapshot.market = {
    ...snapshot.market,
    market_home_prob: null,
    market_open_home_prob: null,
    same_book_home_prob_move: null,
    same_book_total_move: null,
    ml_home_bets_pct: null,
    ml_home_money_pct: null,
    total_over_bets_pct: null,
    total_over_money_pct: null,
    ml_split_source: null,
    ml_split_confidence: "none",
    total_split_source: null,
    total_split_confidence: "none",
    target_excluded_total_read: null,
    target_exclusion_status: "unavailable",
  };
  const model = nhlRegularModelV1(snapshot);
  const actualMargin = grade.actual_home_score - grade.actual_away_score;
  const actualTotal = grade.actual_total ?? grade.actual_home_score + grade.actual_away_score;
  if (row.market === "moneyline") {
    const home = model.moneyline.pick.startsWith(snapshot.home.abbreviation);
    return (home ? actualMargin > 0 : actualMargin < 0) ? "win" : "loss";
  }
  if (row.market === "spread") {
    const pickHome = model.puck_line.pick.startsWith(snapshot.home.abbreviation);
    const selectedLine = model.puck_line.puck_line_value;
    const settledMargin = (pickHome ? actualMargin : -actualMargin) + selectedLine;
    if (settledMargin === 0) return "push";
    return settledMargin > 0 ? "win" : "loss";
  }
  const line = snapshot.market.market_total_line;
  if (!Number.isFinite(line)) return null;
  const pickOver = model.total.pick.startsWith("OVER");
  if (actualTotal === Number(line)) return "push";
  return (pickOver ? actualTotal > Number(line) : actualTotal < Number(line)) ? "win" : "loss";
}

function marketFavoriteOutcome(row: Row): Outcome | null {
  if (row.market !== "moneyline") return null;
  const grade = one(row.prediction_grades);
  const probability = row.snapshot_json?.feature_inputs?.market?.market_home_prob;
  if (!grade || grade.actual_home_score === null || grade.actual_away_score === null || !Number.isFinite(probability)) return null;
  const actualHomeWon = grade.actual_home_score > grade.actual_away_score;
  return ((Number(probability) >= 0.5) === actualHomeWon) ? "win" : "loss";
}

function moneylineCohorts(rows: Row[]) {
  const scoped = rows.filter((row) => row.market === "moneyline");
  const agreement = scoped.filter((row) => {
    const probability = row.snapshot_json?.feature_inputs?.market?.market_home_prob;
    if (!Number.isFinite(probability)) return false;
    return (row.side === "home") === (Number(probability) >= 0.5);
  });
  const conflict = scoped.filter((row) => !agreement.includes(row));
  const strength = (row: Row) => {
    const probability = Number(row.snapshot_json?.feature_inputs?.market?.market_home_prob);
    return Math.max(probability, 1 - probability);
  };
  return {
    marketFavorite: summarize(scoped.map(marketFavoriteOutcome)),
    modelMarketAgreement: {
      games: agreement.length,
      model: summarize(agreement.map((row) => storedOutcome(one(row.prediction_grades)))),
      market: summarize(agreement.map(marketFavoriteOutcome)),
    },
    modelMarketConflict: {
      games: conflict.length,
      model: summarize(conflict.map((row) => storedOutcome(one(row.prediction_grades)))),
      market: summarize(conflict.map(marketFavoriteOutcome)),
    },
    marketFavoriteStrength: {
      below54: summarize(scoped.filter((row) => strength(row) < 0.54).map(marketFavoriteOutcome)),
      from54To60: summarize(scoped.filter((row) => strength(row) >= 0.54 && strength(row) < 0.60).map(marketFavoriteOutcome)),
      atLeast60: summarize(scoped.filter((row) => strength(row) >= 0.60).map(marketFavoriteOutcome)),
    },
  };
}

function scoreErrors(rows: Row[]) {
  const games = new Map<number, Row>();
  for (const row of rows) if (!games.has(row.game_id)) games.set(row.game_id, row);
  const values = [...games.values()].flatMap((row) => {
    const grade = one(row.prediction_grades);
    const model = row.snapshot_json?.model_output;
    if (!grade || grade.actual_home_score === null || grade.actual_away_score === null || !model) return [];
    const independentMargin = model.independent_goal_diff;
    const independentTotal = model.independent_total_goals;
    const finalMargin = model.expected_goal_diff;
    const finalTotal = model.expected_total_goals;
    if (![independentMargin, independentTotal, finalMargin, finalTotal].every(Number.isFinite)) return [];
    const actualMargin = grade.actual_home_score - grade.actual_away_score;
    const actualTotal = grade.actual_total ?? grade.actual_home_score + grade.actual_away_score;
    return [{
      independentMargin: Math.abs(Number(independentMargin) - actualMargin),
      independentTotal: Math.abs(Number(independentTotal) - actualTotal),
      finalMargin: Math.abs(Number(finalMargin) - actualMargin),
      finalTotal: Math.abs(Number(finalTotal) - actualTotal),
    }];
  });
  const mean = (key: keyof (typeof values)[number]) => values.length
    ? Number((values.reduce((sum, row) => sum + row[key], 0) / values.length).toFixed(5))
    : null;
  return {
    games: values.length,
    independentMarginMae: mean("independentMargin"),
    finalMarginMae: mean("finalMargin"),
    independentTotalMae: mean("independentTotal"),
    finalTotalMae: mean("finalTotal"),
  };
}

function report(label: string, rows: Row[]) {
  const byMarket = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => {
    const scoped = rows.filter((row) => row.market === market);
    return [market, {
      final: summarize(scoped.map((row) => storedOutcome(one(row.prediction_grades)))),
      independent: summarize(scoped.map(independentOutcome)),
    }];
  }));
  const alternates = Object.fromEntries((["spread", "total"] as const).map((market) => {
    const scoped = rows.filter((row) => row.market === market);
    return [market, {
      plus1: summarize(scoped.map((row) => {
        const grade = one(row.prediction_grades);
        return grade ? alternateLineOutcome(row as never, grade as never, 1) : null;
      })),
      plus2: summarize(scoped.map((row) => {
        const grade = one(row.prediction_grades);
        return grade ? alternateLineOutcome(row as never, grade as never, 2) : null;
      })),
    }];
  }));
  return {
    label,
    releases: [...new Set(rows.map((row) => row.model_version))],
    games: new Set(rows.map((row) => row.game_id)).size,
    rows: rows.length,
    coverage: rows.length ? {
      from: rows.map((row) => row.slate_date).sort()[0],
      to: rows.map((row) => row.slate_date).sort().at(-1),
    } : null,
    byMarket,
    alternates,
    scoreErrors: scoreErrors(rows),
    diagnostics: diagnostics(rows),
    featureCoverage: featureCoverage(rows),
    marketChanges: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
      market,
      changedSideSummary(rows.filter((row) => row.market === market)),
    ])),
    gradePerformance: gradePerformance(rows),
    moneylineCohorts: moneylineCohorts(rows),
  };
}

async function main() {
  const { data, error } = await supabase.from("prediction_records")
    .select("id,game_id,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,model_probability,play_grade,model_version,calibration_version,locked_at,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result,win,loss,push,actual_home_score,actual_away_score,actual_total)")
    .eq("sport", "nhl")
    .in("model_version", [...NHL_REGULAR_TRANSITION_MODEL_RELEASES])
    .not("locked_at", "is", null)
    .in("market", ["moneyline", "spread", "total"])
    .order("game_date", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const settled = rows.filter((row) => storedOutcome(one(row.prediction_grades)) !== null);
  const byRelease = [...new Set(settled.map((row) => row.model_version))].map((release) =>
    report(release, settled.filter((row) => row.model_version === release)),
  );
  const officialTransitionRecord = report("official transition record", settled);
  const activeReleaseRecord = report("active r17 only", settled.filter((row) => row.model_version === NHL_REGULAR_MODEL_RELEASE));
  if (process.argv.includes("--moneyline-only")) {
    console.log(JSON.stringify({
      officialTransitionRecord: {
        games: officialTransitionRecord.games,
        moneyline: officialTransitionRecord.byMarket.moneyline,
        cohorts: officialTransitionRecord.moneylineCohorts,
      },
      activeReleaseRecord: {
        games: activeReleaseRecord.games,
        moneyline: activeReleaseRecord.byMarket.moneyline,
        cohorts: activeReleaseRecord.moneylineCohorts,
      },
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    activeRelease: NHL_REGULAR_MODEL_RELEASE,
    officialTransitionRecord,
    activeReleaseRecord,
    byRelease,
    pendingLockedRows: rows.length - settled.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
