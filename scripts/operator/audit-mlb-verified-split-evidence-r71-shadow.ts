/**
 * SELECT-only r71 impact replay.
 *
 * Runs the authoritative MLB record builder twice against identical current
 * inputs. The candidate client scrubs unsupported exact split endpoints only
 * in returned query data; it never writes or calls a provider. This proves
 * board impact before the production reader/writer paths are changed.
 */

import { createClient } from "@supabase/supabase-js";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";
import {
  verifiedHundredSplitPct,
  verifiedUnitSplitPct,
} from "../../lib/services/splitEvidenceQuality";

type Json = Record<string, unknown>;

function sanitizeRow(table: string, row: unknown): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  const next = { ...(row as Json) };
  if (table === "sharp_signals" || table === "public_splits_observations") {
    next.public_betting_pct = verifiedHundredSplitPct(next.public_betting_pct as number | null);
    next.public_money_pct = verifiedHundredSplitPct(next.public_money_pct as number | null);
  }
  if (table === "market_split_observations_v2") {
    next.bets_pct = verifiedUnitSplitPct(next.bets_pct as number | null);
    next.money_pct = verifiedUnitSplitPct(next.money_pct as number | null);
  }
  return next;
}

function wrapBuilder(builder: any, table: string): any {
  let proxy: any;
  proxy = new Proxy(builder, {
    get(target, property, receiver) {
      if (property === "then") {
        return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
          target.then(
            (result: { data?: unknown; [key: string]: unknown }) => {
              const data = Array.isArray(result.data)
                ? result.data.map((row) => sanitizeRow(table, row))
                : sanitizeRow(table, result.data);
              resolve({ ...result, data });
            },
            reject,
          );
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const next = value.apply(target, args);
        return next === target ? proxy : wrapBuilder(next, table);
      };
    },
  });
  return proxy;
}

function shadowClient<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "from") {
        return (table: string) => {
          const builder = (target as any).from(table);
          return table === "sharp_signals"
            || table === "public_splits_observations"
            || table === "market_split_observations_v2"
            ? wrapBuilder(builder, table)
            : builder;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function grade(row: Json): string {
  if (row.best_angle === true) return "best_angle";
  if (row.play_grade === "lean") return "lean";
  if (row.play_grade === "market_aligned") return "watchlist";
  return "no_play";
}

function count(rows: Json[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[grade(row)] = (out[grade(row)] ?? 0) + 1;
  return out;
}

function snapshot(row: Json): Json {
  return row.snapshot_json !== null && typeof row.snapshot_json === "object"
    ? row.snapshot_json as Json
    : {};
}

function decision(row: Json): Json {
  const value = snapshot(row).decision_pipeline;
  return value !== null && typeof value === "object" ? value as Json : {};
}

function key(row: Json): string {
  return `${row.game_id}::${row.market}`;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const keyValue = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !keyValue) throw new Error("Supabase read credentials are required");
  const slateDate = process.argv[2] ?? "2026-08-28";
  const client = createClient(url, keyValue, { auth: { persistSession: false } });
  const opts = { sport: "mlb" as const, slateDate, launchDay: false, apply: false };
  const baseline = await createPredictionRecords({ ...opts, supabase: client });
  const candidate = await createPredictionRecords({ ...opts, supabase: shadowClient(client) });
  if (baseline.errors.length > 0 || candidate.errors.length > 0) {
    throw new Error(JSON.stringify({ baselineErrors: baseline.errors, candidateErrors: candidate.errors }));
  }
  const before = baseline.proposed as unknown as Json[];
  const after = candidate.proposed as unknown as Json[];
  const beforeByKey = new Map(before.map((row) => [key(row), row]));
  const changes = after.flatMap((row) => {
    const prior = beforeByKey.get(key(row));
    if (!prior) return [];
    const beforeGrade = grade(prior);
    const afterGrade = grade(row);
    const beforeDecision = decision(prior);
    const afterDecision = decision(row);
    const splitChanged = JSON.stringify(snapshot(prior).public_splits) !== JSON.stringify(snapshot(row).public_splits)
      || JSON.stringify(snapshot(prior).source_aware_split_rows_at_lock) !== JSON.stringify(snapshot(row).source_aware_split_rows_at_lock);
    if (beforeGrade === afterGrade && !splitChanged) return [];
    return [{
      gameId: row.game_id,
      matchup: row.matchup,
      market: row.market,
      pick: row.pick,
      beforeGrade,
      afterGrade,
      promotion: !["best_angle", "lean"].includes(beforeGrade) && ["best_angle", "lean"].includes(afterGrade),
      demotion: ["best_angle", "lean"].includes(beforeGrade) && !["best_angle", "lean"].includes(afterGrade),
      beforeRule: beforeDecision.action_rule_id ?? null,
      afterRule: afterDecision.action_rule_id ?? null,
      beforeNoBetReason: prior.no_bet_reason ?? null,
      afterNoBetReason: row.no_bet_reason ?? null,
      splitEvidenceChanged: splitChanged,
    }];
  });
  console.log(JSON.stringify({
    release: "mlb_daily_edge_decision_2026_08_28_r71_verified_split_evidence",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    slateDate,
    records: before.length,
    beforeCounts: count(before),
    afterCounts: count(after),
    promotions: changes.filter((row) => row.promotion).length,
    demotions: changes.filter((row) => row.demotion).length,
    gradeChanges: changes.filter((row) => row.beforeGrade !== row.afterGrade),
    evidenceChanges: changes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
