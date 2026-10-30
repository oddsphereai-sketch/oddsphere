/** Read-only production evidence replay. No provider calls or database writes. */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { buildCfbMemberFixture } from "../../lib/services/football/cfbMemberFixture";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
  if (!url || !key || !output) throw Error("Read credentials and explicit output path required");
  const now = new Date().toISOString();
  const read = await readCfbForwardWriterEvidence({ client: createClient(url, key, { auth: { persistSession: false } }), season: 2026, now });
  const beforeBytes = JSON.stringify(read.evidence);
  const fixture = buildCfbMemberFixture(read.evidence, now);
  assert.equal(JSON.stringify(read.evidence), beforeBytes, "reader cannot mutate source evidence");
  assert.ok(Date.parse(now) - Date.parse(fixture.capturedAt) < 90 * 60_000, "must select current evidence rather than an ancient complete fallback");
  const focus = fixture.snapshot.games.filter(game => ["cfb-458441", "cfb-457406"].includes(game.id)).map(game => ({
    id: game.id, lock: game.lockState,
    markets: Object.fromEntries(Object.entries(game.markets).map(([market, value]) => [market, {
      pick: value.pick, grade: value.verdict?.label, held: value.held,
      price: value.currentPriceAmerican, book: value.currentPriceSportsbook,
      observedAt: value.currentPriceObservedAt,
    }])),
  }));
  const jmu = focus.find(game => game.id === "cfb-458441");
  assert.equal(jmu?.lock, "locked", "the real r55 intermediate lock must be carried into the current member board");
  assert.ok(Object.values(jmu!.markets).every(market => market.pick && !market.held));
  const report = { now, apply: false, writes: 0, providerRequests: 0,
    sourceRows: read.evidence.length, quarantined: read.quarantined,
    fixtureRelease: fixture.fixtureRelease, sourceCapturedAt: fixture.capturedAt,
    games: fixture.snapshot.games.length,
    locks: fixture.snapshot.games.filter(game => game.lockState === "locked").length,
    focus,
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
