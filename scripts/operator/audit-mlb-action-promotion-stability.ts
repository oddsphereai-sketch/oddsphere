/**
 * SELECT-only MLB Moneyline audit for the action-promotion stability release.
 * No provider, writer, cron, or mutation is invoked.
 */

import { supabase } from "../../lib/db/supabase";
import { expectedValueAtAmericanOdds } from "../../lib/services/dailyEdge/actionPromotionStability";

type Row = {
  id: number;
  game_id: number;
  slate_date: string;
  matchup: string;
  pick: string | null;
  side: string | null;
  odds_american: number | null;
  model_probability: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  locked_at: string | null;
  published_at: string | null;
  snapshot_json: unknown;
  prediction_grades?: unknown;
};

type Grade = "best_angle" | "lean" | "watchlist" | "no_play";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function grade(row: Pick<Row, "play_grade" | "best_angle" | "no_bet">): Grade {
  if (row.no_bet === true) return "no_play";
  if (row.best_angle === true || row.play_grade === "best_angle") return "best_angle";
  if (row.play_grade === "lean") return "lean";
  if (row.play_grade === "market_aligned" || row.play_grade === "watchlist") return "watchlist";
  return "no_play";
}

function result(row: Row): "win" | "loss" | "push" | null {
  const value = Array.isArray(row.prediction_grades)
    ? object(row.prediction_grades[0])
    : object(row.prediction_grades);
  const normalized = String(value.result ?? "").toLowerCase();
  return normalized === "win" || normalized === "loss" || normalized === "push" ? normalized : null;
}

function release(row: Row): string {
  return String(object(object(row.snapshot_json).decision_pipeline).release_id ?? "unknown");
}

