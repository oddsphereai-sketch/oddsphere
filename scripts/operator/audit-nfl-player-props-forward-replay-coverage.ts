#!/usr/bin/env tsx

/** SELECT-only inventory of immutable forward evidence available for current-model NFL props replay. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const key = required("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const weeks = [1, 2, 3, 4, 5, 6];
  const rows = await Promise.all(weeks.map(async (week) => {
    const evidence = await readNflForwardEvidence({ client, season: 2026, week });
    return {
      week,
      rows: evidence.length,
      games: new Set(evidence.map((row) => row.providerGameId)).size,
      firstCapturedAt: evidence.at(0)?.capturedAt ?? null,
      lastCapturedAt: evidence.at(-1)?.capturedAt ?? null,
    };
  }));
  process.stdout.write(`${JSON.stringify({ readOnly: true, writes: 0, rows }, null, 2)}\n`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
