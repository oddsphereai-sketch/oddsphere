/**
 * Read-only incident audit for the current Tampa Bay MLB Daily Edge records.
 *
 * It reconstructs every same-day writer transition from admin_audit_log and
 * prints the current coherent decision tuple. It never calls a writer or
 * mutates production state.
 */

import { createClient } from "@supabase/supabase-js";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function currentTuple(row: JsonRecord) {
  const snapshot = record(row.snapshot_json);
  const pipeline = record(snapshot.decision_pipeline);
  const price = record(snapshot.ml_evaluation_price);
  const splits = record(snapshot.public_splits);
  return {
    id: row.id,
    gameId: row.game_id,
    matchup: row.matchup,
    market: row.market,
    pick: row.pick,
    side: row.side,
    oddsAmerican: row.odds_american,
    modelProbability: row.model_probability,
    marketProbability: row.market_probability,
    edge: row.edge,
    expectedValue: row.expected_value,
    playGrade: row.play_grade,
    bestAngle: row.best_angle,
    noBet: row.no_bet,
    noBetReason: row.no_bet_reason,
    lockedAt: row.locked_at,
    publishedAt: row.published_at,
    releaseId: pipeline.release_id,
    ruleBundle: pipeline.rule_bundle_version,
    actionRuleId: pipeline.action_rule_id,
    gradeSource: pipeline.grade_source,
    boardAction: pipeline.board_action,
    evaluatedBook: price.evaluated_book,
    evaluatedPrice: price.evaluated_odds,
    evaluatedObservedAt: price.evaluated_observed_at,
    baselineBook: price.baseline_book,
    baselinePrice: price.baseline_price,
    priceOnlyPromotionAuthorized: price.price_only_promotion_authorized,
    splitConflict: splits.conflict,
    splitMoneyPct: splits.money_pct,
    splitTicketsPct: splits.tickets_pct,
    lineMovement: snapshot.line_movement,
    completePriceBoard: snapshot.complete_price_board,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const date = process.argv.find((value) => value.startsWith("--date="))?.slice(7)
    ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const candidate = await createPredictionRecords({
    sport: "mlb",
    slateDate: date,
    launchDay: false,
    apply: false,
    supabase,
  });
  const recordsResult = await supabase
    .from("prediction_records")
    .select("id,game_id,matchup,market,pick,side,odds_american,model_probability,market_probability,edge,expected_value,play_grade,best_angle,no_bet,no_bet_reason,locked_at,published_at,calibration_version,snapshot_json")
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .ilike("matchup", "%TB%BAL%")
    .order("market");
  if (recordsResult.error) throw new Error(recordsResult.error.message);
  const rows = (recordsResult.data ?? []) as JsonRecord[];
  if (rows.length === 0) throw new Error(`No TB@BAL records found for ${date}.`);

  const transitions: JsonRecord[] = [];
  for (const row of rows) {
    const auditResult = await supabase
      .from("admin_audit_log")
      .select("id,created_at,target_id,before_state,after_state,source_type")
      .eq("action_type", "prediction_record.pregame_version")
      .eq("target_id", String(row.id))
      .gte("created_at", `${date}T00:00:00.000Z`)
      .order("created_at", { ascending: true });
    if (auditResult.error) throw new Error(auditResult.error.message);
    for (const audit of auditResult.data ?? []) {
      transitions.push({
        recordId: row.id,
        market: row.market,
        ...audit,
      });
    }
  }

  const gameIds = [...new Set(rows.map((row) => Number(row.game_id)))];
  const historyResult = await supabase
    .from("line_history")
    .select("game_id,market_type,side,sportsbook,line_value,odds_american,is_opener,recorded_at")
    .in("game_id", gameIds)
    .eq("market_type", "moneyline")
    .order("recorded_at", { ascending: true })
    .limit(5000);
  if (historyResult.error) throw new Error(historyResult.error.message);
  const linesResult = await supabase
    .from("lines")
    .select("game_id,market_type,side,sportsbook,line_value,odds_american,fetched_at")
    .in("game_id", gameIds)
    .eq("market_type", "moneyline")
    .order("fetched_at", { ascending: true })
    .limit(5000);
  if (linesResult.error) throw new Error(linesResult.error.message);

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    date,
    readOnly: true,
    candidate: candidate.proposed
      .filter((row) => row.matchup === "TB@BAL" || row.matchup === "DET@KC")
      .map((row) => ({
        matchup: row.matchup,
        market: row.market,
        pick: row.pick,
        oddsAmerican: row.odds_american,
        confidence: row.confidence,
        playGrade: row.play_grade,
        bestAngle: row.best_angle,
        noBet: row.no_bet,
        noBetReason: row.no_bet_reason,
        lineMovement: record(row.snapshot_json).line_movement,
        evaluationPrice: record(row.snapshot_json).ml_evaluation_price,
        decisionPipeline: record(row.snapshot_json).decision_pipeline,
      })),
    current: rows.map(currentTuple),
    transitions,
    moneylineHistory: historyResult.data ?? [],
    currentMoneylineRows: linesResult.data ?? [],
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
