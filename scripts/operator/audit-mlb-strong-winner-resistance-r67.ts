/**
 * Read-only audit for the MLB r67 strong-winner resistance Lean.
 *
 * Rebuilds today's proposed records without applying them, compares them with
 * the stored board, and replays the candidate against locked rows produced by
 * the active Moneyline probability head. It never writes to production.
 */
import { createClient } from "@supabase/supabase-js";

import {
  ML_STRONG_WINNER_RESISTANCE_LEAN_RULE_ID,
  createPredictionRecords,
} from "../../lib/services/predictionRecordService";

type Json = Record<string, unknown>;

const ACTIVE_ML_HEAD =
  "mlb_moneyline_away_market_40_45_raw_side_champion_v1_2026_08_15";

function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {};
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function implied(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

function actionable(row: Json): boolean {
  return row.best_angle === true || row.play_grade === "lean" || row.play_grade === "best_angle";
}

function grade(row: Json): string {
  if (row.best_angle === true) return "best_angle";
  if (row.play_grade === "lean") return "lean";
  return "no_play";
}

function profit(won: boolean, odds: number): number {
  return won ? (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) : -1;
}

function summarize(rows: Array<{ won: boolean; units: number }>) {
  const wins = rows.filter((row) => row.won).length;
  const units = rows.reduce((sum, row) => sum + row.units, 0);
  return {
    settled: rows.length,
    record: `${wins}-${rows.length - wins}`,
    units: Number(units.toFixed(3)),
    roiPct: rows.length ? Number((units / rows.length * 100).toFixed(2)) : null,
  };
}

function selectedSharpGap(snapshot: Json, side: unknown): number | null {
  const rows = Array.isArray(snapshot.source_aware_split_rows_at_lock)
    ? snapshot.source_aware_split_rows_at_lock as Json[]
    : [];
  const selected = rows.find((row) =>
    row.market_type === "moneyline" &&
    row.provider === "sharpapi" &&
    String(row.selection_key ?? "").split(":").at(-1) === side
  );
  const bets = number(selected?.bets_pct);
  const money = number(selected?.money_pct);
  if (bets === null || money === null) return null;
  const normalizedBets = bets <= 1 ? bets * 100 : bets;
  const normalizedMoney = money <= 1 ? money * 100 : money;
  return normalizedMoney - normalizedBets;
}

function projectionGap(snapshot: Json, side: unknown): number | null {
  const scores = object(snapshot.predicted_scores_at_lock);
  const home = number(scores.home);
  const away = number(scores.away);
  if (home === null || away === null) return null;
  if (side === "home") return home - away;
  if (side === "away") return away - home;
  return null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7)
    ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const dry = await createPredictionRecords({
    sport: "mlb",
    slateDate: date,
    launchDay: false,
    apply: false,
    supabase,
  });
  if (dry.errors.length) throw new Error(JSON.stringify(dry.errors));
  const currentResult = await supabase
    .from("prediction_records")
    .select("game_id,matchup,market,pick,odds_american,model_probability,play_grade,best_angle,no_bet,locked_at,snapshot_json")
    .eq("sport", "mlb")
    .eq("slate_date", date);
  if (currentResult.error) throw currentResult.error;
  const current = (currentResult.data ?? []) as Json[];
  const currentByKey = new Map(current.map((row) => [`${row.game_id}|${row.market}`, row]));
  const candidate = dry.proposed as unknown as Json[];
  const changes = candidate.flatMap((row) => {
    const before = currentByKey.get(`${row.game_id}|${row.market}`);
    if (!before || grade(before) === grade(row)) return [];
    return [{
      matchup: row.matchup,
      market: row.market,
      pick: row.pick,
      probability: row.model_probability,
      odds: row.odds_american,
      before: grade(before),
      after: grade(row),
      actionRuleId: object(object(row.snapshot_json).decision_pipeline).action_rule_id ?? null,
      movement: object(object(row.snapshot_json).line_movement).direction ?? null,
      sharpMoneyMinusTickets: selectedSharpGap(object(row.snapshot_json), row.side),
    }];
  });

  const lockedResult = await supabase
    .from("prediction_records")
    .select("id,game_id,slate_date,matchup,side,odds_american,model_probability,locked_at,snapshot_json")
    .eq("sport", "mlb")
    .eq("market", "moneyline")
    .not("locked_at", "is", null)
    .gte("slate_date", "2026-08-15")
    .lte("slate_date", "2026-08-21")
    .order("locked_at", { ascending: true });
  if (lockedResult.error) throw lockedResult.error;
  const locked = ((lockedResult.data ?? []) as Json[]).filter((row) =>
    object(object(row.snapshot_json).model_layer_versions).active_probability_head === ACTIVE_ML_HEAD
  );
  const gameIds = [...new Set(locked.map((row) => Number(row.game_id)))];
  const gamesResult = await supabase
    .from("games")
    .select("id,home_score,away_score")
    .in("id", gameIds);
  if (gamesResult.error) throw gamesResult.error;
  const games = new Map(((gamesResult.data ?? []) as Json[]).map((row) => [Number(row.id), row]));
  const seen = new Set<string>();
  const resistance: Array<{
    date: string;
    won: boolean;
    units: number;
    probability: number;
    odds: number;
    priceEdgePp: number;
    projectionGap: number | null;
    movement: unknown;
    publicConflict: boolean;
    candidate: boolean;
  }> = [];
  for (const row of locked) {
    const keyForRow = `${row.game_id}|${row.locked_at}`;
    if (seen.has(keyForRow)) continue;
    seen.add(keyForRow);
    const snapshot = object(row.snapshot_json);
    const sharpGap = selectedSharpGap(snapshot, row.side);
    if (sharpGap === null || sharpGap > -10) continue;
    const game = games.get(Number(row.game_id));
    const homeScore = number(game?.home_score);
    const awayScore = number(game?.away_score);
    const odds = number(row.odds_american);
    const probability = number(row.model_probability);
    if (homeScore === null || awayScore === null || homeScore === awayScore || odds === null || probability === null) continue;
    const won = row.side === "home" ? homeScore > awayScore : awayScore > homeScore;
    const breakEven = implied(odds);
    const movement = object(snapshot.line_movement).direction;
    if (breakEven === null) continue;
    const priceEdgePp = (probability - breakEven) * 100;
    const sameSideProjectionGap = projectionGap(snapshot, row.side);
    const publicConflict = object(snapshot.public_splits).conflict === true;
    const candidateEligible =
      probability >= 0.60 &&
      odds >= -300 && odds <= 200 &&
      (sameSideProjectionGap ?? -1) >= 0 &&
      movement !== "against_pick" &&
      !publicConflict;
    resistance.push({
      date: String(row.slate_date),
      won,
      units: profit(won, odds),
      probability,
      odds,
      priceEdgePp,
      projectionGap: sameSideProjectionGap,
      movement,
      publicConflict,
      candidate: candidateEligible,
    });
  }
  const historicalCandidate = resistance.filter((row) => row.candidate);

  const currentActions = current.filter(actionable).length;
  const candidateActions = candidate.filter(actionable).length;
  const moneylineChanges = changes.filter((row) => row.market === "moneyline");
  console.log(JSON.stringify({
    audit: "mlb_strong_winner_resistance_lean_r67",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    date,
    ruleId: ML_STRONG_WINNER_RESISTANCE_LEAN_RULE_ID,
    sameInputBoard: {
      currentRecords: current.length,
      candidateRecords: candidate.length,
      currentActions,
      candidateActions,
      taskOwnedMoneylinePromotions: moneylineChanges.filter((row) =>
        row.before === "no_play" && row.after !== "no_play"
      ).length,
      taskOwnedMoneylineDemotions: moneylineChanges.filter((row) =>
        row.before !== "no_play" && row.after === "no_play"
      ).length,
      taskOwnedMoneylineChanges: moneylineChanges,
      allObservedChangesIncludingIndependentInputRefresh: changes,
    },
    exactProbabilityHeadReplay: {
      probabilityHead: ACTIVE_ML_HEAD,
      uniqueLockedRows: seen.size,
      signedResistance: summarize(resistance),
      strongWinnerNonAdverse: summarize(resistance.filter((row) =>
        row.probability >= 0.60 && row.movement !== "against_pick"
      )),
      strongWinnerNonAdverseCoherent: summarize(resistance.filter((row) =>
        row.probability >= 0.60 && row.movement !== "against_pick" &&
        (row.projectionGap ?? -1) >= 0 && !row.publicConflict
      )),
      strongWinnerNonAdverseCoherentPriceBand: summarize(resistance.filter((row) =>
        row.probability >= 0.60 && row.movement !== "against_pick" &&
        (row.projectionGap ?? -1) >= 0 && !row.publicConflict &&
        row.odds >= -300 && row.odds <= 200
      )),
      strongWinnerNonAdversePriced: summarize(resistance.filter((row) =>
        row.probability >= 0.60 && row.movement !== "against_pick" &&
        row.odds >= -300 && row.odds <= 200 && row.priceEdgePp >= -3
      )),
      candidate: summarize(historicalCandidate),
      selectionThroughAug18: summarize(historicalCandidate.filter((row) => row.date <= "2026-08-18")),
      forwardAug19Plus: summarize(historicalCandidate.filter((row) => row.date >= "2026-08-19")),
      candidateRows: historicalCandidate,
    },
    productionContract: {
      probabilityChanged: false,
      pickChanged: false,
      bestAngleAuthorized: false,
      maximumGrade: "lean",
      lockedRowsMutable: false,
      databaseWrites: 0,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
