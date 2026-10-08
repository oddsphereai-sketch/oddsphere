#!/usr/bin/env tsx

/** SELECT-only replay of immutable CFB independent -> authoritative predictions. */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

type Json = Record<string, unknown>;
type Market = "moneyline" | "spread" | "total";
type Side = "home" | "away" | "over" | "under";
type Result = "win" | "loss" | "push";
type Block = "development" | "confirmation" | "holdout";
type Forecast = { expectedAwayPoints: number; expectedHomePoints: number; expectedMarginHome: number; expectedTotal: number };
type PredictionRow = {
  id: number; external_id: number; slate_date: string; market: string; side: string | null;
  line_value: number | null; play_grade: string | null; no_bet: boolean | null;
  locked_at: string; model_version: string | null; snapshot_json: Json | null;
};
type FinalGame = { external_id: string | number; status: string | null; away_score: number | null; home_score: number | null };
type ContextRow = { payload_sha256: string; captured_at: string; markets: Json | null };
type AuditRow = {
  gameId: string; date: string; block: Block; release: string; market: Market;
  independentSide: Side; authoritativeSide: Side; independentResult: Result; authoritativeResult: Result;
  changed: boolean; correction: boolean; harm: boolean;
  independentAxisError: number; authoritativeAxisError: number;
  independentTeamScoreMae: number; authoritativeTeamScoreMae: number;
  grade: string; actionable: boolean; splitState: string;
};

const MARKETS: Market[] = ["moneyline", "spread", "total"];
const PAGE = 500;
const CURRENT_SPLIT_MINUTES = 120;

function object(value: unknown): Json { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function forecast(value: unknown): Forecast | null {
  const row = object(value);
  const expectedAwayPoints = number(row.expectedAwayPoints);
  const expectedHomePoints = number(row.expectedHomePoints);
  const expectedMarginHome = number(row.expectedMarginHome);
  const expectedTotal = number(row.expectedTotal);
  return [expectedAwayPoints, expectedHomePoints, expectedMarginHome, expectedTotal].every((item) => item !== null)
    ? { expectedAwayPoints: expectedAwayPoints!, expectedHomePoints: expectedHomePoints!, expectedMarginHome: expectedMarginHome!, expectedTotal: expectedTotal! }
    : null;
}
function isFinal(value: FinalGame | undefined): value is FinalGame {
  return Boolean(value && ["final", "completed", "post"].includes(value.status?.trim().toLowerCase() ?? "") &&
    Number.isFinite(value.away_score) && Number.isFinite(value.home_score));
}
function blockFor(date: string): Block {
  if (date <= "2026-09-27") return "development";
  if (date <= "2026-10-04") return "confirmation";
  return "holdout";
}
function normalizedGrade(value: string | null): string {
  const grade = (value ?? "held").trim().toLowerCase().replace(/[_-]+/g, " ");
  return grade === "best angle" ? "Best Angle" : grade === "lean" ? "Lean" : grade === "watchlist" ? "Watchlist" : grade === "no play" ? "No Play" : "Held";
}

async function readPredictions(client: SupabaseClient): Promise<PredictionRow[]> {
  const rows: PredictionRow[] = [];
  for (let from = 0; from < 10_000; from += PAGE) {
    const { data, error } = await client.from("prediction_records")
      .select("id,external_id,slate_date,market,side,line_value,play_grade,no_bet,locked_at,model_version,snapshot_json")
      .eq("sport", "cfb").gte("slate_date", "2026-08-01").not("locked_at", "is", null)
      .order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`CFB prediction read failed: ${error.message}`);
    const page = (data ?? []) as PredictionRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
  throw new Error("CFB prediction audit exceeded 10,000 rows.");
}

async function readResults(client: SupabaseClient, ids: number[]): Promise<Map<string, FinalGame>> {
  const output = new Map<string, FinalGame>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await client.from("games").select("external_id,status,away_score,home_score")
      .eq("sport", "cfb").in("external_id", ids.slice(index, index + 150));
    if (error) throw new Error(`CFB result read failed: ${error.message}`);
    for (const row of (data ?? []) as FinalGame[]) output.set(String(row.external_id), row);
  }
  return output;
}

async function readContexts(client: SupabaseClient, hashes: string[]): Promise<Map<string, ContextRow>> {
  const output = new Map<string, ContextRow>();
  for (let index = 0; index < hashes.length; index += 100) {
    const { data, error } = await client.from("cfb_forward_evidence_snapshots")
      .select("payload_sha256,captured_at,markets:payload->contextualEvidenceCapture->markets")
      .in("payload_sha256", hashes.slice(index, index + 100));
    if (error) throw new Error(`CFB context read failed: ${error.message}`);
    for (const row of (data ?? []) as unknown as ContextRow[]) output.set(row.payload_sha256, row);
  }
  return output;
}

