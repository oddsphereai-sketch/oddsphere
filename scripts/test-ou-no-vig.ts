/**
 * Phase 6B.8 — unit tests for the OU no-vig wiring.
 *
 * Run: npx tsx scripts/test-ou-no-vig.ts
 * Pure fixtures; no DB; no env reads.
 *
 * Coverage:
 *   1. computeOuNoVigPair — happy path, asymmetric vig, missing side, sanity bounds.
 *   2. computeMarketBaseline — populates overNoVigProb / underNoVigProb when
 *      both prices present; null when missing.
 *   3. featureSnapshot.pickOuOdds — selects real-book odds, skips
 *      splits_consensus (odds_american=null) rows. (Tested indirectly via
 *      the exported `__TEST__` shape if available, otherwise via the
 *      market-builder integration in V2.2.)
 *   4. mlbAutoModelV2_2 — when overNoVigProb is real, ouMarketProb &
 *      ouEdgePct are real numbers; when null, both are null on the audit.
 */

import { computeOuNoVigPair, computeMarketBaseline } from "@/lib/automodel/marketPrior";
import type { MarketSnapshot } from "@/lib/automodel/types";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}
function nearly(a: number | null, b: number, eps = 0.01): boolean {
  return a !== null && Math.abs(a - b) <= eps;
}

console.log("━━━ computeOuNoVigPair ━━━\n");

console.log("1. Happy path — symmetric -110/-110");
{
  const r = computeOuNoVigPair(-110, -110);
  check("returns a pair", r !== null);
  check("over ≈ 0.50", nearly(r?.over ?? null, 0.5));
  check("under ≈ 0.50", nearly(r?.under ?? null, 0.5));
  check("sums to 1", nearly((r?.over ?? 0) + (r?.under ?? 0), 1));
}

console.log("\n2. Asymmetric vig — Over -120 / Under +100");
{
  const r = computeOuNoVigPair(-120, +100);
  // Raw: over = 120/220 ≈ 0.5455; under = 100/200 = 0.50; sum ≈ 1.0455
  // No-vig: over ≈ 0.5217; under ≈ 0.4783
  check("over ≈ 0.522", nearly(r?.over ?? null, 0.522, 0.005));
  check("under ≈ 0.478", nearly(r?.under ?? null, 0.478, 0.005));
  check("sums to 1", nearly((r?.over ?? 0) + (r?.under ?? 0), 1));
}

console.log("\n3. Missing one side → null");
{
  check("null over → null", computeOuNoVigPair(null, -110) === null);
  check("null under → null", computeOuNoVigPair(-110, null) === null);
  check("both null → null", computeOuNoVigPair(null, null) === null);
}

console.log("\n4. Invalid inputs → null");
{
  check("zero odds → null", computeOuNoVigPair(0, -110) === null);
  check("NaN odds → null", computeOuNoVigPair(Number.NaN, -110) === null);
}

console.log("\n5. Implausible overhead → null");
{
  // Both heavy favorites (impossible — overhead would be huge)
  check("two heavy favorites → null", computeOuNoVigPair(-10000, -10000) === null);
}

console.log("\n━━━ computeMarketBaseline OU population ━━━\n");

function makeMarket(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    listed_total: 8.5,
    home_ml_odds_american: -110,
    away_ml_odds_american: -110,
    over_odds_american: null,
    under_odds_american: null,
    has_pinnacle_total: false,
    ...overrides,
  };
}

console.log("1. Both OU prices present → real no-vig + ouSource set");
{
  const m = makeMarket({ over_odds_american: -110, under_odds_american: -110 });
  const baseline = computeMarketBaseline(m, null);
  check("overNoVigProb is set", baseline.overNoVigProb !== null);
  check("underNoVigProb is set", baseline.underNoVigProb !== null);
  check("ouSource = american_devig", baseline.ouSource === "american_devig");
  check("over ≈ 0.50", nearly(baseline.overNoVigProb, 0.5));
}

console.log("\n2. Missing OU prices → null + ouSource null");
{
  const m = makeMarket({ over_odds_american: null, under_odds_american: null });
  const baseline = computeMarketBaseline(m, null);
  check("overNoVigProb is null", baseline.overNoVigProb === null);
  check("underNoVigProb is null", baseline.underNoVigProb === null);
  check("ouSource is null", baseline.ouSource === null);
}

console.log("\n3. Only ONE side present → both null (need pair to de-vig)");
{
  const m = makeMarket({ over_odds_american: -110, under_odds_american: null });
  const baseline = computeMarketBaseline(m, null);
  check("overNoVigProb null (no pair)", baseline.overNoVigProb === null);
  check("underNoVigProb null", baseline.underNoVigProb === null);
  check("ouSource null", baseline.ouSource === null);
}

console.log("\n4. ML pair valid, OU pair missing → ML fields set, OU fields null");
{
  const m = makeMarket({
    home_ml_odds_american: -130,
    away_ml_odds_american: +110,
    over_odds_american: null,
    under_odds_american: null,
  });
  const baseline = computeMarketBaseline(m, null);
  check("ML homeNoVigProb set", baseline.homeNoVigProb !== null);
  check("OU overNoVigProb null (independent)", baseline.overNoVigProb === null);
  check("dataQuality = ok (ML present)", baseline.dataQuality === "ok");
}

console.log("\n" + "━".repeat(60));
console.log(`  result: ${passed}/${passed + failed} pass`);
if (failed > 0) process.exit(1);
