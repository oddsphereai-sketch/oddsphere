#!/usr/bin/env tsx

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflPlayerPropsMarketObserverHistory } from "../../lib/services/football/nflPlayerPropsMarketObserverStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const season = integerArg("--season") ?? 2026;
  const weeks = listArg("--weeks") ?? [6, 7, 8];
  const reports = [];
  for (const week of weeks) {
    const history = await readNflPlayerPropsMarketObserverHistory({ client, season, week });
    const rows = history?.rows ?? [];
    reports.push({
      week,
      updatedAt: history?.updatedAt ?? null,
      rows: rows.length,
      games: new Set(rows.map((row) => row.gameId)).size,
      markets: countBy(rows.map((row) => row.market)),
      landmarks: countBy(rows.map((row) => row.landmark)),
      sourceClasses: countBy(rows.map((row) => row.sourceClass)),
      sportsbooks: countBy(rows.map((row) => row.sportsbook)),
      receivingYardsAtT60: rows.filter((row) => row.market === "receiving_yards" && row.landmark === "t60_lock").length,
      receivingYardsSharpAtT60: rows.filter((row) => row.market === "receiving_yards"
        && row.landmark === "t60_lock" && row.sourceClass === "sharp").length,
    });
  }
  console.log(JSON.stringify({ readOnly: true, season, reports }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integerArg(name: string): number | null {
  const raw = stringArg(name);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

function listArg(name: string): number[] | null {
  const raw = stringArg(name);
  if (!raw) return null;
  return raw.split(",").map((value) => {
    const parsed = Number(value.trim());
    if (!Number.isInteger(parsed)) throw new Error(`${name} must be a comma-separated integer list.`);
    return parsed;
  });
}

function stringArg(name: string): string | null {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([first], [second]) => first.localeCompare(second)));
}
