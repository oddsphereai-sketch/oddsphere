import type { DailyEdgeResponse } from "../../app/lab/lib/labTypes";
import { supabase } from "../../lib/db/supabase";
import { EPL_EXTERNAL_ID_OFFSET, findEplGamesEnteringLock } from "../../lib/services/epl/eplProductionPipeline";
import { EPL_SHADOW_MODEL_RELEASE } from "../../lib/services/epl/eplShadowModel";

const SNAPSHOT_KEY = "soccer::english_premier_league::current-week";

async function main() {
  const checkedAt = new Date().toISOString();
  const dueCandidates = await findEplGamesEnteringLock(new Date(checkedAt));
  const { data: snapshotRow, error: snapshotError } = await supabase
    .from("lab_response_snapshots")
    .select("payload,payload_version,generated_at,updated_at")
    .eq("snapshot_key", SNAPSHOT_KEY)
    .single();
  if (snapshotError) throw new Error(snapshotError.message);
  const snapshot = snapshotRow.payload as DailyEdgeResponse;
  const arsenal = snapshot.games.find((game) => game.homeTeam === "ARS" || game.awayTeam === "ARS");
  if (!arsenal) throw new Error("Arsenal fixture is not in the current EPL snapshot");
  const externalId = EPL_EXTERNAL_ID_OFFSET + Number(arsenal.external_id);
  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id,external_id,game_date,status")
    .eq("sport", "soccer")
    .eq("external_id", externalId)
    .single();
  if (gameError) throw new Error(gameError.message);
  const { data: records, error: recordsError } = await supabase
    .from("prediction_records")
    .select("market,pick,side,model_probability,market_probability,edge,expected_value,odds_american,play_grade,no_bet,locked_at,calibration_version,snapshot_json")
    .eq("game_id", game.id)
    .eq("model_version", EPL_SHADOW_MODEL_RELEASE)
    .order("market", { ascending: true });
  if (recordsError) throw new Error(recordsError.message);
  const { data: lockRuns, error: lockRunsError } = await supabase
    .from("data_refresh_log")
    .select("id,refresh_started_at,refresh_completed_at,refresh_status,records_updated,error_message")
    .eq("data_source", "epl_pregame_lock")
    .eq("sport", "soccer")
    .order("refresh_started_at", { ascending: false })
    .limit(10);
  if (lockRunsError) throw new Error(lockRunsError.message);
  const { data: refreshRuns, error: refreshRunsError } = await supabase
    .from("data_refresh_log")
    .select("id,refresh_started_at,refresh_completed_at,refresh_status,records_updated,error_message")
    .eq("data_source", "epl_daily_refresh")
    .eq("sport", "soccer")
    .order("refresh_started_at", { ascending: false })
    .limit(5);
  if (refreshRunsError) throw new Error(refreshRunsError.message);
  const moneyline = arsenal.markets.moneyline;
  console.log(JSON.stringify({
    checkedAt,
    dueCandidates,
    snapshot: {
      generatedAt: snapshotRow.generated_at,
      updatedAt: snapshotRow.updated_at,
      payloadVersion: snapshotRow.payload_version,
      matchup: `${arsenal.awayTeam}@${arsenal.homeTeam}`,
      kickoff: arsenal.gameStartAt,
      scheduledLockAt: arsenal.scheduledLockAt,
      lockState: arsenal.lockState,
      lockedAt: arsenal.lockedAt,
      matchResult: {
        pick: moneyline.pick,
        probability: moneyline.modelProb,
        marketProbability: moneyline.marketFairProb,
        price: moneyline.currentPriceAmerican,
        sportsbook: moneyline.currentPriceSportsbook,
        verdict: moneyline.verdict.label,
        gradeReason: moneyline.riskLine,
        trail: moneyline.oddsTrail,
      },
    },
    game,
    lockRuns,
    refreshRuns,
    currentReleaseRecords: (records ?? []).map((record) => ({
      market: record.market,
      pick: record.pick,
      side: record.side,
      modelProbability: record.model_probability,
      marketProbability: record.market_probability,
      edgePp: record.edge,
      expectedValue: record.expected_value,
      price: record.odds_american,
      playGrade: record.play_grade,
      noBet: record.no_bet,
      lockedAt: record.locked_at,
      scheduledLockAt: (record.snapshot_json as { scheduled_lock_at?: string } | null)?.scheduled_lock_at ?? null,
      calibrationVersion: record.calibration_version,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
