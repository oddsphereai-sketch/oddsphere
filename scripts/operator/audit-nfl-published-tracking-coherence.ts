/**
 * Audits NFL prediction_records against the immutable prediction rendered from
 * the exact T-60 evidence payload. With --apply, appends correction records and
 * grades them; it never updates or deletes an original prediction record.
 */
import { supabase } from "@/lib/db/supabase";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "@/lib/services/football/nflForwardEvidence";
import { nflV1WeekOneLineProbabilities } from "@/lib/services/football/nflV1WeekOneOutcome";
import { selectNflPredictionOwnedMoneylineEvaluation } from "@/lib/services/football/nflV1ProductionDecision";
import {
  buildNflPublishedMoneylineTrackingCorrection,
  NFL_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION,
  NFL_PUBLISHED_TRACKING_CORRECTION_RELEASE,
} from "@/lib/services/football/nflPublishedTrackingCorrection";
import { gradePredictionsForSlate } from "@/lib/services/predictionGradingService";

type TrackingRow = PredictionRecordRow & {
  id: number;
  market: "moneyline" | "spread" | "total";
  pick: string;
  side: "home" | "away" | "over" | "under";
  locked_at: string;
  prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
};

type EvidenceRow = {
  payload_sha256: string;
  payload: NflForwardEvidencePayload;
};

