/** SELECT-only inventory of the exact NFL evidence locked with published predictions. */

import { supabase } from "@/lib/db/supabase";
import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "@/lib/services/football/nflForwardEvidence";

type Market = "moneyline" | "spread" | "total";
type Grade = {
  result: "win" | "loss" | "push" | "void" | "pending";
  actual_home_score: number | null;
  actual_away_score: number | null;
};
type RecordRow = {
  id: number;
  model_version: string;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};
type EvidenceRow = { payload_sha256: string; payload: NflForwardEvidencePayload };

const MARKETS: Market[] = ["moneyline", "spread", "total"];

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function boolCount(values: boolean[]): { count: number; rate: number | null } {
  const count = values.filter(Boolean).length;
  return { count, rate: values.length ? count / values.length : null };
}

function completeMarket(payload: NflForwardEvidencePayload, market: Market): boolean {
  return payload.market.current[market] !== null;
}

function openingMarket(payload: NflForwardEvidencePayload, market: Market): boolean {
  return payload.market.operationalOpening.quote[market] !== null;
}

function splitComplete(payload: NflForwardEvidencePayload, source: "playbook" | "sharpApi", market: Market): boolean {
  const row = source === "playbook"
    ? payload.market.playbookSplits?.[market]
    : payload.market.sharpApiSplits?.[market];
  if (!row) return false;
  return market === "total"
    ? [row.overMoneyPct, row.underMoneyPct, row.overBetsPct, row.underBetsPct].every(Number.isFinite)
    : [row.homeMoneyPct, row.awayMoneyPct, row.homeBetsPct, row.awayBetsPct].every(Number.isFinite);
}

function summarize(items: Array<{ payload: NflForwardEvidencePayload; release: string; settled: boolean }>) {
  const games = items.length;
  const marketCoverage = Object.fromEntries(MARKETS.map((market) => [market, {
    current: boolCount(items.map(({ payload }) => completeMarket(payload, market))),
    opening: boolCount(items.map(({ payload }) => openingMarket(payload, market))),
    playbookSplits: boolCount(items.map(({ payload }) => splitComplete(payload, "playbook", market))),
    sharpApiSplits: boolCount(items.map(({ payload }) => splitComplete(payload, "sharpApi", market))),
    contextCapture: boolCount(items.map(({ payload }) => Boolean(payload.contextualEvidenceCapture?.markets[market]))),
    chronology: boolCount(items.map(({ payload }) =>
      (payload.contextualEvidenceCapture?.markets[market].coverage.chronologyPairsRetained ?? 0) > 0)),
    circaChronology: boolCount(items.map(({ payload }) => {
      const family = payload.contextualEvidenceCapture?.markets[market].families.find((row) => row[0] === "circa");
      return Boolean(family?.[4] && family[4][0] < family[5][0]);
    })),
    pinnacleChronology: boolCount(items.map(({ payload }) => {
      const family = payload.contextualEvidenceCapture?.markets[market].families.find((row) => row[0] === "pinnacle");
      return Boolean(family?.[4] && family[4][0] < family[5][0]);
    })),
  }]));
  const comparableCounts = items.map(({ payload }) => payload.market.comparableCurrentBooks.length);
  const t60Lags = items.flatMap(({ payload }) => Number.isFinite(payload.t60LagMinutes)
    ? [payload.t60LagMinutes as number]
    : []);
  return {
    games,
    settled: items.filter((item) => item.settled).length,
    stages: Object.fromEntries([...new Set(items.map(({ payload }) => payload.stage))].sort().map((stage) => [
      stage,
      items.filter(({ payload }) => payload.stage === stage).length,
    ])),
    captureTiming: Object.fromEntries([...new Set(items.map(({ payload }) => payload.captureTiming))].sort().map((timing) => [
      timing,
      items.filter(({ payload }) => payload.captureTiming === timing).length,
    ])),
    t60LagMinutes: t60Lags.length ? {
      min: Math.min(...t60Lags),
      median: [...t60Lags].sort((a, b) => a - b)[Math.floor(t60Lags.length / 2)],
      max: Math.max(...t60Lags),
    } : null,
    comparableCurrentBooks: comparableCounts.length ? {
      min: Math.min(...comparableCounts),
      median: [...comparableCounts].sort((a, b) => a - b)[Math.floor(comparableCounts.length / 2)],
      max: Math.max(...comparableCounts),
    } : null,
    paidIndependentProjection: boolCount(items.map(({ payload }) => Boolean(payload.paidProjectionShadow))),
    providerOpening: boolCount(items.map(({ payload }) => Boolean(payload.market.providerOpening))),
    operationalOpening: boolCount(items.map(({ payload }) => Boolean(payload.market.operationalOpening))),
    marketCoverage,
    collectorReleases: [...new Set(items.map(({ payload }) => payload.collectorRelease))].sort(),
    contextCaptureReleases: [...new Set(items.flatMap(({ payload }) =>
      payload.contextualEvidenceCapture ? [payload.contextualEvidenceCapture.release] : []))].sort(),
    decisionReleases: [...new Set(items.map(({ release }) => release))].sort(),
  };
}

