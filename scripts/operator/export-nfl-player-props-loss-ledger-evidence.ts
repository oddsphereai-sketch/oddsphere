#!/usr/bin/env tsx

/** SELECT-only export of immutable NFL player-props loss-ledger evidence. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import {
  decodeNflPlayerPropsMarketObserverHistory,
  nflPlayerPropsMarketObserverKey,
} from "../../lib/services/football/nflPlayerPropsMarketObserverStore";
import { readNflPlayerPropsPrivateTrackingHistory } from "../../lib/services/football/nflPlayerPropsPrivateTrackingStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const season = numericArgument("season", 2026);
  const week = numericArgument("week", 5);
  const output = stringArgument("out");
  if (!Number.isInteger(season) || !Number.isInteger(week)) throw new Error("season and week must be integers");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const privateHistory = await readNflPlayerPropsPrivateTrackingHistory({ client, season, week });
  if (!privateHistory) throw new Error(`private tracking history is unavailable for ${season} Week ${week}`);
  const { data, error } = await client.from("lab_response_snapshots")
    .select("payload,generated_at,payload_version,source")
    .eq("snapshot_key", nflPlayerPropsMarketObserverKey(season, week))
    .maybeSingle();
  if (error) throw new Error(`market observer read failed: ${error.message}`);
  const marketHistory = decodeNflPlayerPropsMarketObserverHistory(data?.payload);
  if (!marketHistory) throw new Error(`market observer history is unavailable for ${season} Week ${week}`);
  const result = {
    release: "nfl_player_props_loss_ledger_evidence_2026_10_15_r1",
    readOnly: true,
    productionWrites: 0,
    season,
    week,
    privateHistory,
    marketObserver: {
      generatedAt: data?.generated_at ?? null,
      payloadVersion: data?.payload_version ?? null,
      source: data?.source ?? null,
      history: marketHistory,
    },
  };
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  if (output) writeFileSync(output, encoded, "utf8");
  else process.stdout.write(encoded);
}

function numericArgument(name: string, fallback: number): number {
  const value = stringArgument(name);
  return value === null ? fallback : Number(value);
}

function stringArgument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
