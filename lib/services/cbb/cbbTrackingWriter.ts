import {CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,readCbbContextualOutcomeEvidence,type CbbReleasedOutcomeBoard} from "./cbbContextualOutcomeRuntime";
import {CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE,CBB_CONTEXTUAL_OUTCOME_GAME_RELEASE} from "@/lib/cbb/contextualOutcomeBoard";
import {CBB_NATIVE_COUNTERPRESSURE_MODEL_RELEASE,CBB_NATIVE_COUNTERPRESSURE_GRADE_RELEASE} from "@/lib/cbb/marketBehaviorCandidate";
import {CBB_CONTEXTUAL_HANDOFF_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_MONEYLINE_VALUE_GRADE_RELEASE} from "@/lib/cbb/marketBehaviorCandidate";
import { createHash } from "node:crypto";
import type { supabase } from "@/lib/db/supabase";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { computeSlateDate } from "@/lib/dates/slateDate";
import { cbbImpliedProbability } from "@/lib/cbb/marketEvidence";
import { CBB_SCORE_RESEARCH_RELEASE } from "@/lib/cbb/scoreResearch";
import {CBB_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_PRIOR_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE,CBB_INTERMEDIATE_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_PRIOR_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE} from "@/lib/cbb/marketBehaviorCandidate";
import { CBB_CURRENT_SCORE_RELEASE,CBB_PREVIOUS_CURRENT_SCORE_RELEASE } from "@/lib/cbb/currentScoreRuntime";
import {CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_CONTINUITY_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_JOINT_MARKET_BEHAVIOR_GRADE_RELEASE} from "@/lib/cbb/marketBehaviorCandidate";
import {CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_ALIGNED_MARKET_BEHAVIOR_GRADE_RELEASE} from "@/lib/cbb/marketBehaviorCandidate";
import {CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_RETAIL_MARKET_BEHAVIOR_GRADE_RELEASE} from "@/lib/cbb/marketBehaviorCandidate";
import {CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_EPISODE_MARKET_BEHAVIOR_GRADE_RELEASE} from "@/lib/cbb/marketBehaviorCandidate";
import { CBB_PROVISIONAL_GRADE_RELEASE, CBB_LEGACY_PROVISIONAL_GRADE_RELEASE } from "@/lib/cbb/provisionalGradePolicy";
import type { CbbStoredMemberGame } from "./cbbMemberGameStore";
import {CBB_COORDINATED_PROVIDER_MARKET_MODEL_RELEASE,CBB_FULL_D1_SCORE_RELEASE,CBB_FULL_D1_MARKET_MODEL_RELEASE,CBB_PREVIOUS_FULL_D1_MARKET_MODEL_RELEASE,CBB_SOURCE_ADMISSION_MARKET_MODEL_RELEASE} from "@/lib/cbb/fullDivisionOneReleases";
import {CBB_CROSS_DIVISION_SCORE_RELEASE,CBB_FULL_D1_COVERAGE_START} from "@/lib/cbb/crossDivisionPrior";
import {CBB_GAME_FORECAST_GRADE_RELEASE,CBB_GAME_OUTCOME_RELEASE} from "@/lib/cbb/gameForecastBoard";
import {normalCdf} from "@/lib/cbb/model";

export const CBB_TRACKING_WRITER_RELEASE = "cbb_tracking_writer_2026_11_05_r26_contextual_outcome" as const;
/** Hash stored JSON independently of PostgreSQL jsonb object-key ordering. */
export function cbbTrackingEvidenceSha256(record:CbbStoredMemberGame):string {
  const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted)
    :value!==null&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort()
      .map(key=>[key,sorted((value as Record<string,unknown>)[key])])):value;
  return createHash("sha256").update(JSON.stringify(sorted(JSON.parse(JSON.stringify(record))))).digest("hex");
}
const receivedMarketGradeReleases:readonly string[]=[CBB_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_NATIVE_COUNTERPRESSURE_GRADE_RELEASE,CBB_MONEYLINE_VALUE_GRADE_RELEASE,CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE,CBB_CONTINUITY_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_JOINT_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_ALIGNED_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_RETAIL_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_EPISODE_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_INTERMEDIATE_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_PRIOR_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE];