type CorrectedMoneyline = {
  sportsbook: string;
  price: number;
  modelProbability: number;
  marketProbability: number;
  expectedValue: number;
  edgePercentagePoints: number;
  grade: "Best Angle" | "Lean" | "Watchlist" | "No Play";
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function correctedMoneyline(payload: NflForwardEvidencePayload): CorrectedMoneyline {
  const home = payload.outcomeForecast.homeWinProbability >= payload.outcomeForecast.awayWinProbability;
  const modelProbability = home ? payload.outcomeForecast.homeWinProbability : payload.outcomeForecast.awayWinProbability;
  const selected = selectNflPredictionOwnedMoneylineEvaluation({
    books: payload.market.comparableCurrentBooks,
    home,
    modelProbability,
    gameStartsAt: payload.game.scheduledStart,
  });
  if (!selected) throw new Error(`NFL ${payload.game.providerGameId} has no prediction-side Moneyline tuple.`);
  return {
    sportsbook: selected.quote.sportsbook,
    price: selected.quote.price,
    modelProbability: selected.modelProbability,
    marketProbability: selected.looFairProbability,
    expectedValue: selected.expectedValue,
    edgePercentagePoints: selected.edgePercentagePoints,
    grade: selected.grade,
  };
}

function expectedPrediction(
  payload: NflForwardEvidencePayload,
  record: TrackingRow,
): { pick: string; displayLabel: string; side: TrackingRow["side"]; line: number | null; probability: number } {
  const away = payload.game.away.abbreviation;
  const home = payload.game.home.abbreviation;
  const forecast = payload.outcomeForecast;
  if (record.market === "moneyline") {
    const homeSide = forecast.homeWinProbability >= forecast.awayWinProbability;
    return {
      pick: homeSide ? home : away,
      displayLabel: homeSide ? home : away,
      side: homeSide ? "home" : "away",
      line: null,
      probability: homeSide ? forecast.homeWinProbability : forecast.awayWinProbability,
    };
  }
  if (record.line_value === null) throw new Error(`NFL ${record.id} ${record.market} has no locked line.`);
  if (record.market === "total") {
    const probabilities = nflV1WeekOneLineProbabilities({
      forecast,
      homeSpread: 0,
      totalLine: record.line_value,
    }).total;
    const over = probabilities.overProbability >= probabilities.underProbability;
    return {
      pick: `${over ? "Over" : "Under"} ${record.line_value}`,
      displayLabel: `${over ? "Over" : "Under"} ${record.line_value}`,
      side: over ? "over" : "under",
      line: record.line_value,
      probability: over ? probabilities.overProbability : probabilities.underProbability,
    };
  }
  const recordedHomeSpread = record.side === "home" ? record.line_value : -record.line_value;
  const probabilities = nflV1WeekOneLineProbabilities({
    forecast,
    homeSpread: recordedHomeSpread,
    totalLine: 0,
  }).spread;
  const homeSide = probabilities.homeCoverProbability >= probabilities.awayCoverProbability;
  const line = homeSide ? recordedHomeSpread : -recordedHomeSpread;
  return {
    pick: homeSide ? home : away,
    displayLabel: `${homeSide ? home : away} ${line > 0 ? "+" : ""}${line}`,
    side: homeSide ? "home" : "away",
    line,
    probability: homeSide ? probabilities.homeCoverProbability : probabilities.awayCoverProbability,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
  if (unknownArgs.length > 0) throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  const { data: recordsData, error: recordsError } = await supabase
    .from("prediction_records")
    .select("*,prediction_grades(result)")
    .eq("sport", "nfl")
    .not("locked_at", "is", null)
    .in("market", ["moneyline", "spread", "total"])
    .order("slate_date", { ascending: true })
    .order("id", { ascending: true });
  if (recordsError) throw new Error(`NFL tracking read failed: ${recordsError.message}`);
  const records = ((recordsData ?? []) as unknown as TrackingRow[])
    .filter((record) => record.model_version !== NFL_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION);
  const hashes = [...new Set(records.flatMap((record) => {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    return typeof hash === "string" ? [hash] : [];
  }))];
  const evidence: EvidenceRow[] = [];
  for (let index = 0; index < hashes.length; index += 100) {
    const { data, error } = await supabase
      .from("nfl_forward_evidence_snapshots")
      .select("payload_sha256,payload")
      .in("payload_sha256", hashes.slice(index, index + 100));
    if (error) throw new Error(`NFL evidence read failed: ${error.message}`);
    evidence.push(...((data ?? []) as unknown as EvidenceRow[]));
  }
  const evidenceByHash = new Map(evidence.map((row) => {
    if (hashNflForwardEvidencePayload(row.payload) !== row.payload_sha256) {
      throw new Error(`NFL evidence checksum mismatch for ${row.payload_sha256}.`);
    }
    if (row.payload.stage !== "t60") throw new Error(`NFL evidence ${row.payload_sha256} is not T-60.`);
    return [row.payload_sha256, row.payload] as const;
  }));
  const rows = records.map((record) => {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    const payload = typeof hash === "string" ? evidenceByHash.get(hash) : undefined;
    if (!payload) return { id: record.id, missingEvidence: true, record };
    const expected = expectedPrediction(payload, record);
    const correctedEvaluation = record.market === "moneyline" ? correctedMoneyline(payload) : null;
    return {
      id: record.id,
      missingEvidence: false,
      slateDate: record.slate_date,
      matchup: record.matchup,
      market: record.market,
      tracked: { pick: record.pick, side: record.side, line: record.line_value, probability: record.model_probability },
      published: expected,
      result: one(record.prediction_grades)?.result ?? null,
      grade: record.play_grade,
      noBet: record.no_bet,
      evidenceSha256: hash,
      correctedEvaluation,
      coherent: record.side === expected.side && record.pick === expected.pick && record.line_value === expected.line &&
        record.model_probability !== null && Math.abs(record.model_probability - expected.probability) <= 0.0000006,
    };
  });
  const comparable = rows.filter((row) => !row.missingEvidence && "coherent" in row);
  const mismatches = comparable.filter((row) => row.coherent === false);
  const moneylineRows = comparable.filter((row) => row.market === "moneyline");
  const actionable = (grade: string | null | undefined) => grade === "best_angle" || grade === "lean" || grade === "Best Angle" || grade === "Lean";
  let repair: Record<string, unknown> | null = null;
  if (apply) {
    if (records.length !== 45 || comparable.length !== 45 || mismatches.length !== 6 ||
        rows.some((row) => row.missingEvidence) || mismatches.some((row) => row.market !== "moneyline")) {
      throw new Error("Refusing NFL correction: expected the checksum-verified 45-row / six-moneyline incident boundary.");
    }
    const candidates = mismatches.map((row) => {
      const record = records.find((candidate) => candidate.id === row.id);
      const payload = evidenceByHash.get(row.evidenceSha256 as string);
      if (!record || !payload) throw new Error(`NFL correction substrate disappeared for record ${row.id}.`);
      return buildNflPublishedMoneylineTrackingCorrection({ source: record, payload });
    });
    const { data: existingData, error: existingError } = await supabase
      .from("prediction_records")
      .select("id,game_id,market,slate_date,pick,side,model_version,snapshot_json")
      .eq("sport", "nfl")
      .eq("model_version", NFL_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION);
    if (existingError) throw new Error(`NFL correction idempotency read failed: ${existingError.message}`);
    const existing = (existingData ?? []) as Array<{
      id: number; game_id: number; market: string; slate_date: string; pick: string; side: string;
      model_version: string; snapshot_json: Record<string, unknown> | null;
    }>;
    for (const row of existing) {
      if (row.snapshot_json?.tracking_correction_release !== NFL_PUBLISHED_TRACKING_CORRECTION_RELEASE) {
        throw new Error(`NFL correction row ${row.id} has an unexpected release marker.`);
      }
    }
    const existingByKey = new Map(existing.map((row) => [`${row.game_id}:${row.market}:${row.slate_date}`, row]));
    const missing = candidates.filter((candidate) => {
      const prior = existingByKey.get(`${candidate.game_id}:${candidate.market}:${candidate.slate_date}`);
      if (!prior) return true;
      if (prior.pick !== candidate.pick || prior.side !== candidate.side ||
          prior.snapshot_json?.supersedes_prediction_record_id !== candidate.snapshot_json?.supersedes_prediction_record_id) {
        throw new Error(`Existing NFL correction for ${candidate.matchup} is not identical to the audited candidate.`);
      }
      return false;
    });
    let inserted: Array<{ id: number; game_id: number; slate_date: string }> = [];
    if (missing.length > 0) {
      const { data, error } = await supabase
        .from("prediction_records")
        .insert(missing)
        .select("id,game_id,slate_date");
      if (error) throw new Error(`NFL append-only correction insert failed: ${error.message}`);
      inserted = (data ?? []) as Array<{ id: number; game_id: number; slate_date: string }>;
      if (inserted.length !== missing.length) throw new Error("NFL correction insert returned an incomplete row set.");
    }
    const grading = [];
    for (const slateDate of [...new Set(candidates.map((candidate) => candidate.slate_date))]) {
      const result = await gradePredictionsForSlate({
        sport: "nfl",
        slateDate,
        apply: true,
        supabase,
        source: "manual_operator",
      });
      if (result.errors.length > 0) throw new Error(`NFL correction grading failed: ${JSON.stringify(result.errors)}`);
      grading.push(result);
    }
    const sourceIds = candidates.map((candidate) => candidate.snapshot_json?.supersedes_prediction_record_id as number);
    const { data: sourceAfter, error: sourceAfterError } = await supabase
      .from("prediction_records")
      .select("id,pick,side,model_probability,play_grade,no_bet,locked_at,snapshot_json")
      .in("id", sourceIds);
    if (sourceAfterError) throw new Error(`NFL original-row verification failed: ${sourceAfterError.message}`);
    for (const before of records.filter((record) => sourceIds.includes(record.id))) {
      const after = (sourceAfter ?? []).find((candidate) => candidate.id === before.id) as Record<string, unknown> | undefined;
      for (const field of ["pick", "side", "model_probability", "play_grade", "no_bet", "locked_at", "snapshot_json"] as const) {
        if (JSON.stringify(after?.[field]) !== JSON.stringify(before[field])) {
          throw new Error(`Original NFL record ${before.id} changed at ${field}; correction is not append-only.`);
        }
      }
    }
    repair = { release: NFL_PUBLISHED_TRACKING_CORRECTION_RELEASE, candidates: candidates.length, inserted: inserted.length, grading };
  }
  console.log(JSON.stringify({
    release: "nfl_published_tracking_coherence_audit_2026_09_14_r1",
    records: records.length,
    evidenceMatched: comparable.length,
    missingEvidence: rows.filter((row) => row.missingEvidence).length,
    byMarket: Object.fromEntries(["moneyline", "spread", "total"].map((market) => [market, {
      records: comparable.filter((row) => row.market === market).length,
      mismatches: mismatches.filter((row) => row.market === market).length,
    }])),
    moneylineBoardImpact: {
      oldActionable: moneylineRows.filter((row) => actionable(row.grade)).length,
      correctedActionable: moneylineRows.filter((row) => actionable(row.correctedEvaluation?.grade)).length,
      promotions: moneylineRows.filter((row) => !actionable(row.grade) && actionable(row.correctedEvaluation?.grade)).length,
      demotions: moneylineRows.filter((row) => actionable(row.grade) && !actionable(row.correctedEvaluation?.grade)).length,
    },
    repair,
    mismatches,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
