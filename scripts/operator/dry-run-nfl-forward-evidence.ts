/**
 * Read/provider-only NFL forward-writer rehearsal. The production writer runs
 * with apply=false, so no evidence, member snapshot, or tracking row is written.
 */

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runNflForwardEvidenceWriter } from "@/lib/services/football/nflForwardEvidenceWriter";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integerFlag(name: string, fallback: number): number {
  const raw = process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

async function main() {
  if (process.argv.includes("--apply")) throw new Error("This operator is read-only; --apply is not supported.");
  const season = integerFlag("--season", Number(process.env.NFL_FORWARD_SEASON ?? 2026));
  const week = integerFlag("--week", Number(process.env.NFL_FORWARD_WEEK ?? 1));
  const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const result = await runNflForwardEvidenceWriter({
    client,
    season,
    week,
    runId: `dry-run-${randomUUID()}`,
    now: new Date().toISOString(),
    apply: false,
    balldontlieApiKey: required("BALLDONTLIE_API_KEY"),
    playbookApiKey: required("PLAYBOOK_API_KEY"),
    sharpApiKey: required("SHARPAPI_KEY"),
    weatherProvider: null,
  });
  console.log(JSON.stringify({ readOnly: true, writes: 0, season, week, result }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