/** Never relabel an earlier public lock with the current score model. */
export function cbbLockedModelRelease(board:{release:string;modelRelease?:string}):string{
  if(board.modelRelease===CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE)return board.modelRelease;
  if([CBB_FULL_D1_SCORE_RELEASE,CBB_FULL_D1_MARKET_MODEL_RELEASE,CBB_COORDINATED_PROVIDER_MARKET_MODEL_RELEASE,CBB_SOURCE_ADMISSION_MARKET_MODEL_RELEASE,CBB_PREVIOUS_FULL_D1_MARKET_MODEL_RELEASE,CBB_CROSS_DIVISION_SCORE_RELEASE].includes(board.modelRelease as typeof CBB_FULL_D1_SCORE_RELEASE))return board.modelRelease!;
  if(board.modelRelease===CBB_SCORE_RESEARCH_RELEASE||board.modelRelease===CBB_CURRENT_SCORE_RELEASE||board.modelRelease===CBB_PREVIOUS_CURRENT_SCORE_RELEASE||board.modelRelease===CBB_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_NATIVE_COUNTERPRESSURE_MODEL_RELEASE||board.modelRelease===CBB_CONTEXTUAL_HANDOFF_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_PRIOR_MARKET_BEHAVIOR_MODEL_RELEASE||board.modelRelease===CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE)return board.modelRelease;
  if(board.modelRelease!==undefined)throw new Error("CBB locked model release is unknown");
  if(["cbb_candidate_2026_10_29_r2_explicit_unqualified_reader","cbb_candidate_2026_10_29_r3_exact_quote_reader_fields",
    "cbb_candidate_2026_11_02_r4_supported_market_coverage","cbb_candidate_2026_11_02_r5_exact_reference_probabilities"].includes(board.release))return CBB_SCORE_RESEARCH_RELEASE;
  throw new Error("CBB locked board is missing its model release");
}

/** Resolve the release that actually owns the frozen public decision. */
export function cbbLockedGradeRelease(board: { release: string; gradeRelease?: string }): string {
  if(board.gradeRelease===CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE)return board.gradeRelease;
  if(board.gradeRelease===CBB_GAME_FORECAST_GRADE_RELEASE)return board.gradeRelease;
  if (board.gradeRelease === CBB_PROVISIONAL_GRADE_RELEASE || board.gradeRelease === CBB_LEGACY_PROVISIONAL_GRADE_RELEASE || receivedMarketGradeReleases.includes(board.gradeRelease??"")) return board.gradeRelease!;
  if (board.gradeRelease !== undefined) throw new Error("CBB locked grade release is unknown");
  if (["cbb_candidate_2026_10_29_r2_explicit_unqualified_reader", "cbb_candidate_2026_10_29_r3_exact_quote_reader_fields",
    "cbb_candidate_2026_11_02_r4_supported_market_coverage"].includes(board.release)) return CBB_LEGACY_PROVISIONAL_GRADE_RELEASE;
  throw new Error("CBB locked board is missing its grade release");
}

function sameInstant(left:string|null|undefined,right:string):boolean {
  const first=Date.parse(left??""),second=Date.parse(right);
  return Number.isFinite(first)&&Number.isFinite(second)&&first===second;
}

// Shared SQL columns are bounded-decimal summaries. Exact new-model values
// live in the immutable JSON receipt; do not round member fields to match SQL.
function storedNumberMatches(actual:number|null,expected:number|null,digits:number){
 return actual===null||expected===null?actual===expected:Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=.5*10**-digits+8*Number.EPSILON*Math.max(1,Math.abs(expected));
}

/** Validate the stored numerical law, not a new model or newer grade policy.
 * Existing locked DTOs remain authoritative; a discrepancy throws rather than
 * replacing any field. No artifact fetch, normal approximation or reforecast. */
