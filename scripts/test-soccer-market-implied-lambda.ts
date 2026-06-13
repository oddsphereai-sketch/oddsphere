/**
 * WC Tier-0 — market-implied λ inverter tests (pure, deterministic).
 *
 * Verifies the odds-inversion reproduces the input market probabilities,
 * handles favorites + missing inputs, and produces sane goal rates.
 * Run: npx tsx scripts/test-soccer-market-implied-lambda.ts
 */
import { deriveMarketImpliedLambdas } from "../lib/services/soccer/marketImpliedLambda";
import { bivariatePoissonScoreDistribution } from "../lib/services/soccer/dixonColes";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`✓ ${n}`); else { failures++; console.error(`✗ ${n}${d ? " — " + d : ""}`); } };
const tau = -0.12;
function homeWinProb(lh: number, la: number): number {
  const j = bivariatePoissonScoreDistribution(lh, la, tau);
  let h = 0, t = 0;
  for (let x = 0; x < j.length; x++) for (let y = 0; y < j[x]!.length; y++) { t += j[x]![y]!; if (x > y) h += j[x]![y]!; }
  return h / t;
}

// 1 — even matchup → λ_home ≈ λ_away ≈ totalLine/2.
const even = deriveMarketImpliedLambdas({ pHome: 0.38, pAway: 0.34, totalLine: 2.5, tau });
ok("even: ok", even.ok);
ok("even: λ_sum ≈ 2.5", Math.abs((even.lambdaHome! + even.lambdaAway!) - 2.5) < 0.05);
ok("even: reproduces home prob ~0.38", Math.abs(homeWinProb(even.lambdaHome!, even.lambdaAway!) - 0.38) < 0.02);

// 2 — home favorite → λ_home > λ_away.
const fav = deriveMarketImpliedLambdas({ pHome: 0.60, pAway: 0.18, totalLine: 2.5, tau });
ok("favorite: λ_home > λ_away", fav.lambdaHome! > fav.lambdaAway!);
ok("favorite: reproduces home prob ~0.60", Math.abs(homeWinProb(fav.lambdaHome!, fav.lambdaAway!) - 0.60) < 0.02);

// 3 — away favorite → λ_away > λ_home.
const dog = deriveMarketImpliedLambdas({ pHome: 0.25, pAway: 0.55, totalLine: 2.7, tau });
ok("away-fav: λ_away > λ_home", dog.lambdaAway! > dog.lambdaHome!);

// 4 — missing total → not ok (no fabrication; triggers Elo-only/hold upstream).
ok("missing total → not ok", deriveMarketImpliedLambdas({ pHome: 0.4, pAway: 0.35, totalLine: null, tau }).ok === false);
// 5 — missing match-result → not ok.
ok("missing MR probs → not ok", deriveMarketImpliedLambdas({ pHome: null, pAway: null, totalLine: 2.5, tau }).ok === false);

// 6 — λ are positive + bounded (sane goal rates).
ok("favorite λ positive + bounded", fav.lambdaHome! > 0 && fav.lambdaAway! > 0 && fav.lambdaHome! < 5 && fav.lambdaAway! < 5);

if (failures > 0) { console.error(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nAll market-implied λ inverter assertions passed.");
