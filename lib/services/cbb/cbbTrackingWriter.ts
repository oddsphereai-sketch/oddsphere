import type { supabase } from "@/lib/db/supabase";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { computeSlateDate } from "@/lib/dates/slateDate";
import { cbbImpliedProbability } from "@/lib/cbb/marketEvidence";
import { CBB_SCORE_RESEARCH_RELEASE } from "@/lib/cbb/scoreResearch";
import { CBB_PROVISIONAL_GRADE_RELEASE } from "@/lib/cbb/provisionalGradePolicy";
import type { CbbStoredMemberGame } from "./cbbMemberGameStore";

export const CBB_TRACKING_WRITER_RELEASE = "cbb_tracking_writer_2026_11_01_r2_canonical_timestamp_instants" as const;

function sameInstant(left:string|null|undefined,right:string):boolean {
  const first=Date.parse(left??""),second=Date.parse(right);
  return Number.isFinite(first)&&Number.isFinite(second)&&first===second;
}

/** Mirror the already-frozen public record into shared official tracking.
 * The member snapshot, never a new model calculation, is the authority. */
export async function writeLockedCbbTracking(record: CbbStoredMemberGame, db?: typeof supabase): Promise<number> {
  const lock = record.snapshot.lockedAt;
  if (!lock) return 0;
  const { snapshot, memberGame } = record;
  if (memberGame.lockedAt !== lock || memberGame.external_id !== snapshot.gameId ||
    memberGame.gameStartAt !== snapshot.startsAt) throw new Error("CBB tracking lock/reader mismatch");
  const client = db ?? (await import("@/lib/db/supabase")).supabase;
  const { data: fixture, error: fixtureError } = await client.from("games")
    .select("id,external_id,game_date,slate_date").eq("sport", "cbb")
    .eq("external_id", snapshot.gameId).maybeSingle();
  if (fixtureError || !fixture || !sameInstant(fixture.game_date,snapshot.startsAt) ||
    fixture.slate_date !== computeSlateDate("cbb", snapshot.startsAt)) {
    throw new Error(`CBB tracking canonical fixture missing or changed: ${fixtureError?.message ?? snapshot.gameId}`);
  }
  const { data: existingRows, error: existingError } = await client.from("prediction_records")
    .select("id,market,pick,side,line_value,odds_american,play_grade,locked_at,model_version,calibration_version")
    .eq("sport", "cbb").eq("game_id", fixture.id);
  if (existingError) throw new Error(`CBB tracking read failed: ${existingError.message}`);
  const existing = new Map<string, typeof existingRows>();
  for (const row of existingRows ?? []) {
    if (existing.has(row.market)) throw new Error(`CBB duplicate tracking market ${row.market}`);
    existing.set(row.market, [row]);
  }
  let inserted = 0;
  for (const row of snapshot.board.rows) {
    if (row.selection === null || row.price === null || row.probability === null) continue;
    const side = row.market === "total" ? row.selection === "first" ? "over" : "under"
      : row.selection === "first" ? "home" : "away";
    const line = row.market === "moneyline" ? null : row.market === "spread" && row.selection === "second"
      ? -row.line! : row.line;
    const grade = row.grade === "Best Angle" ? "best_angle" : row.grade === "Lean" ? "lean"
      : row.grade === "Watchlist" ? "watchlist" : "no_play";
    const prior = existing.get(row.market)?.[0];
    if (prior) {
      if (prior.pick !== side || prior.side !== side || prior.line_value !== line ||
        prior.odds_american !== row.price || prior.play_grade !== grade || !sameInstant(prior.locked_at,lock) ||
        prior.model_version !== CBB_SCORE_RESEARCH_RELEASE ||
        prior.calibration_version !== CBB_PROVISIONAL_GRADE_RELEASE) {
        throw new Error(`CBB immutable tracking row conflicts with locked member market ${row.market}`);
      }
      continue;
    }
    const payload: PredictionRecordRow = {
      game_prediction_id: null, game_id: fixture.id, external_id: snapshot.gameId, sport: "cbb",
      slate_date: fixture.slate_date, game_date: snapshot.startsAt,
      matchup: `${memberGame.awayTeamDisplayName} @ ${memberGame.homeTeamDisplayName}`,
      market: row.market, pick: side, side, line_value: line, odds_american: row.price,
      odds_decimal: null, model_used: "cbb_independent_r2_provisional_market_reader",
      model_version: CBB_SCORE_RESEARCH_RELEASE, calibration_version: CBB_PROVISIONAL_GRADE_RELEASE,
      prediction_source: "cbb_daily_edge", confidence: row.probability,
      model_probability: row.probability, market_probability: cbbImpliedProbability(row.price),
      edge: row.probability - cbbImpliedProbability(row.price), expected_value: row.expectedValue,
      play_grade: grade, prediction_type: row.market === "moneyline" ? "game_ml" : row.market === "spread" ? "game_spread" : "game_total",
      best_angle: grade === "best_angle", no_bet: grade !== "best_angle" && grade !== "lean",
      no_bet_reason: grade === "no_play" ? row.reason : null,
      market_aligned: row.referenceState === "agrees", data_quality_tier: "provisional",
      source_quality: row.professionalReferences ? "exact_named_professional_reference" : "exact_named_consumer_book",
      provisional: true, held: false, hold_reason: null, launch_day: false,
      manual_outcome_expected: false, locked_at: lock, published_at: snapshot.capturedAt,
      snapshot_json: { release: CBB_TRACKING_WRITER_RELEASE, memberStoreRelease: record.release,
        boardRelease: snapshot.board.release, gradeRelease: CBB_PROVISIONAL_GRADE_RELEASE,
        lockedMemberGameId: snapshot.gameId, selectedBook: row.targetBook,
        selectedLine: line, selectedPrice: row.price, selectedGrade: grade,
        projectedHome: snapshot.board.score.home, projectedAway: snapshot.board.score.away },
    };
    const { error } = await client.from("prediction_records").insert(payload);
    if (error) throw new Error(`CBB tracking insert failed for ${row.market}: ${error.message}`);
    inserted++;
  }
  return inserted;
}