export function assertCbbContextualLockedRecord(record:CbbStoredMemberGame){
 const {snapshot,memberGame}=record;if(snapshot.board.modelRelease!==CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE)return null;
 const board=snapshot.board as CbbReleasedOutcomeBoard,stored=readCbbContextualOutcomeEvidence(board);
 if(!stored||board.calibrationRelease!==CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE||!snapshot.lockedAt||memberGame.lockedAt!==snapshot.lockedAt||
  memberGame.external_id!==snapshot.gameId||memberGame.gameStartAt!==snapshot.startsAt||memberGame.projected?.home!==board.score.home||memberGame.projected?.away!==board.score.away)
  throw Error("CBB contextual frozen DTO/score/calibration mismatch");
 const d=stored.decision,law=d.numericalTrace.law,score=board.score,near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-10;
 const summary={home:law.homeMean,away:law.awayMean,margin:law.marginMean,total:law.totalMean,homeWinProbability:law.homeWinProbability};
 if((Object.keys(summary) as (keyof typeof summary)[]).some(k=>!near(summary[k],score[k]))||
  !near(law.marginSd,d.finalUncertainty.marginSd)||!near(law.totalSd,d.finalUncertainty.totalSd)||!near(law.marginTotalCorrelation,d.finalUncertainty.marginTotalCorrelation)||
  (["marginMean","totalMean","marginSd","totalSd","correlation"] as const).some(k=>law.latent[k]!==d.numericalTrace.finalLatentDistribution[k]))
  throw Error("CBB contextual stored joint-law summary differs from frozen score");
 for(const row of board.rows){const key=row.market==="spread"?"first_inning":row.market,dto=memberGame.markets[key],decision=d.marketDecisions.find(x=>x.market===row.market)!;
  if(row.selection===null){if(row.grade!=="Held"||row.price!==null||row.expectedValue!==null)throw Error("CBB contextual unpriced market became a wager");continue;}
  const p=decision.probabilityNumerics,target=decision.target,win=row.selection==="first"?p?.first:p?.second,lose=row.selection==="first"?p?.second:p?.first;
  const price=row.selection==="first"?target?.firstPrice:target?.secondPrice,line=row.market==="spread"&&row.selection==="second"&&row.line!==null?-row.line:row.line;
  const grade=row.grade==="Best Angle"?"best_angle":row.grade==="Lean"?"lean":row.grade==="Watchlist"?"watchlist":"no_play";
  const informational=row.grade==="Watchlist";
  if(!p||!target||win===undefined||lose===undefined||price===undefined||row.price!==price||!near(row.probability!,win)||!near(row.loseProbability!,lose)||
   !near(row.pushProbability!,p.push)||!near(win+lose+p.push,1)||!near(row.expectedValue!,win*(price>0?price/100:100/-price)-lose)||
   dto.modelProb!==row.probability||dto.confidence!==row.probability||dto.priceAmerican!==row.price||dto.line!==line||dto.verdict.key!==grade||
   row.informationalNonActionablePrice!==informational||informational&&(dto.recommendationConfidence!==null||!dto.reviewFlags?.includes("informational_non_actionable_price")))
   throw Error(`CBB contextual frozen ${row.market} differs from its exact stored law/price/DTO`);
 }
 return stored;
}

/** Mirror the already-frozen public record into shared official tracking.
 * The member snapshot, never a new model calculation, is the authority. */
