/** Read-only Week 1 spread/total board audit after the rejected r1 tournament. */

import { createClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { buildNflV1ProductionDecisionBundle } from "../../lib/services/football/nflV1ProductionDecision";
import { buildNflWeekOneHeldMemberFixture } from "../../lib/services/football/nflWeekOneHeldMemberFixture";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase read credentials are required.");

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stored = await readNflForwardEvidence({ client, season: 2026, week: 1 });
  const latest = latestRows(stored);
  if (latest.length !== 16) throw new Error(`Expected 16 Week 1 games; received ${latest.length}.`);

  const replayed = latest.map((row): NflForwardStoredEvidence => {
    if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) {
      throw new Error(`Latest NFL row ${row.id} is not the current evidence schema.`);
    }
    const payload = row.payload as NflForwardEvidencePayload;
    const shadow = payload.decisions.shadowEvaluatedBets?.[0];
    if (!shadow) throw new Error(`NFL r6 tuple missing for ${row.providerGameId}.`);
    const decisions = buildNflV1ProductionDecisionBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      shadowMoneyline: shadow,
    });
    return {
      ...row,
      payload: {
        ...payload,
        schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
        collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
        decisions: { ...decisions, shadowEvaluatedBets: [shadow] },
      },
    };
  });

  const fixture = buildNflWeekOneHeldMemberFixture(replayed);
  const markets = fixture.snapshot.games.flatMap((game) => [
    { game: `${game.awayTeam}@${game.homeTeam}`, market: "spread", value: game.markets.first_inning },
    { game: `${game.awayTeam}@${game.homeTeam}`, market: "total", value: game.markets.total },
  ]);
  if (markets.length !== 32 || markets.some(({ value }) => ["Lean", "Best Angle"].includes(value.verdict.label))) {
    throw new Error("Spread/Total Watchlist release produced an unauthorized actionable grade.");
  }

  console.log(JSON.stringify({
    readOnly: true,
    sourceRowsRead: stored.length,
    latestGames: latest.length,
    sourceCapturedAt: fixture.capturedAt,
    memberFixtureRelease: fixture.heldMemberFixtureRelease,
    rejectedTournamentRelease: "nfl_spread_total_grading_tournament_2026_08_24_r1",
    watchlistRelease: "nfl_v1_daily_edge_decision_2026_08_24_r4_spread_total_watchlist",
    grades: {
      spreadWatchlist: markets.filter(({ market, value }) => market === "spread" && value.verdict.label === "Watchlist").length,
      totalWatchlist: markets.filter(({ market, value }) => market === "total" && value.verdict.label === "Watchlist").length,
      held: markets.filter(({ value }) => value.held).length,
    },
    promotions: 0,
    demotions: 0,
    rows: markets.map(({ game, market, value }) => ({
      game,
      market,
      side: value.pick,
      probability: value.modelProb,
      sportsbook: value.marketSource,
      price: value.priceAmerican,
      grade: value.verdict.label,
    })),
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
