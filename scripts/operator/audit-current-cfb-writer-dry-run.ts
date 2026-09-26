#!/usr/bin/env tsx

/** Live-provider, zero-write replay of the sole CFB writer. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { runCfbForwardEvidenceWriter } from "../../lib/services/football/cfbForwardEvidenceWriter";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const balldontlieApiKey = process.env.BALLDONTLIE_API_KEY;
  const playbookApiKey = process.env.PLAYBOOK_API_KEY;
  const sharpApiKey = process.env.SHARPAPI_KEY;
  if (!url || !serviceKey || !balldontlieApiKey || !playbookApiKey || !sharpApiKey) {
    throw new Error("CFB dry replay requires the configured Supabase and provider credentials.");
  }
  const result = await runCfbForwardEvidenceWriter({
    client: createClient(url, serviceKey, { auth: { persistSession: false } }),
    season: 2026,
    runId: `audit-${randomUUID()}`,
    now: new Date().toISOString(),
    apply: false,
    balldontlieApiKey,
    playbookApiKey,
    sharpApiKey,
    weatherProvider: null,
  });
  console.log(JSON.stringify({ audit: "cfb_writer_live_provider_dry_run_2026_09_26_r1", apply: false, writes: 0, result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
