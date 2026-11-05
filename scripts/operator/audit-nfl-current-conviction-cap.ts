#!/usr/bin/env tsx

/** SELECT-only same-input replay of the NFL conviction-risk grade cap. */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import type { NflV1ActionableGradeBundle } from "../../lib/services/football/nflV1ActionableGradeCandidate";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";
import { applyNflMarketInnovationPosture } from "../../lib/services/football/nflMarketInnovationPosture";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = new Date();
  const season = now.getUTCFullYear();
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now });
  const client = createClient(url, key, { auth: { persistSession: false } });
  const stored = await readNflForwardEvidence({ client, season, week });
  const latest = new Map<string, (typeof stored)[number]>();
  for (const row of stored) {
    if (Date.parse(row.gameStartAt) <= now.getTime() || !("outcomeForecast" in row.payload) ||
      !row.payload.fullGameEvidenceInterpretation?.marketInnovation) continue;
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(previous.capturedAt) < Date.parse(row.capturedAt)) latest.set(row.providerGameId, row);
  }
  const rows = [...latest.values()].flatMap((row) => {
    if (!("outcomeForecast" in row.payload) || !row.payload.fullGameEvidenceInterpretation?.marketInnovation) return [];
    const before = row.payload.decisions;
    const locked = before.evaluatedBets.some((decision) => decision.stage === "t60_locked" || decision.lockedAt !== null);
    const replay = applyNflMarketInnovationPosture({
      production: before as unknown as NflV1ActionableGradeBundle,
      innovation: row.payload.fullGameEvidenceInterpretation.marketInnovation,
      homeTeam: row.payload.game.home.abbreviation,
      existingLockedRecord: locked,
    });
    return before.evaluatedBets.map((decision) => {
      const after = replay.production.evaluatedBets.find((candidate) => candidate.market === decision.market)!;
      const evaluation = replay.posture.evaluations.find((candidate) => candidate.market === decision.market)!;
      return {
        gameId: row.providerGameId,
        matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
        capturedAt: row.capturedAt,
        locked,
        market: decision.market,
        side: decision.side,
        before: decision.grade,
        after: after.grade,
        action: evaluation.action,
        opposingSources: evaluation.opposingSources,
        convictionRiskSources: evaluation.confirmation?.convictionRiskSources ?? [],
        numericalTupleUnchanged: JSON.stringify({ ...after, grade: decision.grade }) === JSON.stringify(decision),
      };
    });
  });
  const changes = rows.filter((row) => row.before !== row.after);
  const actionable = (grade: string) => grade === "Best Angle" || grade === "Lean";
  const promotions = changes.filter((row) => !actionable(row.before) && actionable(row.after));
  const demotions = changes.filter((row) => actionable(row.before) && !actionable(row.after));
  console.log(JSON.stringify({
    readOnly: true,
    writes: 0,
    providerRequests: 0,
    season,
    week,
    games: latest.size,
    markets: rows.length,
    exactSameInput: true,
    changes: changes.length,
    actionablePromotions: promotions.length,
    actionableDemotions: demotions.length,
    tierDemotions: changes.filter((row) => row.before === "Best Angle" && row.after === "Lean").length,
    allChangedNumericalTuplesUnchanged: changes.every((row) => row.numericalTupleUnchanged),
    changedRows: changes,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
