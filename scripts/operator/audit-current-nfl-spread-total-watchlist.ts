/** Read-only latest Week 1 replay for the non-actionable Spread/Total Watchlist. */

import { createClient } from "@supabase/supabase-js";
import type { NflForwardStoredEvidence } from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { buildNflV1ProductionDecisionBundle } from "../../lib/services/football/nflV1ProductionDecision";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stored = await readNflForwardEvidence({ client, season: 2026, week: 1 });
  const latest = latestRows(stored);
  if (latest.length !== 16) throw new Error(`Expected 16 Week 1 games; received ${latest.length}.`);
  const rows = latest.flatMap((row) => {
    const payload = row.payload;
    const shadow = "shadowEvaluatedBets" in payload.decisions
      ? payload.decisions.shadowEvaluatedBets?.[0]
      : undefined;
    if (!shadow) throw new Error(`NFL r6 tuple missing for ${row.providerGameId}.`);
    if (!("comparableCurrentBooks" in payload.market)) {
      throw new Error(`NFL multi-book evidence missing for ${row.providerGameId}.`);
    }
    const bundle = buildNflV1ProductionDecisionBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      shadowMoneyline: shadow,
    });
    return bundle.evaluatedBets.filter((decision) => decision.market !== "moneyline").map((decision) => ({
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      market: decision.market,
      side: decision.side,
      probability: decision.modelProbability,
      consensusFairProbability: decision.marketFairProbability,
      edgePercentagePoints: (decision.modelProbability - decision.marketFairProbability) * 100,
      sportsbook: decision.evaluatedQuote.sportsbook,
      line: decision.evaluatedQuote.line,
      price: decision.evaluatedQuote.price,
      observedAt: decision.evaluatedQuote.observedAt,
      grade: decision.grade,
    }));
  });
  const counts = Object.fromEntries(["spread", "total"].map((market) => [market, {
    Watchlist: rows.filter((row) => row.market === market && row.grade === "Watchlist").length,
    NoPlay: rows.filter((row) => row.market === market && row.grade === "No Play").length,
    Held: 16 - rows.filter((row) => row.market === market).length,
  }]));
  if (rows.some((row) => !["Watchlist", "No Play"].includes(row.grade))) {
    throw new Error("Spread/Total release emitted an actionable grade.");
  }
  console.log(JSON.stringify({
    readOnly: true, sourceRowsRead: stored.length, latestGames: latest.length,
    sourceCapturedAt: latest.reduce((value, row) => row.capturedAt > value ? row.capturedAt : value, ""),
    counts, actionablePromotions: 0, actionableDemotions: 0, rows,
  }, null, 2));
}

function latestRows(rows: NflForwardStoredEvidence[]): NflForwardStoredEvidence[] {
  const latest = new Map<string, NflForwardStoredEvidence>();
  for (const row of rows) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }
  return [...latest.values()].sort((first, second) =>
    first.payload.game.scheduledStart.localeCompare(second.payload.game.scheduledStart));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
