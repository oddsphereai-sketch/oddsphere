/** Read-only current Week 1 replay for the versioned NFL grading tiers. */

import { createClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import {
  buildNflV1ProductionDecisionBundle,
  nflV1WatchlistReason,
} from "../../lib/services/football/nflV1ProductionDecision";
import { buildNflWeekOneHeldMemberFixture } from "../../lib/services/football/nflWeekOneHeldMemberFixture";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase read credentials are required.");

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stored = await readNflForwardEvidence({ client, season: 2026, week: 1 });
  const latest = latestRows(stored);
  if (latest.length !== 16) throw new Error(`Expected 16 Week 1 games; received ${latest.length}.`);

  const watchlistReasons = new Map<string, string | null>();
  const replayed = latest.map((row): NflForwardStoredEvidence => {
  if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) {
    throw new Error(`Latest NFL row ${row.id} is not the current evidence schema.`);
  }
  const currentPayload = row.payload as NflForwardEvidencePayload;
  const shadow = currentPayload.decisions.shadowEvaluatedBets?.[0];
  if (!shadow) throw new Error(`NFL r6 tuple missing for ${row.providerGameId}.`);
  const decisions = buildNflV1ProductionDecisionBundle({
    providerGameId: currentPayload.game.providerGameId,
    awayTeam: currentPayload.game.away.abbreviation,
    homeTeam: currentPayload.game.home.abbreviation,
    gameStartsAt: currentPayload.game.scheduledStart,
    current: currentPayload.market.current,
    shadowMoneyline: shadow,
  });
  const outcomeWinner = decisions.outcomeConfidence.find((decision) => decision.market === "moneyline")?.likelySide;
  if (!outcomeWinner) throw new Error(`NFL moneyline outcome missing for ${row.providerGameId}.`);
  watchlistReasons.set(row.providerGameId, nflV1WatchlistReason({
    shadowMoneyline: shadow,
    outcomeWinner,
  }));
  const payload: NflForwardEvidencePayload = {
    ...currentPayload,
    schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
    decisions: { ...decisions, shadowEvaluatedBets: [shadow] },
  };
  return { ...row, payload };
  });

  const fixture = buildNflWeekOneHeldMemberFixture(replayed);
  const markets = fixture.snapshot.games.flatMap((game) => [
  [game, "moneyline", game.markets.moneyline] as const,
  [game, "spread", game.markets.first_inning] as const,
  [game, "total", game.markets.total] as const,
  ]);
  const grades = markets.reduce<Record<string, number>>((counts, [, , market]) => {
  counts[market.verdict.label] = (counts[market.verdict.label] ?? 0) + 1;
  return counts;
  }, {});
  const moneylines = fixture.snapshot.games.map((game) => ({
  game: `${game.awayTeam}@${game.homeTeam}`,
  projectedScore: `${game.projected.away}-${game.projected.home}`,
  side: game.markets.moneyline.pick,
  grade: game.markets.moneyline.verdict.label,
  probability: game.markets.moneyline.modelProb,
  sportsbook: game.markets.moneyline.marketSource,
  price: game.markets.moneyline.priceAmerican,
    expectedValuePct: game.markets.moneyline.pinnacleEvPct,
    watchlistReason: game.markets.moneyline.verdict.label === "Watchlist"
      ? watchlistReasons.get(game.id.replace(/^nfl-/, "")) ?? null
      : null,
  }));
  if (markets.length !== 48 || markets.some(([, , market]) => market.held)) {
    throw new Error("Current NFL tier replay contains missing markets or an unexpected Hold.");
  }
  if ((grades["Best Angle"] ?? 0) !== 0) throw new Error("Best Angle is not authorized.");

  console.log(JSON.stringify({
  readOnly: true,
  sourceRowsRead: stored.length,
  latestGames: latest.length,
  sourceCapturedAt: fixture.capturedAt,
  memberFixtureRelease: fixture.heldMemberFixtureRelease,
  grades,
  actionablePromotions: 0,
  actionableDemotions: 0,
  netActionableChange: 0,
  moneylines,
  }, null, 2));
}

function latestRows(rows: NflForwardStoredEvidence[]): NflForwardStoredEvidence[] {
  const latest = new Map<string, NflForwardStoredEvidence>();
  for (const row of rows) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) {
      latest.set(row.providerGameId, row);
    }
  }
  return [...latest.values()].sort((a, b) =>
    a.payload.game.scheduledStart.localeCompare(b.payload.game.scheduledStart));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
