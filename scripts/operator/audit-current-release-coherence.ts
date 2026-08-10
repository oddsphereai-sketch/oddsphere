/**
 * Read-only current-slate release audit for the member-facing redesign.
 *
 * This proves the stored writer outputs match the code's champion registries.
 * Locked rows are historical truth; exact-release checks apply to unlocked
 * current-slate rows that the redesigned reader is allowed to display.
 */
import {
  MLB_DAILY_EDGE_DECISION_RELEASE_ID,
  MLB_DAILY_EDGE_RULE_BUNDLE_VERSION,
  MLB_MODEL_LAYER_VERSION_IDS,
  MLB_PUBLIC_CALIBRATION_VERSION,
} from "../../lib/automodel/mlbModelLayerVersions";
import {
  EXPECTED_WNBA_DISTRIBUTION_VERSION,
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
  EXPECTED_WNBA_MODEL_VERSION,
  wnbaPredictionReleaseMismatches,
} from "../../lib/automodel/wnbaChampionRuntime";
import { currentSlateDate } from "../../lib/dates/slateDate";
import { supabase } from "../../lib/db/supabase";
import { WNBA_PREDICTION_RECORD_CONTRACT_VERSION } from "../../lib/services/wnba/buildWnbaPredictionRecords";

type Json = Record<string, unknown>;
type GameRow = { id: number; sport: "mlb" | "wnba"; locked_at?: string | null };
type RecordRow = {
  game_id: number;
  sport: "mlb" | "wnba";
  market: string;
  model_version: string | null;
  locked_at: string | null;
  snapshot_json: Json | null;
};

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requireDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Dates must use YYYY-MM-DD.");
  return value;
}

async function rowsForSport(sport: "mlb" | "wnba", date: string): Promise<{
  games: GameRow[];
  records: RecordRow[];
  predictions: Array<{ game_id: number; locked_at: string | null; sport_specific: Json | null }>;
}> {
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, sport")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (gamesError) throw new Error(`${sport} games: ${gamesError.message}`);
  const gameRows = (games ?? []) as GameRow[];
  const ids = gameRows.map((game) => game.id);
  if (ids.length === 0) return { games: gameRows, records: [], predictions: [] };
  const [{ data: records, error: recordsError }, { data: predictions, error: predictionsError }] = await Promise.all([
    supabase
      .from("prediction_records")
      .select("game_id, sport, market, model_version, locked_at, snapshot_json")
      .eq("sport", sport)
      .in("game_id", ids),
    supabase
      .from("game_predictions")
      .select("game_id, locked_at, sport_specific")
      .in("game_id", ids),
  ]);
  if (recordsError) throw new Error(`${sport} prediction_records: ${recordsError.message}`);
  if (predictionsError) throw new Error(`${sport} game_predictions: ${predictionsError.message}`);
  return {
    games: gameRows,
    records: (records ?? []) as RecordRow[],
    predictions: (predictions ?? []) as Array<{ game_id: number; locked_at: string | null; sport_specific: Json | null }>,
  };
}

function expectedMarkets(sport: "mlb" | "wnba"): string[] {
  return sport === "mlb" ? ["moneyline", "total", "first_inning"] : ["moneyline", "total", "spread"];
}

async function main(): Promise<void> {
  const dates = {
    mlb: requireDate(arg("mlb-date") ?? currentSlateDate("mlb")),
    wnba: requireDate(arg("wnba-date") ?? currentSlateDate("wnba")),
  };
  const blockers: string[] = [];
  const report: Record<string, unknown> = {};

  const mlb = await rowsForSport("mlb", dates.mlb);
  const mlbUnlocked = mlb.records.filter((row) => row.locked_at === null);
  for (const game of mlb.games) {
    for (const market of expectedMarkets("mlb")) {
      if (!mlb.records.some((row) => row.game_id === game.id && row.market === market)) {
        blockers.push(`MLB_MISSING_${game.id}_${market}`);
      }
    }
  }
  for (const row of mlbUnlocked) {
    const layers = (row.snapshot_json?.model_layer_versions ?? {}) as Json;
    const expected: Array<[string, string]> = [
      ["decision_release_id", MLB_DAILY_EDGE_DECISION_RELEASE_ID],
      ["rule_bundle_version", MLB_DAILY_EDGE_RULE_BUNDLE_VERSION],
      ["calibration_version", MLB_PUBLIC_CALIBRATION_VERSION],
      ["grade_policy", MLB_MODEL_LAYER_VERSION_IDS.grade_policy],
    ];
    for (const [field, value] of expected) {
      if (layers[field] !== value) blockers.push(`MLB_RELEASE_${row.game_id}_${row.market}_${field}`);
    }
  }
  report.mlb = {
    date: dates.mlb,
    games: mlb.games.length,
    records: mlb.records.length,
    unlockedRecords: mlbUnlocked.length,
    expected: {
      decisionRelease: MLB_DAILY_EDGE_DECISION_RELEASE_ID,
      ruleBundle: MLB_DAILY_EDGE_RULE_BUNDLE_VERSION,
      calibration: MLB_PUBLIC_CALIBRATION_VERSION,
      gradePolicy: MLB_MODEL_LAYER_VERSION_IDS.grade_policy,
    },
  };

  const wnba = await rowsForSport("wnba", dates.wnba);
  const wnbaUnlocked = wnba.records.filter((row) => row.locked_at === null);
  for (const game of wnba.games) {
    for (const market of expectedMarkets("wnba")) {
      if (!wnba.records.some((row) => row.game_id === game.id && row.market === market)) {
        blockers.push(`WNBA_MISSING_${game.id}_${market}`);
      }
    }
  }
  for (const prediction of wnba.predictions.filter((row) => row.locked_at === null)) {
    for (const mismatch of wnbaPredictionReleaseMismatches(prediction.sport_specific ?? {})) {
      blockers.push(`WNBA_SOURCE_${prediction.game_id}_${mismatch}`);
    }
  }
  for (const row of wnbaUnlocked) {
    const snapshot = row.snapshot_json ?? {};
    if (row.model_version !== EXPECTED_WNBA_MODEL_VERSION) blockers.push(`WNBA_RECORD_${row.game_id}_${row.market}_model_version`);
    if (snapshot.distribution_version !== EXPECTED_WNBA_DISTRIBUTION_VERSION) blockers.push(`WNBA_RECORD_${row.game_id}_${row.market}_distribution_version`);
    if (snapshot.grade_policy_version !== EXPECTED_WNBA_GRADE_POLICY_VERSION) blockers.push(`WNBA_RECORD_${row.game_id}_${row.market}_grade_policy_version`);
    if (snapshot.prediction_record_contract_version !== WNBA_PREDICTION_RECORD_CONTRACT_VERSION) blockers.push(`WNBA_RECORD_${row.game_id}_${row.market}_contract_version`);
  }
  report.wnba = {
    date: dates.wnba,
    games: wnba.games.length,
    records: wnba.records.length,
    unlockedRecords: wnbaUnlocked.length,
    expected: {
      model: EXPECTED_WNBA_MODEL_VERSION,
      distribution: EXPECTED_WNBA_DISTRIBUTION_VERSION,
      gradePolicy: EXPECTED_WNBA_GRADE_POLICY_VERSION,
      recordContract: WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
    },
  };

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ready: blockers.length === 0, blockers, ...report }, null, 2));
  if (blockers.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
