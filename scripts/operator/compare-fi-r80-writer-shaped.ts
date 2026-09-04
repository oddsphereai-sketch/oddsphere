/**
 * FI r84 writer-shaped comparator. SELECT-only: no provider calls, outcomes,
 * mutations, apply mode, or historical backfill. It compares the persisted
 * unlocked FI tuple with the current r84 writer output for one MLB slate.
 *
 * Usage: npx tsx --env-file=.env.local scripts/operator/compare-fi-r80-writer-shaped.ts --date YYYY-MM-DD
 */
import { supabase } from "../../lib/db/supabase";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { applyFiV2WriterOverride } from "../../lib/services/fiV2Writer";
import type { FiLineRow } from "../../lib/automodel/mlbFirstInningMarketBaseline";
import { MLB_FIRST_INNING_RELEASE_ID } from "../../lib/automodel/mlbModelLayerVersions";

const date = process.argv.includes("--date") ? process.argv[process.argv.indexOf("--date") + 1] : null;
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || process.argv.includes("--apply")) {
  throw new Error("Usage: --date YYYY-MM-DD only; --apply is refused (SELECT-only).");
}

const pill = (predicted: unknown, sp: Record<string, unknown>) =>
  sp.nrfi_decision_kind === "toss_up" ? "Toss-Up" : predicted === true ? "NRFI" : predicted === false ? "YRFI" : "Held";

async function main() {
  const { data: games, error } = await supabase.from("games")
    .select("id,external_id,home_team_id,away_team_id").eq("sport", "mlb").eq("slate_date", date);
  if (error) throw error;
  const ids = (games ?? []).map((g) => g.id as number);
  const [{ data: teams }, { data: predictions }, { data: records }, { data: lines }] = await Promise.all([
    supabase.from("teams").select("id,abbreviation"),
    supabase.from("game_predictions").select("game_id,predicted_nrfi,nrfi_confidence,sport_specific").in("game_id", ids),
    supabase.from("prediction_records").select("game_id,pick,side,model_probability,play_grade,no_bet,stake,odds_american,snapshot_json,locked_at").eq("market", "first_inning").in("game_id", ids),
    supabase.from("lines").select("game_id,sportsbook,side,line_value,odds_american,fetched_at").eq("market_type", "first_inning_total").in("game_id", ids),
  ]);
  const abbr = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));
  const predByGame = new Map((predictions ?? []).map((p) => [p.game_id as number, p]));
  const recordByGame = new Map((records ?? []).filter((r) => r.locked_at === null).map((r) => [r.game_id as number, r]));
  const linesByGame = new Map<number, FiLineRow[]>();
  for (const row of lines ?? []) {
    const rows = linesByGame.get(row.game_id as number) ?? [];
    rows.push({ market_type: "first_inning_total", sportsbook: row.sportsbook as string, side: row.side as string | null, line_value: row.line_value as number | null, odds_american: row.odds_american as number | null, fetched_at: row.fetched_at as string | null });
    linesByGame.set(row.game_id as number, rows);
  }
  const snapshots = await buildFeatureSnapshots("mlb", date!);
  const snapByExternal = new Map(snapshots.map((s) => [s.game_external_id, s]));
  let promotions = 0, demotions = 0, changed = 0, candidateActionable = 0, candidateToss = 0;
  console.log(`FI r84 writer-shaped SELECT-only comparator | ${date} | ${MLB_FIRST_INNING_RELEASE_ID}`);
  for (const game of games ?? []) {
    const current = predByGame.get(game.id as number);
    const currentSp = (current?.sport_specific ?? {}) as Record<string, unknown>;
    const currentAudit = (currentSp.fi_v2_audit ?? {}) as Record<string, unknown>;
    const snapshot = snapByExternal.get(game.external_id as number);
    if (!snapshot) continue;
    const candidate = applyFiV2WriterOverride(snapshot, linesByGame.get(game.id as number) ?? [], currentSp);
    const candidateSp = candidate.sport_specific_overrides;
    const candidateAudit = candidateSp.fi_v2_audit as Record<string, unknown>;
    const oldPill = pill(current?.predicted_nrfi, currentSp);
    const newPill = pill(candidate.predicted_nrfi, candidateSp);
    const oldGrade = String(currentAudit.fi_play_grade ?? "unknown");
    const newGrade = String(candidateAudit.fi_play_grade ?? "unknown");
    const oldActionable = oldGrade === "lean" || oldGrade === "best_angle";
    const newActionable = newGrade === "lean" || newGrade === "best_angle";
    if (!oldActionable && newActionable) promotions++;
    if (oldActionable && !newActionable) demotions++;
    if (newActionable) candidateActionable++;
    if (newPill === "Toss-Up") candidateToss++;
    if (oldPill !== newPill || currentAudit.posterior_p_nrfi !== candidateAudit.posterior_p_nrfi || oldGrade !== newGrade) changed++;
    const record = recordByGame.get(game.id as number) as Record<string, unknown> | undefined;
    const matchup = `${abbr.get(game.away_team_id as number) ?? "?"}@${abbr.get(game.home_team_id as number) ?? "?"}`;
    console.log(JSON.stringify({ game_id: game.id, external_id: game.external_id, matchup, incumbent: { side: oldPill, probability: currentAudit.posterior_p_nrfi ?? null, expected_runs: currentAudit.posterior_expected_first_inning_runs ?? null, grade: oldGrade, stake: record?.stake ?? null, exact_price: currentAudit.market_nrfi_odds_american ?? null }, r84: { side: newPill, probability: candidateAudit.posterior_p_nrfi, expected_runs: candidateAudit.posterior_expected_first_inning_runs, grade: newGrade, stake: record?.stake ?? null, exact_price: candidateAudit.market_nrfi_odds_american ?? null, toss_up: newPill === "Toss-Up" } }));
  }
  console.log(JSON.stringify({ aggregate: { changed, promotions, demotions, candidate_actionables: candidateActionable, candidate_toss_ups: candidateToss, outcomes_queried: false, mutations: false } }));
}
main().catch((error) => { console.error(error); process.exit(1); });
