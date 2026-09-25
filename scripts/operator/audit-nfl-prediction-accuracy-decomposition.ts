/** Read-only release-pure NFL forecast accuracy and score-error decomposition. */

import { supabase } from "@/lib/db/supabase";
import { hashNflForwardEvidencePayload, type NflForwardEvidencePayload } from "@/lib/services/football/nflForwardEvidence";
import { nflV1WeekOneLineProbabilities } from "@/lib/services/football/nflV1WeekOneOutcome";

type Grade = {
  result: "win" | "loss" | "push" | "void" | "pending";
  actual_home_score: number | null;
  actual_away_score: number | null;
};

type RecordRow = {
  id: number;
  slate_date: string;
  matchup: string;
  market: "moneyline" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  line_value: number | null;
  model_version: string;
  calibration_version: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};

type EvidenceRow = { payload_sha256: string; payload: NflForwardEvidencePayload };

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function expectedSide(payload: NflForwardEvidencePayload, record: RecordRow): RecordRow["side"] {
  const forecast = payload.outcomeForecast;
  if (record.market === "moneyline") {
    return forecast.homeWinProbability >= forecast.awayWinProbability ? "home" : "away";
  }
  if (record.line_value === null) throw new Error(`NFL ${record.id} has no line.`);
  if (record.market === "total") {
    const value = nflV1WeekOneLineProbabilities({ forecast, homeSpread: 0, totalLine: record.line_value }).total;
    return value.overProbability >= value.underProbability ? "over" : "under";
  }
  const homeLine = record.side === "home" ? record.line_value : -record.line_value;
  const value = nflV1WeekOneLineProbabilities({ forecast, homeSpread: homeLine, totalLine: 0 }).spread;
  return value.homeCoverProbability >= value.awayCoverProbability ? "home" : "away";
}

function correctedResult(result: Grade["result"], sideMatches: boolean): Grade["result"] {
  if (sideMatches || result === "push" || result === "void" || result === "pending") return result;
  return result === "win" ? "loss" : "win";
}

function summary(rows: Array<{ result: Grade["result"] }>) {
  const resolved = rows.filter((row) => row.result === "win" || row.result === "loss");
  const wins = resolved.filter((row) => row.result === "win").length;
  return {
    rows: rows.length,
    resolved: resolved.length,
    wins,
    losses: resolved.length - wins,
    pushes: rows.filter((row) => row.result === "push").length,
    accuracy: resolved.length ? wins / resolved.length : null,
  };
}

async function main() {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id,slate_date,matchup,market,side,line_value,model_version,calibration_version,snapshot_json,prediction_grades(*)")
    .eq("sport", "nfl")
    .not("locked_at", "is", null)
    .in("market", ["moneyline", "spread", "total"])
    .order("slate_date", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`NFL tracking read failed: ${error.message}`);
  const records = (data ?? []) as unknown as RecordRow[];
  const originals = records.filter((record) => typeof record.snapshot_json?.supersedes_prediction_record_id !== "number");
  const hashes = [...new Set(originals.flatMap((record) => {
    const value = record.snapshot_json?.evidence_payload_sha256;
    return typeof value === "string" ? [value] : [];
  }))];
  const evidence: EvidenceRow[] = [];
  for (let index = 0; index < hashes.length; index += 100) {
    const read = await supabase.from("nfl_forward_evidence_snapshots").select("payload_sha256,payload").in("payload_sha256", hashes.slice(index, index + 100));
    if (read.error) throw new Error(`NFL evidence read failed: ${read.error.message}`);
    evidence.push(...((read.data ?? []) as unknown as EvidenceRow[]));
  }
  const byHash = new Map(evidence.map((row) => {
    if (hashNflForwardEvidencePayload(row.payload) !== row.payload_sha256) throw new Error(`Evidence checksum mismatch ${row.payload_sha256}.`);
    return [row.payload_sha256, row.payload] as const;
  }));
  const rows = originals.map((record) => {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    const payload = typeof hash === "string" ? byHash.get(hash) : undefined;
    const grade = one(record.prediction_grades);
    if (!payload || !grade) throw new Error(`NFL record ${record.id} lacks evidence or grade.`);
    const publishedSide = expectedSide(payload, record);
    const result = correctedResult(grade.result, record.side === publishedSide);
    const actualHome = grade.actual_home_score;
    const actualAway = grade.actual_away_score;
    const forecast = payload.outcomeForecast;
    return {
      id: record.id,
      slateDate: record.slate_date,
      matchup: record.matchup,
      market: record.market,
      result,
      sideChanged: record.side !== publishedSide,
      modelVersion: record.model_version,
      calibrationVersion: record.calibration_version,
      expectedHome: forecast.expectedHomeScore,
      expectedAway: forecast.expectedAwayScore,
      actualHome,
      actualAway,
      marginError: actualHome === null || actualAway === null ? null : forecast.expectedHomeScore - forecast.expectedAwayScore - (actualHome - actualAway),
      totalError: actualHome === null || actualAway === null ? null : forecast.expectedHomeScore + forecast.expectedAwayScore - actualHome - actualAway,
    };
  });
  const games = [...new Map(rows.map((row) => [`${row.slateDate}:${row.matchup}`, row])).values()];
  const finite = (values: Array<number | null>) => values.filter((value): value is number => value !== null && Number.isFinite(value));
  const mae = (values: number[]) => values.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(values.length, 1);
  console.log(JSON.stringify({
    readOnly: true,
    originalRecords: originals.length,
    correctionRecordsExcluded: records.length - originals.length,
    games: games.length,
    sideCorrections: rows.filter((row) => row.sideChanged).length,
    overall: Object.fromEntries(["moneyline", "spread", "total"].map((market) => [market, summary(rows.filter((row) => row.market === market))])),
    bySlateDate: Object.fromEntries([...new Set(rows.map((row) => row.slateDate))].map((date) => [date, Object.fromEntries(["moneyline", "spread", "total"].map((market) => [market, summary(rows.filter((row) => row.slateDate === date && row.market === market))]))])),
    byRelease: Object.fromEntries([...new Set(rows.map((row) => row.modelVersion))].map((release) => [release, Object.fromEntries(["moneyline", "spread", "total"].map((market) => [market, summary(rows.filter((row) => row.modelVersion === release && row.market === market))]))])),
    scoreError: {
      games: games.length,
      marginMae: mae(finite(games.map((row) => row.marginError))),
      totalMae: mae(finite(games.map((row) => row.totalError))),
      marginBias: finite(games.map((row) => row.marginError)).reduce((sum, value) => sum + value, 0) / Math.max(games.length, 1),
      totalBias: finite(games.map((row) => row.totalError)).reduce((sum, value) => sum + value, 0) / Math.max(games.length, 1),
    },
    releases: [...new Set(rows.map((row) => `${row.modelVersion}|${row.calibrationVersion ?? ""}`))],
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
