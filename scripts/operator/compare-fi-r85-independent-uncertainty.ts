/**
 * SELECT-only identical-input r84-vs-r85 FI comparator.
 *
 * Uses the persisted authoritative FI audit tuple. It never calls a provider,
 * queries an outcome, or exposes a mutation/apply mode.
 */
import { supabase } from "../../lib/db/supabase";
import { MLB_FIRST_INNING_RELEASE_ID } from "../../lib/automodel/mlbModelLayerVersions";
import { __TEST__ as FI_TEST } from "../../lib/automodel/mlbFirstInningModelV2";

const dateIndex = process.argv.indexOf("--date");
const date = dateIndex >= 0 ? process.argv[dateIndex + 1] : null;
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || process.argv.some((arg) => /--apply|--write|--mutate/i.test(arg))) {
  throw new Error("Usage: --date YYYY-MM-DD only; mutation flags are refused.");
}

type DbRow = Record<string, unknown>;
type ComparisonState = {
  side: string;
  probability_nrfi: number;
  expected_runs: unknown;
  grade: string;
  actionable: boolean;
  selected_exact_price: unknown;
};
type ComparisonRow = {
  game_id: number;
  external_id: number;
  matchup: string;
  locked_at: unknown;
  incumbent: ComparisonState;
  candidate: ComparisonState & {
    evaluation_book: unknown;
    evaluation_nrfi_price: unknown;
    evaluation_yrfi_price: unknown;
    uncertainty_mode: string;
  };
  transition: string;
};
const asObject = (value: unknown): DbRow => value !== null && typeof value === "object" && !Array.isArray(value) ? value as DbRow : {};
const isActionable = (grade: string) => grade === "lean" || grade === "best_angle";
const count = (rows: ComparisonRow[], key: "incumbent" | "candidate", value: string) => rows.filter((row) => row[key].side === value).length;

async function main() {
  const gamesResult = await supabase.from("games")
    .select("id,external_id,home_team_id,away_team_id")
    .eq("sport", "mlb").eq("slate_date", date).order("id", { ascending: true });
  if (gamesResult.error) throw new Error(gamesResult.error.message);
  const games = gamesResult.data ?? [];
  const ids = games.map((game) => Number(game.id));
  const [teamsResult, predictionsResult, recordsResult] = await Promise.all([
    supabase.from("teams").select("id,abbreviation"),
    supabase.from("game_predictions")
      .select("game_id,predicted_nrfi,nrfi_confidence,sport_specific,computed_at,locked_at")
      .in("game_id", ids),
    supabase.from("prediction_records")
      .select("id,game_id,pick,side,model_probability,play_grade,no_bet,odds_american,snapshot_json,locked_at")
      .eq("sport", "mlb").eq("market", "first_inning").in("game_id", ids)
      .order("id", { ascending: false }),
  ]);
  if (teamsResult.error) throw new Error(teamsResult.error.message);
  if (predictionsResult.error) throw new Error(predictionsResult.error.message);
  if (recordsResult.error) throw new Error(recordsResult.error.message);
  const abbreviations = new Map((teamsResult.data ?? []).map((team) => [Number(team.id), String(team.abbreviation)]));
  const predictions = new Map((predictionsResult.data ?? []).map((prediction) => [Number(prediction.game_id), prediction]));
  const records = new Map<number, DbRow>();
  for (const record of recordsResult.data ?? []) if (!records.has(Number(record.game_id))) records.set(Number(record.game_id), record);

  const rows: ComparisonRow[] = [];
  for (const game of games) {
    const prediction = predictions.get(Number(game.id)) as DbRow | undefined;
    if (!prediction) continue;
    const sportSpecific = asObject(prediction.sport_specific);
    const audit = asObject(sportSpecific.fi_v2_audit);
    const posterior = Number(audit.posterior_p_nrfi);
    const incumbentSide = String(audit.fi_pick ?? (prediction.predicted_nrfi === true ? "NRFI" : prediction.predicted_nrfi === false ? "YRFI" : "Toss-Up"));
    if (!Number.isFinite(posterior) || !["NRFI", "YRFI", "Toss-Up"].includes(incumbentSide)) continue;
    const hasForecastMarket = Number(audit.market_projection_book_count ?? 0) > 0 && Number.isFinite(Number(audit.market_nrfi_no_vig));
    const decision = FI_TEST.classifyFiPosterior(posterior, hasForecastMarket);
    const candidateSide = incumbentSide === "Toss-Up" || decision.pick === "Toss-Up" ? "Toss-Up" : decision.pick;
    const incumbentGrade = String(audit.fi_play_grade ?? "unknown");
    const candidateGrade = candidateSide === "Toss-Up" ? "toss_up" : incumbentGrade;
    const record = records.get(Number(game.id));
    rows.push({
      game_id: Number(game.id),
      external_id: Number(game.external_id),
      matchup: `${abbreviations.get(Number(game.away_team_id)) ?? "?"}@${abbreviations.get(Number(game.home_team_id)) ?? "?"}`,
      locked_at: prediction.locked_at ?? record?.locked_at ?? null,
      incumbent: { side: incumbentSide, probability_nrfi: posterior, expected_runs: audit.posterior_expected_first_inning_runs ?? null, grade: incumbentGrade, actionable: isActionable(incumbentGrade), selected_exact_price: record?.odds_american ?? null },
      candidate: { side: candidateSide, probability_nrfi: posterior, expected_runs: audit.posterior_expected_first_inning_runs ?? null, grade: candidateGrade, actionable: isActionable(candidateGrade), selected_exact_price: candidateSide === "Toss-Up" ? null : record?.odds_american ?? null, evaluation_book: audit.market_evaluation_sportsbook ?? null, evaluation_nrfi_price: audit.market_nrfi_odds_american ?? null, evaluation_yrfi_price: audit.market_yrfi_odds_american ?? null, uncertainty_mode: decision.mode },
      transition: incumbentSide === candidateSide ? "unchanged" : `${incumbentSide}->${candidateSide}`,
    });
  }
  const promotions = rows.filter((row) => !row.incumbent.actionable && row.candidate.actionable).length;
  const demotions = rows.filter((row) => row.incumbent.actionable && !row.candidate.actionable).length;
  console.log(JSON.stringify({
    mode: "select_only_identical_input_fi_r84_vs_r85",
    mutationMode: false,
    outcomesQueried: false,
    providersCalled: false,
    date,
    candidateRelease: MLB_FIRST_INNING_RELEASE_ID,
    rows,
    aggregate: {
      games: rows.length,
      incumbent: { NRFI: count(rows,"incumbent","NRFI"), YRFI: count(rows,"incumbent","YRFI"), TossUp: count(rows,"incumbent","Toss-Up"), actionable: rows.filter((row) => row.incumbent.actionable).length },
      candidate: { NRFI: count(rows,"candidate","NRFI"), YRFI: count(rows,"candidate","YRFI"), TossUp: count(rows,"candidate","Toss-Up"), actionable: rows.filter((row) => row.candidate.actionable).length },
      changed: rows.filter((row) => row.transition !== "unchanged").length,
      promotions,
      demotions,
      probabilityChanges: rows.filter((row) => row.incumbent.probability_nrfi !== row.candidate.probability_nrfi).length,
      projectionChanges: rows.filter((row) => row.incumbent.expected_runs !== row.candidate.expected_runs).length,
    },
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
