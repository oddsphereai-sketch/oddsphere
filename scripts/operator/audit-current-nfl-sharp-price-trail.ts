#!/usr/bin/env tsx

/** SELECT-only audit of provenance-separated NFL sharp-book price trails. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const week = Number(process.argv.find((value) => value.startsWith("--week="))?.slice(7) ?? "3");
  if (!Number.isInteger(week) || week < 1) throw new Error("--week must be a positive integer.");
  const rows = await readNflForwardEvidence({
    client: createClient(url, key, { auth: { persistSession: false } }),
    season: 2026,
    week,
  });
  const captures = rows.flatMap((row) => row.payload.contextualEvidenceCapture
    ? [{ row, capture: row.payload.contextualEvidenceCapture }]
    : []);
  const sources = ["circa", "pinnacle", "bookmaker"] as const;
  const markets = ["moneyline", "spread", "total"] as const;
  const coverage = sources.map((sportsbook) => ({
    sportsbook,
    markets: markets.map((market) => {
      const families = captures.flatMap(({ row, capture }) => {
        const family = capture.markets[market].families.find((value) => value[0] === sportsbook);
        return family ? [{ row, family }] : [];
      });
      const chronological = families.filter(({ family }) =>
        family[4] !== null && family[4][0] < family[5][0]);
      return {
        market,
        observations: families.length,
        games: new Set(families.map(({ row }) => row.providerGameId)).size,
        chronologicalPairs: chronological.length,
        chronologicalGames: new Set(chronological.map(({ row }) => row.providerGameId)).size,
      };
    }),
  }));
  console.log(JSON.stringify({
    release: "nfl_sharp_price_trail_select_audit_2026_09_26_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    season: 2026,
    week,
    evidenceRows: rows.length,
    capturedRows: captures.length,
    capturedGames: new Set(captures.map(({ row }) => row.providerGameId)).size,
    captureReleases: [...new Set(captures.map(({ capture }) => capture.release))].sort(),
    coverage,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
