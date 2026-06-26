/**
 * Read-only report for legacy market-signal influence on recommendation
 * presentation. This does not change production flags or rows.
 */

import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";
import { readBoolFlag, readStringFlag, todayUTC } from "./_cliCommon";

type PredictionRecordRow = {
  id: number;
  game_id: number;
  sport: Sport;
  slate_date: string;
  market: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
};

type ImpactRow = {
  predictionRecordId: number;
  gameId: number;
  market: string;
  pick: string | null;
  finalPlayGrade: string | null;
  baselinePlayGrade: string | null;
  finalBestAngle: boolean | null;
  baselineBestAngleEligible: boolean | null;
  bestAngleDemoted: boolean;
  demoteReason: string | null;
  responsibleFields: Record<string, unknown>;
  providerSource: string;
  missingOrDefaulted: string[];
  lockedAt: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function readBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function marketPrefix(market: string): "ml" | "ou" | null {
  if (market === "moneyline") return "ml";
  if (market === "total") return "ou";
  return null;
}

function buildImpact(row: PredictionRecordRow): ImpactRow | null {
  const snap = row.snapshot_json ?? {};
  const prefix = marketPrefix(row.market);
  const v22 = asRecord(snap.v2_2_audit) ?? {};
  const publicSplits = asRecord(snap.public_splits);
  const lineMovement = asRecord(snap.line_movement);
  const ba = asRecord(snap.best_angle_resolution);
  const baselinePlayGrade = prefix ? readString(v22[`${prefix}_play_grade`]) : null;
  const baselineBestAngleEligible = ba ? readBool(ba.base_eligible) : null;
  const demoteReason = ba ? readString(ba.demote_reason) : null;
  const finalBestAngleFromAudit = ba ? readBool(ba.final_best_angle) : null;
  const bestAngleDemoted =
    baselineBestAngleEligible === true &&
    (row.best_angle === false || finalBestAngleFromAudit === false) &&
    demoteReason !== null;
  const gradeChanged = baselinePlayGrade !== null && row.play_grade !== null && baselinePlayGrade !== row.play_grade;
  if (!bestAngleDemoted && !gradeChanged) return null;

  const missingOrDefaulted: string[] = [];
  if (!publicSplits) missingOrDefaulted.push("public_splits_missing");
  if (!lineMovement) missingOrDefaulted.push("line_movement_missing");
  if (publicSplits?.picked_money_pct === null || publicSplits?.picked_bets_pct === null) {
    missingOrDefaulted.push("picked_public_split_null");
  }
  if (publicSplits?.opp_money_pct === null || publicSplits?.opp_bets_pct === null) {
    missingOrDefaulted.push("opposing_public_split_null");
  }
  if (lineMovement?.direction === "unknown") missingOrDefaulted.push("line_movement_unknown");

  return {
    predictionRecordId: row.id,
    gameId: row.game_id,
    market: row.market,
    pick: row.pick,
    finalPlayGrade: row.play_grade,
    baselinePlayGrade,
    finalBestAngle: row.best_angle,
    baselineBestAngleEligible,
    bestAngleDemoted,
    demoteReason,
    responsibleFields: {
      public_splits: publicSplits,
      line_movement: lineMovement,
      best_angle_resolution: ba,
    },
    providerSource: "legacy sharp_signals + line_history/lines snapshot_json",
    missingOrDefaulted,
    lockedAt: row.locked_at,
  };
}

function parseSport(raw: string | undefined): Sport {
  const sport = (raw ?? "mlb").toLowerCase();
  if (sport === "mlb" || sport === "wnba" || sport === "nba" || sport === "nhl" || sport === "nfl" || sport === "cfb" || sport === "cbb" || sport === "soccer" || sport === "ucl") {
    return sport as Sport;
  }
  throw new Error(`Invalid --sport ${raw}.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) throw new Error("This report is read-only; --write is not supported.");
  const sport = parseSport(readStringFlag(argv, "--sport"));
  const slateDate = readStringFlag(argv, "--date") ?? todayUTC();
  const json = readBoolFlag(argv, "--json");

  const { data, error } = await supabase
    .from("prediction_records")
    .select("id, game_id, sport, slate_date, market, pick, side, line_value, odds_american, confidence, play_grade, best_angle, locked_at, snapshot_json")
    .eq("sport", sport)
    .eq("slate_date", slateDate)
    .in("market", ["moneyline", "total"]);
  if (error) throw new Error(`prediction_records fetch failed: ${error.message}`);

  const rows = ((data ?? []) as PredictionRecordRow[]).map(buildImpact).filter((x): x is ImpactRow => x !== null);
  const report = {
    sport,
    slateDate,
    rowsScanned: (data ?? []).length,
    impactedRows: rows.length,
    bestAngleDemotions: rows.filter((r) => r.bestAngleDemoted).length,
    gradeChanges: rows.filter((r) => r.baselinePlayGrade !== null && r.baselinePlayGrade !== r.finalPlayGrade).length,
    rows,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`[legacy-market-grade-impact-report] sport=${sport} date=${slateDate}`);
  console.log(`rowsScanned=${report.rowsScanned} impactedRows=${report.impactedRows} bestAngleDemotions=${report.bestAngleDemotions} gradeChanges=${report.gradeChanges}`);
  for (const r of rows) {
    console.log(
      `- pr=${r.predictionRecordId} game=${r.gameId} ${r.market} pick=${r.pick ?? "-"} grade=${r.baselinePlayGrade ?? "?"}->${r.finalPlayGrade ?? "?"} BA=${r.baselineBestAngleEligible ?? "?"}->${r.finalBestAngle ?? "?"} reason=${r.demoteReason ?? "-"}`,
    );
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
