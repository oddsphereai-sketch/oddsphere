import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPriceObservations, NBA_CANONICAL_PRICE_CAPTURE_RELEASE } from "../lib/services/marketIntelligenceV2/shadowSync";
import { reconcileNbaMarketConsequence } from "../lib/services/nba/nbaMarketConsequence";
import type { NbaReaderPriceRow } from "../lib/services/nba/nbaProfessionalMarketReader";

async function main() {
  const sourceAt = new Date(Date.now() - 60_000).toISOString();
  const rows = ["home", "away"].map((side, i) => ({ id: i + 1, game_id: 44, market_type: "spread", sportsbook: "circa", side,
    line_value: i === 0 ? -5.5 : 5.5, odds_american: -110, odds_decimal: null, implied_probability: null, fetched_at: sourceAt }));
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "in", "is", "order"]) chain[method] = () => chain;
  chain.range = () => Promise.resolve({ data: rows, count: rows.length, error: null });
  const supabase = { from: () => chain } as unknown as SupabaseClient;
  const args = { supabase, sport: "nba" as const, now: new Date(), ingestionRunId: "actual:collector:run",
    games: [{ id: 44, externalId: 9, slateDate: "2026-10-31", gameDate: "2026-10-31T23:00:00Z",
      homeTeamId: 1, awayTeamId: 2, homeAbbr: "HME", awayAbbr: "AWY", homeName: "Home", awayName: "Away" }] };
  const nba = await loadPriceObservations(args);
  assert.equal(nba.length, 2);
  assert.equal(nba[0]!.fetched_at, nba[1]!.fetched_at, "one collector receipt instant owns BOTH sides");
  assert.ok(nba.every(r => r.ingestion_run_id === args.ingestionRunId && r.provider_timestamp === sourceAt));
  assert.equal(nba[0]!.provider_event_id, null, "canonical source is not falsely attributed an external provider event ID");
  await assert.rejects(loadPriceObservations({ ...args, ingestionRunId: undefined }), /actual collector run ID/);
  const nonNba = await loadPriceObservations({ ...args, sport: "cbb" });
  assert.ok(nonNba.every(r => r.ingestion_run_id === null), "non-NBA capture semantics stay unchanged");
  for (const [i, row] of nonNba.entries()) for (const field of Object.keys(row) as (keyof typeof row)[]) {
    if (["league", "ingestion_run_id", "fetched_at"].includes(field)) continue;
    assert.deepEqual(row[field], nba[i]![field], `non-NBA ${field} parity`);
  }
  const priceRows: NbaReaderPriceRow[] = nba.map(r => ({ provider: r.provider, providerEventId: r.provider_event_id,
    ingestionRunId: r.ingestion_run_id, sportsbook: r.sportsbook, sharpBook: r.sharp_book, market: r.market_type as "spread",
    selectionKey: r.selection_key, americanPrice: r.american_price, line: r.line, providerTimestamp: r.provider_timestamp, fetchedAt: r.fetched_at }));
  const seed = reconcileNbaMarketConsequence({ independentMargin: 3, independentTotal: 220, law: { marginSigma: 12, totalSigma: 18 },
    context: { eventId: "9", inputFingerprint: "f", evaluatedAt: sourceAt, priceRows: [], splitRows: [], pricesTrusted: true, splitsTrusted: true } });
  const anchored = reconcileNbaMarketConsequence({ independentMargin: 3, independentTotal: 220, law: { marginSigma: 12, totalSigma: 18 },
    context: { eventId: "9", inputFingerprint: "f", evaluatedAt: nba[0]!.fetched_at, previousState: seed.state, priceRows, splitRows: [], pricesTrusted: true, splitsTrusted: true } });
  assert.equal(Object.keys(anchored.state.anchors).length, 1, "actual canonical collector output becomes an exact paired anchor without fabricated metadata");
  assert.equal(anchored.marginApplied, false, "a collector anchor itself is never a score change");
  console.log(`${NBA_CANONICAL_PRICE_CAPTURE_RELEASE}: exact paired receipt/run, original source clock, non-NBA parity and active engine anchor passed; zero provider/DB calls.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