function settle(market: Market, side: Side, line: number | null, awayScore: number, homeScore: number): Result {
  if (market === "moneyline") return (homeScore > awayScore ? "home" : "away") === side ? "win" : "loss";
  if (line === null) return "push";
  const value = market === "spread"
    ? (side === "home" ? homeScore - awayScore + line : awayScore - homeScore + line)
    : awayScore + homeScore - line;
  if (Math.abs(value) < 1e-9) return "push";
  if (market === "spread") return value > 0 ? "win" : "loss";
  return (value > 0 ? "over" : "under") === side ? "win" : "loss";
}

function independentSide(market: Market, line: number | null, finalSide: Side, independent: Forecast): Side {
  if (market === "moneyline") return independent.expectedMarginHome >= 0 ? "home" : "away";
  if (market === "total") return independent.expectedTotal >= line! ? "over" : "under";
  const homeSpread = finalSide === "home" ? line! : -line!;
  return independent.expectedMarginHome + homeSpread >= 0 ? "home" : "away";
}

function splitTimestamp(value: unknown): string | null {
  const row = array(value);
  return row[0] === "p" ? text(row[1]) : row[0] === "s" ? text(row[4]) : null;
}

function splitState(context: ContextRow | undefined, market: Market): string {
  if (!context?.markets) return "capture_absent";
  const row = object(context.markets[market]);
  const sharp = array(row.sharp);
  const publicSplit = array(row.public);
  const age = (timestamp: string | null) => timestamp ? (Date.parse(context.captured_at) - Date.parse(timestamp)) / 60_000 : null;
  const sharpAge = age(splitTimestamp(sharp));
  const publicAge = age(splitTimestamp(publicSplit));
  const sharpBook = text(sharp[1])?.toLowerCase() ?? null;
  const namedSharp = sharpBook !== null && ["circa", "pinnacle", "bookmaker"].includes(sharpBook);
  const sharpCurrent = sharpAge !== null && sharpAge >= 0 && sharpAge <= CURRENT_SPLIT_MINUTES;
  const publicCurrent = publicAge !== null && publicAge >= 0 && publicAge <= CURRENT_SPLIT_MINUTES;
  if (sharpCurrent && namedSharp && publicCurrent) return "current_named_sharp_and_public";
  if (sharpCurrent && namedSharp) return "current_named_sharp_only";
  if (sharpCurrent && publicCurrent) return "current_fallback_sharp_and_public";
  if (sharpCurrent) return "current_fallback_sharp_only";
  if (publicCurrent) return "current_public_only";
  if (sharp.length || publicSplit.length) return "stale_splits";
  return "splits_absent";
}

function metrics(rows: AuditRow[]) {
  const independentResolved = rows.filter((row) => row.independentResult !== "push");
  const authoritativeResolved = rows.filter((row) => row.authoritativeResult !== "push");
  const changed = rows.filter((row) => row.changed);
  return {
    games: new Set(rows.map((row) => row.gameId)).size,
    dates: [...new Set(rows.map((row) => row.date))].sort(),
    independent: { wins: independentResolved.filter((row) => row.independentResult === "win").length, losses: independentResolved.filter((row) => row.independentResult === "loss").length, pushes: rows.length - independentResolved.length },
    authoritative: { wins: authoritativeResolved.filter((row) => row.authoritativeResult === "win").length, losses: authoritativeResolved.filter((row) => row.authoritativeResult === "loss").length, pushes: rows.length - authoritativeResolved.length },
    changed: changed.length,
    corrections: changed.filter((row) => row.correction).length,
    harms: changed.filter((row) => row.harm).length,
    independentAxisMae: rows.length ? rows.reduce((sum, row) => sum + row.independentAxisError, 0) / rows.length : null,
    authoritativeAxisMae: rows.length ? rows.reduce((sum, row) => sum + row.authoritativeAxisError, 0) / rows.length : null,
    independentTeamScoreMae: rows.length ? rows.reduce((sum, row) => sum + row.independentTeamScoreMae, 0) / rows.length : null,
    authoritativeTeamScoreMae: rows.length ? rows.reduce((sum, row) => sum + row.authoritativeTeamScoreMae, 0) / rows.length : null,
    actionables: rows.filter((row) => row.actionable).length,
    grades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) => [grade, rows.filter((row) => row.grade === grade).length])),
  };
}

