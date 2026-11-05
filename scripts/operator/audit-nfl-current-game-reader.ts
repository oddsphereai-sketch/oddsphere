#!/usr/bin/env tsx

/** SELECT-only inspection of one current NFL game's authoritative reader receipt. */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const gameId = process.argv.find((value) => value.startsWith("--game-id="))?.slice(10);
  if (!gameId) throw new Error("--game-id is required.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = new Date();
  const season = now.getUTCFullYear();
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now });
  const client = createClient(url, key, { auth: { persistSession: false } });
  const rows = (await readNflForwardEvidence({ client, season, week }))
    .filter((row) => row.providerGameId === gameId)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  const row = rows[0];
  if (!row || !("outcomeForecast" in row.payload)) throw new Error(`No current evidence for ${gameId}.`);
  const payload = row.payload;
  const posture = payload.fullGameEvidenceInterpretation?.marketInnovation?.posture ?? null;
  console.log(JSON.stringify({
    readOnly: true,
    writes: 0,
    providerRequests: 0,
    season,
    week,
    gameId,
    matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
    capturedAt: payload.capturedAt,
    startsAt: payload.game.scheduledStart,
    score: {
      away: payload.outcomeForecast.expectedAwayScore,
      home: payload.outcomeForecast.expectedHomeScore,
    },
    decisions: payload.decisions.evaluatedBets.map((decision) => ({
      market: decision.market,
      side: decision.side,
      grade: decision.grade,
      probability: decision.modelProbability,
      marketFairProbability: decision.marketFairProbability,
      expectedValue: decision.expectedValue,
      quote: decision.evaluatedQuote,
    })),
    marketResolutions: payload.fullGameEvidenceInterpretation?.marketResolutions ?? null,
    selectedSources: payload.fullGameEvidenceInterpretation?.marketInnovation?.selectedSources ?? null,
    paths: payload.fullGameEvidenceInterpretation?.marketInnovation?.paths ?? null,
    posture,
    healthHolds: payload.coverage.healthHolds,
    exactProviderScoreShadow: payload.exactProviderScoreShadow ?? null,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
