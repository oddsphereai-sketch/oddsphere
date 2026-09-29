#!/usr/bin/env tsx

/** Executes the current NFL forward writer against live inputs without database writes. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runNflForwardEvidenceWriter } from "../../lib/services/football/nflForwardEvidenceWriter";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const now = new Date();
  const season = 2026;
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now });
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const result = await runNflForwardEvidenceWriter({
    client,
    season,
    week,
    runId: `readonly-rollover-${now.toISOString()}`,
    now: now.toISOString(),
    apply: false,
    balldontlieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
    playbookApiKey: requiredEnv("PLAYBOOK_API_KEY"),
    sharpApiKey: requiredEnv("SHARPAPI_KEY"),
    weatherProvider: null,
  });
  console.log(JSON.stringify({ readOnly: true, season, week, result }, null, 2));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