function unit(price: number, outcome: "win" | "loss"): number {
  if (outcome === "loss") return -1;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function summarize(rows: Row[]) {
  const settled = rows.filter((row) => {
    const outcome = result(row);
    return (outcome === "win" || outcome === "loss") && row.odds_american !== null;
  });
  const returns = settled.map((row) => unit(row.odds_american!, result(row) as "win" | "loss"));
  const wins = settled.filter((row) => result(row) === "win").length;
  const units = returns.reduce((sum, value) => sum + value, 0);
  const largestWin = Math.max(0, ...returns);
  const brierRows = settled.filter((row) => row.model_probability !== null);
  const brier = brierRows.length === 0 ? null : brierRows.reduce((sum, row) => {
    const outcome = result(row) === "win" ? 1 : 0;
    return sum + (row.model_probability! - outcome) ** 2;
  }, 0) / brierRows.length;
  const expected = brierRows.length === 0 ? null : brierRows.reduce((sum, row) => sum + row.model_probability!, 0) / brierRows.length;
  const observed = settled.length === 0 ? null : wins / settled.length;
  const clv = rows.map((row) => {
    const closing = object(object(row.snapshot_json).closing_line_value);
    return typeof closing.beat_closing_line === "boolean" ? closing.beat_closing_line : null;
  }).filter((value): value is boolean => value !== null);
  return {
    n: rows.length,
    settled: settled.length,
    record: `${wins}-${settled.length - wins}`,
    units: Number(units.toFixed(3)),
    roiPct: settled.length === 0 ? null : Number((100 * units / settled.length).toFixed(2)),
    unitsWithoutLargestWin: Number((units - largestWin).toFixed(3)),
    brier: brier === null ? null : Number(brier.toFixed(5)),
    calibrationGapPp: expected === null || observed === null ? null : Number((100 * (observed - expected)).toFixed(2)),
    clvN: clv.length,
    clvBeatPct: clv.length === 0 ? null : Number((100 * clv.filter(Boolean).length / clv.length).toFixed(2)),
  };
}

function dateWindow(date: string): "development" | "validation" | "holdout" | "current" {
  if (date <= "2026-07-31") return "development";
  if (date <= "2026-08-19") return "validation";
  if (date <= "2026-08-28") return "holdout";
  return "current";
}

function gradeHistory(row: Row): Grade[] {
  const snapshot = object(row.snapshot_json);
  const history = Array.isArray(snapshot.prediction_grade_history_v1)
    ? snapshot.prediction_grade_history_v1.map(object)
    : [];
  return [...history.map((entry) => grade({
    play_grade: typeof entry.play_grade === "string" ? entry.play_grade : null,
    best_angle: entry.best_angle === true,
    no_bet: entry.no_bet === true,
  })), grade(row)];
}

function actionCliffDurations(row: Row): number[] {
  const snapshot = object(row.snapshot_json);
  const rawHistory = Array.isArray(snapshot.prediction_grade_history_v1)
    ? snapshot.prediction_grade_history_v1.map(object)
    : [];
  const timed = rawHistory.map((entry) => ({
    at: typeof entry.replaced_at === "string" ? Date.parse(entry.replaced_at) : NaN,
    grade: grade({
      play_grade: typeof entry.play_grade === "string" ? entry.play_grade : null,
      best_angle: entry.best_angle === true,
      no_bet: entry.no_bet === true,
    }),
  })).filter((entry) => Number.isFinite(entry.at));
  const finalAt = Date.parse(row.locked_at ?? row.published_at ?? "");
  if (Number.isFinite(finalAt)) timed.push({ at: finalAt, grade: grade(row) });
  const durations: number[] = [];
  let actionStartedAt: number | null = null;
  let prior: Grade | null = null;
  for (const state of timed.sort((left, right) => left.at - right.at)) {
    const actionable = state.grade === "best_angle" || state.grade === "lean";
    const priorNonaction = prior === "no_play" || prior === "watchlist";
    if (actionable && priorNonaction && actionStartedAt === null) actionStartedAt = state.at;
    if (!actionable && actionStartedAt !== null) {
      durations.push((state.at - actionStartedAt) / 60_000);
      actionStartedAt = null;
    }
    prior = state.grade;
  }
  return durations.filter((value) => value >= 0);
}

function hasActionCliff(row: Row): boolean {
  const history = gradeHistory(row);
  for (let index = 2; index < history.length; index += 1) {
    const before = history[index - 2];
    const action = history[index - 1];
    const after = history[index];
    if ((before === "no_play" || before === "watchlist") &&
        (action === "lean" || action === "best_angle") &&
        (after === "no_play" || after === "watchlist")) return true;
  }
  return false;
}

function distinctLatest(rows: Row[]): Row[] {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.game_id}::${release(row)}`;
    if (!latest.has(key) || row.id > latest.get(key)!.id) latest.set(key, row);
  }
  return [...latest.values()];
}

async function main() {
  const query = await supabase
    .from("prediction_records")
    .select("id,game_id,slate_date,matchup,pick,side,odds_american,model_probability,play_grade,best_angle,no_bet,locked_at,published_at,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result)")
    .eq("sport", "mlb")
    .eq("market", "moneyline")
    .gte("slate_date", "2026-06-01")
    .lte("slate_date", "2026-08-29")
    .order("id", { ascending: true })
    .limit(2000);
  if (query.error) throw new Error(query.error.message);
  const all = distinctLatest((query.data ?? []) as Row[]);
  const locked = all.filter((row) => row.locked_at !== null);
  const current = all.filter((row) => row.slate_date === "2026-08-29" && row.locked_at === null);
  const incumbentActions = locked.filter((row) => grade(row) === "best_angle" || grade(row) === "lean");
  const positiveEconomicsActions = incumbentActions.filter((row) =>
    (expectedValueAtAmericanOdds(row.model_probability, row.odds_american) ?? -Infinity) >= 0
  );
  const negativeEconomicsActions = incumbentActions.filter((row) => !positiveEconomicsActions.includes(row));
  const byWindow = Object.fromEntries(["development", "validation", "holdout", "current"].map((window) => [
    window,
    {
      incumbent: summarize(incumbentActions.filter((row) => dateWindow(row.slate_date) === window)),
      positiveEconomics: summarize(positiveEconomicsActions.filter((row) => dateWindow(row.slate_date) === window)),
      removedNegativeEconomics: summarize(negativeEconomicsActions.filter((row) => dateWindow(row.slate_date) === window)),
    },
  ]));
  const byRelease = Object.fromEntries([...new Set(locked.map(release))].sort().map((id) => [
    id,
    {
      incumbent: summarize(incumbentActions.filter((row) => release(row) === id)),
      positiveEconomics: summarize(positiveEconomicsActions.filter((row) => release(row) === id)),
    },
  ]));
  const currentCounts = (rows: Row[]) => Object.fromEntries(["best_angle", "lean", "watchlist", "no_play"].map((label) => [
    label,
    rows.filter((row) => grade(row) === label).length,
  ]));
  const currentEconomicsCandidate = current.map((row) => {
    const ev = expectedValueAtAmericanOdds(row.model_probability, row.odds_american);
    const currentGrade = grade(row);
    return {
      matchup: row.matchup,
      grade: currentGrade,
      probability: row.model_probability,
      price: row.odds_american,
      expectedValuePct: ev === null ? null : Number((100 * ev).toFixed(2)),
      economicsImmediateGrade:
        (currentGrade === "best_angle" || currentGrade === "lean") && (ev ?? -Infinity) < 0
          ? "no_play"
          : currentGrade,
      history: gradeHistory(row),
    };
  });
  const replayCounts = Object.fromEntries(["best_angle", "lean", "watchlist", "no_play"].map((label) => [
    label,
    currentEconomicsCandidate.filter((row) => row.economicsImmediateGrade === label).length,
  ]));
  const durationRows = all.flatMap((row) => actionCliffDurations(row).map((minutes) => ({
    date: row.slate_date,
    window: dateWindow(row.slate_date),
    minutes,
  })));
  const durationSummary = (rows: typeof durationRows) => ({
    n: rows.length,
    under10: rows.filter((row) => row.minutes < 10).length,
    under20: rows.filter((row) => row.minutes < 20).length,
    under30: rows.filter((row) => row.minutes < 30).length,
    medianMinutes: rows.length === 0 ? null : Number([...rows].sort((a, b) => a.minutes - b.minutes)[Math.floor(rows.length / 2)].minutes.toFixed(2)),
  });

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    uniqueGameReleaseObservations: all.length,
    uniqueLockedGameReleaseObservations: locked.length,
    incumbentActions: summarize(incumbentActions),
    positiveEconomicsActions: summarize(positiveEconomicsActions),
    removedNegativeEconomicsActions: summarize(negativeEconomicsActions),
    byWindow,
    byRelease,
    transitionEvidence: {
      rowsWithHistory: all.filter((row) => gradeHistory(row).length > 1).length,
      directNonactionActionNonactionCliffs: all.filter(hasActionCliff).length,
      durationGrid: {
        all: durationSummary(durationRows),
        developmentValidation: durationSummary(durationRows.filter((row) => row.date <= "2026-08-19")),
        holdout: durationSummary(durationRows.filter((row) => row.date >= "2026-08-20" && row.date <= "2026-08-28")),
        currentReplay: durationSummary(durationRows.filter((row) => row.date === "2026-08-29")),
      },
      cliffRows: all.filter(hasActionCliff).map((row) => ({ matchup: row.matchup, date: row.slate_date, history: gradeHistory(row) })),
      limitation: "Grade history stores changed public states, not every qualifying natural writer cycle; persistence performance cannot be reconstructed retrospectively and must be monitored prospectively by release.",
    },
    currentBoard: {
      rows: current.length,
      incumbentCounts: currentCounts(current),
      economicsOnlyCounts: replayCounts,
      rowsDetail: currentEconomicsCandidate,
      persistenceFirstReleaseImpact: "Existing actionables are retained when exact economics remain positive. Only new upward transitions enter pending confirmation; exact count depends on the next natural cycle and is not fabricated from a reader replay.",
    },
    loadImpact: {
      providerCalls: 0,
      additionalDatabaseQueries: 0,
      additionalWriterInvocations: 0,
      storage: "one bounded state object inside the existing atomic prediction_records snapshot",
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
