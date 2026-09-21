/**
 * SELECT-only replay of the frozen NFL opening-to-T60 Spread direction rule.
 * No prediction, grade, tracking, snapshot, or provider state is written.
 */

import { createClient } from "@supabase/supabase-js";
import { hashNflForwardEvidencePayload, type NflForwardEvidencePayload } from "../../lib/services/football/nflForwardEvidence";

type Grade = { result: string | null };
type RecordRow = {
  external_id: number | null;
  slate_date: string;
  matchup: string;
  side: string | null;
  model_probability: number | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};

function median(values: number[]): number | null {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle]! : (rows[middle - 1]! + rows[middle]!) / 2;
}

function fair(first: number, second: number): number {
  const implied = (price: number) => price > 0 ? 100 / (price + 100) : -price / (-price + 100);
  const a = implied(first);
  const b = implied(second);
  return a / (a + b);
}

function grade(row: RecordRow): Grade | null {
  return Array.isArray(row.prediction_grades) ? row.prediction_grades[0] ?? null : row.prediction_grades;
}

function summary(rows: Array<{ correct: boolean }>) {
  const wins = rows.filter((row) => row.correct).length;
  return { resolved: rows.length, wins, losses: rows.length - wins, accuracy: rows.length ? wins / rows.length : null };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data: records, error } = await client.from("prediction_records")
    .select("external_id,slate_date,matchup,side,model_probability,snapshot_json,prediction_grades(result)")
    .eq("sport", "nfl")
    .eq("market", "spread")
    .not("locked_at", "is", null)
    .order("slate_date", { ascending: true })
    .limit(500);
  if (error) throw new Error(`NFL locked Spread read failed: ${error.message}`);
  const typed = (records ?? []) as unknown as RecordRow[];
  const hashes = [...new Set(typed.flatMap((row) => {
    const value = row.snapshot_json?.evidence_payload_sha256;
    return typeof value === "string" ? [value] : [];
  }))];
  if (!hashes.length) throw new Error("No locked NFL evidence hashes were found.");
  const { data: evidence, error: evidenceError } = await client.from("nfl_forward_evidence_snapshots")
    .select("payload_sha256,payload")
    .in("payload_sha256", hashes)
    .limit(500);
  if (evidenceError) throw new Error(`NFL evidence read failed: ${evidenceError.message}`);
  const byHash = new Map<string, NflForwardEvidencePayload>();
  for (const row of evidence ?? []) {
    const payload = row.payload as NflForwardEvidencePayload;
    if (hashNflForwardEvidencePayload(payload) !== row.payload_sha256) {
      throw new Error(`NFL evidence checksum mismatch: ${row.payload_sha256}`);
    }
    byHash.set(row.payload_sha256, payload);
  }

  const seen = new Set<string>();
  const rows = typed.flatMap((record) => {
    const result = grade(record)?.result;
    if (result !== "win" && result !== "loss" && result !== "push") return [];
    const hash = record.snapshot_json?.evidence_payload_sha256;
    if (typeof hash !== "string") return [];
    const payload = byHash.get(hash);
    if (!payload) return [];
    const identity = `${record.external_id ?? record.matchup}:${hash}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const books = payload.market.comparableCurrentBooks.filter((book) => book.spread !== null);
    const currentHomeLine = median(books.map((book) => book.spread!.homeLine));
    const openingHomeLine = payload.market.operationalOpening.quote.spread?.homeLine ?? null;
    if (currentHomeLine === null || openingHomeLine === null) return [];
    const homeFairs = books.map((book) => fair(book.spread!.homePrice, book.spread!.awayPrice));
    const homeFairProbability = median(homeFairs);
    if (homeFairProbability === null) return [];
    const reason = currentHomeLine <= openingHomeLine - 0.5
      ? "move_home" as const
      : currentHomeLine >= openingHomeLine + 0.5
        ? "move_away" as const
        : "flat_price" as const;
    const candidateHome = reason === "move_home" || reason === "flat_price" && homeFairProbability >= 0.5;
    const actualHome = result === "push" ? null : record.side === "home" ? result === "win" : result === "loss";
    const incumbentHomeProbability = record.model_probability === null || record.side === null
      ? null
      : record.side === "home" ? record.model_probability : 1 - record.model_probability;
    const candidateHomeProbability = incumbentHomeProbability === null
      ? null
      : candidateHome ? 0.5 + Math.abs(incumbentHomeProbability - 0.5) : 0.5 - Math.abs(incumbentHomeProbability - 0.5);
    return [{
      season: payload.season,
      week: payload.week,
      date: record.slate_date,
      matchup: record.matchup,
      reason,
      openingHomeLine,
      currentHomeLine,
      books: books.length,
      actualHome,
      candidateHome,
      correct: actualHome === null ? null : candidateHome === actualHome,
      incumbentHomeProbability,
      candidateHomeProbability,
    }];
  });
  const resolved = rows.filter((row): row is typeof row & { actualHome: boolean; correct: boolean; incumbentHomeProbability: number; candidateHomeProbability: number } =>
    row.actualHome !== null && row.correct !== null && row.incumbentHomeProbability !== null && row.candidateHomeProbability !== null);
  const brier = (key: "incumbentHomeProbability" | "candidateHomeProbability") =>
    resolved.reduce((sum, row) => sum + (row[key] - Number(row.actualHome)) ** 2, 0) / resolved.length;
  const byReason = Object.fromEntries(["move_home", "move_away", "flat_price"].map((reason) => [
    reason,
    summary(resolved.filter((row) => row.reason === reason)),
  ]));
  const byWeek = Object.fromEntries([...new Set(resolved.map((row) => row.week))].sort((a, b) => a - b).map((week) => [
    String(week),
    summary(resolved.filter((row) => row.week === week)),
  ]));
  console.log(JSON.stringify({
    auditRelease: "nfl_t60_spread_direction_readonly_2026_09_21_r1",
    readOnly: true,
    recordsRead: typed.length,
    evidenceMatched: byHash.size,
    pushes: rows.filter((row) => row.actualHome === null).length,
    pooled: summary(resolved),
    brier: { incumbent: brier("incumbentHomeProbability"), candidate: brier("candidateHomeProbability") },
    byReason,
    byWeek,
    ...(process.argv.includes("--details") ? { rows } : {}),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

