/**
 * SELECT-only evidence gate for the authoritative WNBA structural candidate.
 * It never calls a provider, cron, writer, lock, or publication path.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-wnba-target-excluded-market-decision.ts
 */
import { supabase } from "../../lib/db/supabase";
import {
  EXPECTED_WNBA_DISTRIBUTION_VERSION,
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
  EXPECTED_WNBA_MODEL_VERSION,
} from "../../lib/automodel/wnbaChampionRuntime";
import {
  readWnbaForwardEvidenceCapture,
  WNBA_FORWARD_EVIDENCE_CAPTURE_KEY,
} from "../../lib/services/wnba/wnbaForwardEvidenceCapture";

type Row = Record<string, unknown>;
type Market = "moneyline" | "spread" | "total";

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function market(value: unknown): Market | null {
  return value === "moneyline" || value === "spread" || value === "total" ? value : null;
}

function gradeCounts(rows: readonly Row[]): Record<string, number> {
  const counts = { best_angle: 0, lean: 0, watchlist: 0, caution: 0, no_play: 0, missing: 0 };
  for (const row of rows) {
    const grade = text(row.play_grade);
    if (grade === "best_angle" || grade === "lean" || grade === "watchlist" || grade === "caution") {
      counts[grade] += 1;
    } else if (grade === "no_play") counts.no_play += 1;
    else counts.missing += 1;
  }
  return counts;
}

function emptyMarketSummary() {
  return {
    records: 0,
    unique_games: 0,
    captures: 0,
    complete_current_pairs: 0,
    target_excluded_alternatives: 0,
    exact_evaluated_quotes: 0,
    singleton_complete_pair_games: 0,
    locked_settled: 0,
    brier: null as number | null,
    log_loss: null as number | null,
    projection_mae: null as number | null,
  };
}

async function main(): Promise<void> {
  const queriedAt = new Date().toISOString();
  const slateDate = queriedAt.slice(0, 10);
  const [{ data: currentData, error: currentError }, { data: captureData, error: captureError }] = await Promise.all([
    supabase
      .from("prediction_records")
      .select("id,game_id,slate_date,market,play_grade,locked_at,model_version,snapshot_json")
      .eq("sport", "wnba")
      .eq("slate_date", slateDate)
      .in("market", ["moneyline", "spread", "total"])
      .limit(500),
    supabase
      .from("prediction_records")
      .select("id,game_id,slate_date,market,side,line_value,odds_american,play_grade,locked_at,model_version,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score,actual_total,graded_at)")
      .eq("sport", "wnba")
      .not(`snapshot_json->${WNBA_FORWARD_EVIDENCE_CAPTURE_KEY}`, "is", null)
      .in("market", ["moneyline", "spread", "total"])
      .order("slate_date", { ascending: true })
      .limit(2000),
  ]);
  if (currentError) throw new Error(`current prediction_records SELECT: ${currentError.message}`);
  if (captureError) throw new Error(`capture prediction_records SELECT: ${captureError.message}`);

  const current = (currentData ?? []) as Row[];
  const captureRows = (captureData ?? []) as Row[];
  const entries = captureRows.flatMap((row) => {
    const capture = readWnbaForwardEvidenceCapture(object(row.snapshot_json)[WNBA_FORWARD_EVIDENCE_CAPTURE_KEY]);
    return capture ? [{ row, capture }] : [];
  });
  const releaseSets = new Map<string, number>();
  for (const entry of entries) {
    const key = [
      entry.capture.releases.model_version,
      entry.capture.releases.distribution_version,
      entry.capture.releases.grade_policy_version,
      entry.capture.releases.decision_tuple_contract_version,
      entry.capture.releases.prediction_record_contract_version,
    ].join("|");
    releaseSets.set(key, (releaseSets.get(key) ?? 0) + 1);
  }

  const markets: Record<Market, ReturnType<typeof emptyMarketSummary>> = {
    moneyline: emptyMarketSummary(),
    spread: emptyMarketSummary(),
    total: emptyMarketSummary(),
  };
  for (const rowMarket of ["moneyline", "spread", "total"] as const) {
    const selected = entries.filter((entry) => market(entry.row.market) === rowMarket);
    const games = new Set(selected.map((entry) => number(entry.row.game_id)).filter((value): value is number => value !== null));
    const summary = markets[rowMarket];
    summary.records = captureRows.filter((row) => market(row.market) === rowMarket).length;
    summary.unique_games = games.size;
    summary.captures = selected.length;
    for (const entry of selected) {
      const capturedMarket = entry.capture.markets[rowMarket];
      summary.complete_current_pairs += capturedMarket.current_book_pairs.length;
      summary.target_excluded_alternatives += capturedMarket.evaluation.target_excluded_complete_pair_count;
      if (capturedMarket.evaluation.tuple !== null) summary.exact_evaluated_quotes += 1;
      if (capturedMarket.current_book_pairs.length === 1) summary.singleton_complete_pair_games += 1;
      const settlement = Array.isArray(entry.row.prediction_grades)
        ? object(entry.row.prediction_grades[0])
        : object(entry.row.prediction_grades);
      if (entry.row.locked_at !== null && ["win", "loss", "push"].includes(text(settlement.result) ?? "")) {
        summary.locked_settled += 1;
      }
    }
    // Existing captures are insufficient to replay the new target-excluded ML
    // cold-start path without contamination. Proper scores deliberately stay
    // null rather than blending releases or fabricating candidate predictions.
  }

  const currentByMarket = Object.fromEntries(
    (["moneyline", "spread", "total"] as const).map((rowMarket) => {
      const rows = current.filter((row) => market(row.market) === rowMarket);
      return [rowMarket, {
        records: rows.length,
        unique_games: new Set(rows.map((row) => number(row.game_id))).size,
        grades: gradeCounts(rows),
      }];
    }),
  );

  console.log(JSON.stringify({
    mode: "select_only",
    provider_calls: 0,
    cron_calls: 0,
    writes: 0,
    queried_at: queriedAt,
    slate_date: slateDate,
    candidate_release: {
      model_version: EXPECTED_WNBA_MODEL_VERSION,
      distribution_version: EXPECTED_WNBA_DISTRIBUTION_VERSION,
      grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
    },
    current_natural_board: currentByMarket,
    current_board_transitions: {
      promotions: 0,
      demotions: 0,
      side_changes: 0,
      projection_changes: 0,
      probability_changes: 0,
      reason: current.length === 0
        ? "zero naturally scheduled WNBA prediction records; no slate invented"
        : "candidate was not written or published; structural comparison requires an exact captured replay",
    },
    forward_capture_inventory: {
      database_rows: captureRows.length,
      valid_release_stamped_captures: entries.length,
      release_sets: [...releaseSets.entries()].map(([release, count]) => ({ release, count })),
      markets,
    },
    replay_gate: {
      candidate_proper_scores_available: false,
      reason: entries.length === 0
        ? "no authentic forward captures exist"
        : "pre-candidate captures do not contain a target-excluded cold-start-independent ML feature bundle",
      opened_diagnostics_only: true,
      production_qualification_claimed: false,
    },
  }, null, 2));
}

void main();