async function main() {
  const recordRead = await supabase.from("prediction_records")
    .select("id,model_version,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "nfl")
    .not("locked_at", "is", null)
    .in("market", MARKETS)
    .order("id", { ascending: true });
  if (recordRead.error) throw new Error(recordRead.error.message);
  const all = (recordRead.data ?? []) as unknown as RecordRow[];
  const originals = all.filter((row) => typeof row.snapshot_json?.supersedes_prediction_record_id !== "number");
  const byHashRecords = new Map<string, RecordRow[]>();
  for (const record of originals) {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    if (typeof hash !== "string") throw new Error(`NFL record ${record.id} has no evidence hash.`);
    byHashRecords.set(hash, [...(byHashRecords.get(hash) ?? []), record]);
  }
  const hashes = [...byHashRecords.keys()];
  const evidence: EvidenceRow[] = [];
  for (let index = 0; index < hashes.length; index += 100) {
    const read = await supabase.from("nfl_forward_evidence_snapshots")
      .select("payload_sha256,payload")
      .in("payload_sha256", hashes.slice(index, index + 100));
    if (read.error) throw new Error(read.error.message);
    evidence.push(...((read.data ?? []) as unknown as EvidenceRow[]));
  }
  const items = evidence.map((row) => {
    if (hashNflForwardEvidencePayload(row.payload) !== row.payload_sha256) {
      throw new Error(`Evidence checksum mismatch ${row.payload_sha256}.`);
    }
    const records = byHashRecords.get(row.payload_sha256) ?? [];
    if (records.length !== 3) throw new Error(`Expected three original records for ${row.payload_sha256}; got ${records.length}.`);
    return {
      payload: row.payload,
      release: records[0]!.model_version,
      settled: records.every((record) => {
        const grade = one(record.prediction_grades);
        return grade?.result === "win" || grade?.result === "loss" || grade?.result === "push";
      }),
    };
  }).sort((a, b) => a.payload.week - b.payload.week || a.payload.game.scheduledStart.localeCompare(b.payload.game.scheduledStart));
  if (items.length !== hashes.length) throw new Error(`Missing ${hashes.length - items.length} evidence payloads.`);
  const weeks = [...new Set(items.map(({ payload }) => payload.week))].sort((a, b) => a - b);
  const releases = [...new Set(items.map(({ release }) => release))].sort();
  console.log(JSON.stringify({
    release: "nfl_2026_locked_market_reading_coverage_audit_r1",
    readOnly: true,
    writes: 0,
    correctionRecordsExcluded: all.length - originals.length,
    checksumValidatedPayloads: items.length,
    overall: summarize(items),
    byWeek: Object.fromEntries(weeks.map((week) => [week, summarize(items.filter(({ payload }) => payload.week === week))])),
    byDecisionRelease: Object.fromEntries(releases.map((release) => [release, summarize(items.filter((item) => item.release === release))])),
    games: items.map(({ payload, release, settled }) => ({
      week: payload.week,
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      scheduledStart: payload.game.scheduledStart,
      capturedAt: payload.capturedAt,
      stage: payload.stage,
      captureTiming: payload.captureTiming,
      t60LagMinutes: payload.t60LagMinutes,
      decisionRelease: release,
      paidIndependentProjection: Boolean(payload.paidProjectionShadow),
      settled,
      marketCoverage: Object.fromEntries(MARKETS.map((market) => [market, {
        current: completeMarket(payload, market),
        opening: openingMarket(payload, market),
        playbookSplits: splitComplete(payload, "playbook", market),
        sharpApiSplits: splitComplete(payload, "sharpApi", market),
        chronologyPairs: payload.contextualEvidenceCapture?.markets[market].coverage.chronologyPairsRetained ?? 0,
        retainedFamilies: payload.contextualEvidenceCapture?.markets[market].families.map((row) => row[0]) ?? [],
      }])),
    })),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