function summarize(rows: AuditRow[]) {
  return Object.fromEntries([...new Set(rows.map((row) => row.release))].sort().map((release) => [release, Object.fromEntries(MARKETS.map((market) => {
    const selected = rows.filter((row) => row.release === release && row.market === market);
    return [market, {
      overall: metrics(selected),
      byBlock: Object.fromEntries((["development", "confirmation", "holdout"] as const).map((block) => [block, metrics(selected.filter((row) => row.block === block))])),
      bySplitState: Object.fromEntries([...new Set(selected.map((row) => row.splitState))].sort().map((state) => [state, metrics(selected.filter((row) => row.splitState === state))])),
    }];
  }))]));
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const raw = await readPredictions(client);
  const superseded = new Set(raw.flatMap((row) => {
    const value = number(object(row.snapshot_json).supersedes_prediction_record_id);
    return value === null ? [] : [value];
  }));
  const current = raw.filter((row) => !superseded.has(row.id) && MARKETS.includes(row.market as Market));
  const duplicateGroups = [...current.reduce((groups, row) => {
    const key = `${row.external_id}:${row.market}`;
    const values = groups.get(key) ?? [];
    values.push(row.id);
    groups.set(key, values);
    return groups;
  }, new Map<string, number[]>()).entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
  const results = await readResults(client, [...new Set(current.map((row) => row.external_id))]);
  const hashes = [...new Set(current.map((row) => text(object(row.snapshot_json).evidence_payload_sha256)).filter((value): value is string => value !== null))];
  const contexts = await readContexts(client, hashes);
  const rows: AuditRow[] = [];
  for (const row of current) {
    const result = results.get(String(row.external_id));
    const snapshot = object(row.snapshot_json);
    const independent = forecast(snapshot.independent_forecast);
    const authoritative = forecast(snapshot.forecast);
    const finalSide = row.side as Side | null;
    const market = row.market as Market;
    if (!isFinal(result) || !independent || !authoritative || !finalSide || (market !== "moneyline" && row.line_value === null)) continue;
    const baseSide = independentSide(market, row.line_value, finalSide, independent);
    const independentResult = settle(market, baseSide, row.line_value, result.away_score!, result.home_score!);
    const authoritativeResult = settle(market, finalSide, row.line_value, result.away_score!, result.home_score!);
    const actualAxis = market === "total" ? result.away_score! + result.home_score! : result.home_score! - result.away_score!;
    const independentAxis = market === "total" ? independent.expectedTotal : independent.expectedMarginHome;
    const authoritativeAxis = market === "total" ? authoritative.expectedTotal : authoritative.expectedMarginHome;
    const changed = baseSide !== finalSide;
    const decision = object(snapshot.decision_tuple);
    const release = text(decision.decisionRelease ?? decision.decision_release) ?? row.model_version ?? "unknown";
    const grade = normalizedGrade(row.play_grade);
    const hash = text(snapshot.evidence_payload_sha256);
    rows.push({
      gameId: String(row.external_id), date: row.slate_date, block: blockFor(row.slate_date), release, market,
      independentSide: baseSide, authoritativeSide: finalSide, independentResult, authoritativeResult, changed,
      correction: changed && authoritativeResult === "win" && independentResult === "loss",
      harm: changed && authoritativeResult === "loss" && independentResult === "win",
      independentAxisError: Math.abs(independentAxis - actualAxis), authoritativeAxisError: Math.abs(authoritativeAxis - actualAxis),
      independentTeamScoreMae: (Math.abs(independent.expectedAwayPoints - result.away_score!) + Math.abs(independent.expectedHomePoints - result.home_score!)) / 2,
      authoritativeTeamScoreMae: (Math.abs(authoritative.expectedAwayPoints - result.away_score!) + Math.abs(authoritative.expectedHomePoints - result.home_score!)) / 2,
      grade, actionable: row.no_bet !== true && (grade === "Best Angle" || grade === "Lean"),
      splitState: splitState(hash ? contexts.get(hash) : undefined, market),
    });
  }
  const summary = summarize(rows);
  const compactRows = Object.entries(summary).flatMap(([release, releaseMarkets]) =>
    Object.entries(releaseMarkets as Record<string, { overall: ReturnType<typeof metrics>; bySplitState: Record<string, ReturnType<typeof metrics>> }>).map(([market, values]) => ({
      release,
      market,
      ...values.overall,
      splitStates: Object.fromEntries(Object.entries(values.bySplitState).map(([state, stateMetrics]) => [state, {
        games: stateMetrics.games,
        independent: stateMetrics.independent,
        authoritative: stateMetrics.authoritative,
        changed: stateMetrics.changed,
        corrections: stateMetrics.corrections,
        harms: stateMetrics.harms,
      }])),
    })),
  );
  console.log(JSON.stringify({
    release: "cfb_2026_current_market_marriage_select_audit_2026_10_08_r2_immutable_records",
    mode: "select_only_zero_writes_zero_provider_calls",
    lockedRecords: current.length,
    evaluatedRecords: rows.length,
    contextMatches: hashes.filter((hash) => contexts.has(hash)).length,
    duplicateGroups: duplicateGroups.length,
    duplicateSamples: duplicateGroups.slice(0, 20),
    ...(process.argv.includes("--compact") ? { rows: compactRows } : { summary }),
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