export async function writeLockedCbbTracking(record: CbbStoredMemberGame, db?: typeof supabase): Promise<number> {
  const lock = record.snapshot.lockedAt;
  if (!lock) return 0;
  const { snapshot, memberGame } = record;
  const gradeRelease = cbbLockedGradeRelease(snapshot.board);
  const modelRelease = cbbLockedModelRelease(snapshot.board);
  const contextual=assertCbbContextualLockedRecord(record);
  const calibrationRelease=contextual?CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE:gradeRelease;
  if(modelRelease===CBB_FULL_D1_MARKET_MODEL_RELEASE||modelRelease===CBB_COORDINATED_PROVIDER_MARKET_MODEL_RELEASE||modelRelease===CBB_SOURCE_ADMISSION_MARKET_MODEL_RELEASE||modelRelease===CBB_PREVIOUS_FULL_D1_MARKET_MODEL_RELEASE||modelRelease===CBB_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_NATIVE_COUNTERPRESSURE_MODEL_RELEASE||modelRelease===CBB_CONTEXTUAL_HANDOFF_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_PRIOR_MARKET_BEHAVIOR_MODEL_RELEASE||modelRelease===CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE){
    const read=snapshot.board.marketContext.verifiedMarketRead;
    if(!read||read.modelRelease!==modelRelease||read.anchors.gameId!==snapshot.gameId||
      !(receivedMarketGradeReleases.includes(gradeRelease)||gradeRelease===CBB_GAME_FORECAST_GRADE_RELEASE)||(["home","away","margin","total","homeWinProbability"] as const).some(key=>read.finalScore[key]!==snapshot.board.score[key]))
      throw new Error("CBB market-behavior tracking receipt differs from locked score");
  }
  if (memberGame.lockedAt !== lock || memberGame.external_id !== snapshot.gameId ||
    memberGame.gameStartAt !== snapshot.startsAt) throw new Error("CBB tracking lock/reader mismatch");
  const client = db ?? (await import("@/lib/db/supabase")).supabase;
  const { data: fixture, error: fixtureError } = await client.from("games")
    .select("id,external_id,game_date,slate_date,home_team:teams!games_home_team_id_fkey(external_id,display_name),away_team:teams!games_away_team_id_fkey(external_id,display_name)").eq("sport", "cbb")
    .eq("external_id", snapshot.gameId).maybeSingle();
  if (fixtureError || !fixture || !sameInstant(fixture.game_date,snapshot.startsAt) ||
    fixture.slate_date !== computeSlateDate("cbb", snapshot.startsAt)) {
    throw new Error(`CBB tracking canonical fixture missing or changed: ${fixtureError?.message ?? snapshot.gameId}`);
  }
  const { data: existingRows, error: existingError } = await client.from("prediction_records")
    .select("id,market,pick,side,line_value,odds_american,play_grade,locked_at,model_version,calibration_version,model_probability,confidence,expected_value,snapshot_json")
    .eq("sport", "cbb").eq("game_id", fixture.id);
  if (existingError) throw new Error(`CBB tracking read failed: ${existingError.message}`);
  const existing = new Map<string, typeof existingRows>();
  for (const row of existingRows ?? []) {
    if (existing.has(row.market)) throw new Error(`CBB duplicate tracking market ${row.market}`);
    existing.set(row.market, [row]);
  }
  let inserted = 0;
  const evidenceSha256=cbbTrackingEvidenceSha256(record);
  const outcome=snapshot.board.gameForecast;
  if(outcome){
    const home=Array.isArray(fixture.home_team)?fixture.home_team[0]:fixture.home_team;
    const away=Array.isArray(fixture.away_team)?fixture.away_team[0]:fixture.away_team;
    const sd=outcome.uncertainty.marginSd,margin=snapshot.board.score.margin;
    // The contextual model already supplies a conditioned joint-law winner;
    // only legacy R1 game forecasts use this older marginal-normal verifier.
    const zero=contextual?0:normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
    const probability=contextual?contextual.decision.finalScore.homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero);
    if(!home||!away||Number(home.external_id)!==outcome.homeId||Number(away.external_id)!==outcome.awayId||
      home.display_name!==memberGame.homeTeamDisplayName||away.display_name!==memberGame.awayTeamDisplayName||
      !Number.isFinite(sd)||sd<=0||!Number.isFinite(probability)||Math.abs(probability-outcome.homeWinProbability)>1e-10)
      throw Error("CBB frozen game winner has invalid school identity or score law");
  }
  if(outcome&&(outcome.release!==(contextual?CBB_CONTEXTUAL_OUTCOME_GAME_RELEASE:CBB_GAME_OUTCOME_RELEASE)||(!contextual&&computeSlateDate("cbb",snapshot.startsAt)<CBB_FULL_D1_COVERAGE_START)||
    !Number.isFinite(outcome.probability)||outcome.probability<0||outcome.probability>1||
    outcome.homeWinProbability!==snapshot.board.score.homeWinProbability||
    outcome.selection!==(outcome.homeWinProbability>=.5?"first":"second")||
    Math.abs(outcome.probability-(outcome.selection==="first"?outcome.homeWinProbability:1-outcome.homeWinProbability))>1e-10))
    throw Error("CBB frozen game winner differs from its score law");
  const trackedRows=snapshot.board.rows.map(row=>row.market==="moneyline"&&row.selection===null&&outcome?
    {...row,selection:outcome.selection,probability:outcome.probability,price:null,expectedValue:null,
      reason:"unpriced_model_outcome",unpricedWinner:true as const}:{...row,unpricedWinner:false as const});
  for (const row of trackedRows) {
    if (row.selection === null || row.probability === null || row.price===null&&!row.unpricedWinner) continue;
    const side = row.market === "total" ? row.selection === "first" ? "over" : "under"
      : row.selection === "first" ? "home" : "away";
    const line = row.market === "moneyline" ? null : row.market === "spread" && row.selection === "second"
      ? -row.line! : row.line;
    const grade = row.grade === "Best Angle" ? "best_angle" : row.grade === "Lean" ? "lean"
      : row.grade === "Watchlist" ? "watchlist" : "no_play";
    const prior = existing.get(row.market)?.[0];
    if (prior) {
      const exact=prior.snapshot_json&&typeof prior.snapshot_json==="object"&&!Array.isArray(prior.snapshot_json)?prior.snapshot_json as Record<string,unknown>:null;
      if (prior.pick !== side || prior.side !== side || prior.line_value !== line ||
        prior.odds_american !== row.price || prior.play_grade !== grade || !sameInstant(prior.locked_at,lock) ||
        prior.model_version !== modelRelease ||
        prior.calibration_version !== calibrationRelease||contextual&&(!storedNumberMatches(prior.model_probability,row.probability,6)||!storedNumberMatches(prior.confidence,row.probability,2)||!storedNumberMatches(prior.expected_value,row.expectedValue,4)||exact?.selectedProbability!==row.probability||exact?.selectedPushProbability!==row.pushProbability||exact?.selectedExpectedValue!==row.expectedValue)) {
        throw new Error(`CBB immutable tracking row conflicts with locked member market ${row.market}`);
      }
      continue;
    }
    const payload: PredictionRecordRow = {
      game_prediction_id: null, game_id: fixture.id, external_id: snapshot.gameId, sport: "cbb",
      slate_date: fixture.slate_date, game_date: snapshot.startsAt,
      matchup: `${memberGame.awayTeamDisplayName} @ ${memberGame.homeTeamDisplayName}`,
      market: row.market, pick: side, side, line_value: line, odds_american: row.price,
      odds_decimal: null, model_used: contextual?"cbb_contextual_outcome_r1":modelRelease===CBB_FULL_D1_MARKET_MODEL_RELEASE?"cbb_r22_fixture_clock_epoch":
        modelRelease===CBB_COORDINATED_PROVIDER_MARKET_MODEL_RELEASE?"cbb_r21_coordinated_provider_capture":
        modelRelease===CBB_SOURCE_ADMISSION_MARKET_MODEL_RELEASE?"cbb_r20_complete_source_admission":
        modelRelease===CBB_PREVIOUS_FULL_D1_MARKET_MODEL_RELEASE?"cbb_r19_complete_d1_program_priors":
        modelRelease===CBB_FULL_D1_SCORE_RELEASE?"cbb_independent_r5_complete_d1_program_priors":
        modelRelease===CBB_CROSS_DIVISION_SCORE_RELEASE?"cbb_cross_division_r1_posterior_score_law":modelRelease===CBB_SCORE_RESEARCH_RELEASE?"cbb_independent_r2_provisional_market_reader":
        modelRelease===CBB_CURRENT_SCORE_RELEASE?"cbb_independent_r4_verified_new_orleans_prior":
        modelRelease===CBB_PREVIOUS_CURRENT_SCORE_RELEASE?"cbb_independent_r3_verified_venue_prior":
        modelRelease===CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r5_received_market_response":
        modelRelease===CBB_PRIOR_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r6_new_orleans_prior_input":
        modelRelease===CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r10_observed_episode_authority":
        modelRelease===CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r11_retail_response_receipts":
        modelRelease===CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r12_aligned_native_reactions":
        modelRelease===CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r13_joint_native_market_decision":
        modelRelease===CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r14_current_board_source_aliases":
        modelRelease===CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r15_response_frontier_law_support":
        modelRelease===CBB_CONTEXTUAL_HANDOFF_MARKET_BEHAVIOR_MODEL_RELEASE?"cbb_r16_contextual_authority_handoff":
        modelRelease===CBB_NATIVE_COUNTERPRESSURE_MODEL_RELEASE?"cbb_r17_native_counterpressure_handoff":"cbb_r18_current_source_forecast_restoration",
      model_version: modelRelease, calibration_version: calibrationRelease,
      prediction_source: "cbb_daily_edge", confidence: row.probability,
      model_probability: row.probability, market_probability: row.price===null?null:cbbImpliedProbability(row.price),
      edge: row.price===null?null:row.probability - cbbImpliedProbability(row.price), expected_value: row.expectedValue,
      play_grade: grade, prediction_type: row.market === "moneyline" ? "game_ml" : row.market === "spread" ? "game_spread" : "game_total",
      best_angle: grade === "best_angle", no_bet: grade !== "best_angle" && grade !== "lean",
      no_bet_reason: grade === "no_play" ? row.reason : null,
      market_aligned: row.referenceState === "agrees", data_quality_tier: "provisional",
      source_quality:row.unpricedWinner?"statistical_game_forecast_without_qualified_book_price":row.professionalReferences ? "exact_named_professional_reference" : "exact_named_consumer_book",
      provisional: true, held: false, hold_reason: null, launch_day: false,
      manual_outcome_expected: false, locked_at: lock, published_at: snapshot.capturedAt,
      snapshot_json: { release: CBB_TRACKING_WRITER_RELEASE, memberStoreRelease: record.release,
        evidence_payload_sha256:evidenceSha256,evidence_payload_hash_format:"sha256_sorted_json_v1",
        evidence_snapshot_key:`cbb::member-game::${snapshot.gameId}`,
        boardRelease: snapshot.board.release, modelRelease, gradeRelease,
        ...(contextual?{calibrationRelease,selectedProbability:row.probability,selectedPushProbability:row.pushProbability,selectedExpectedValue:row.expectedValue,
          contextualArtifact:contextual.decision.artifact,contextualDecisionRelease:contextual.decision.release,
          contextualEvidenceSha256:(snapshot.board as CbbReleasedOutcomeBoard).marketContext.contextualOutcomeEvidence.uncompressedSha256}:{}),
        lockedMemberGameId: snapshot.gameId, selectedBook: row.targetBook,
        selectedLine: line, selectedPrice: row.price, selectedGrade: grade,
        projectedHome: snapshot.board.score.home, projectedAway: snapshot.board.score.away,
        ...(outcome?{game_forecast_release:outcome.release,coverage_inputs:outcome.inputs}:{}),
      },
    };
    const { error } = await client.from("prediction_records").insert(payload);
    if (error) throw new Error(`CBB tracking insert failed for ${row.market}: ${error.message}`);
    inserted++;
  }
  return inserted;
}
