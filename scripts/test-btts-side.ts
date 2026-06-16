/**
 * Unit tests for the WC BTTS fix (lib/services/soccer/bttsSide.ts).
 * Run: npx tsx scripts/test-btts-side.ts
 */
import {
  decompressLambdasForBtts,
  calibrateBttsYes,
  resolveBttsSide,
  bttsDistributionWarning,
  BTTS_LAMBDA_DECOMPRESS,
} from "../lib/services/soccer/bttsSide";
import { bivariatePoissonScoreDistribution } from "../lib/services/soccer/dixonColes";
import { bttsFromDistribution } from "../lib/services/soccer/soccerMarketProbabilities";
import { EXTERNAL_PRIORS_V1 } from "../lib/services/soccer/_externalPriorsV1";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}
const tau = EXTERNAL_PRIORS_V1.tau;
function bttsYesFromLambdas(lh: number, la: number, decompress = BTTS_LAMBDA_DECOMPRESS): number {
  const [h, a] = decompressLambdasForBtts(lh, la, decompress);
  return bttsFromDistribution(bivariatePoissonScoreDistribution(h, a, tau)).yes;
}

// 1. High two-sided match (both credible scorers) → BTTS YES after decompression.
{
  const y = bttsYesFromLambdas(1.67, 0.90); // CRO@ENG live case
  check(`two-sided λ 1.67/0.90 → P(yes)≥0.5 (${y.toFixed(3)})`, y >= 0.5);
  check("two-sided → side YES", resolveBttsSide(y, 1 - y) === "yes");
}
{
  const y = bttsYesFromLambdas(1.42, 1.08); // PAN@GHA live case
  check(`even λ 1.42/1.08 → P(yes)≥0.5 (${y.toFixed(3)})`, y >= 0.5);
}

// 1b. STATED PROOF CASE — CRO@ENG (live stored λ 1.6661/0.9019): raw ~0.496,
//     decompressed > 0.50, final side = yes. This is the exact game that was
//     wrongly "No" in production (stale row from old code).
{
  const raw = bttsFromDistribution(bivariatePoissonScoreDistribution(1.6661, 0.9019, tau)).yes;
  const dec = bttsYesFromLambdas(1.6661, 0.9019);
  check(`CRO@ENG raw ≈ 0.496 (${raw.toFixed(3)})`, Math.abs(raw - 0.496) < 0.01);
  check(`CRO@ENG decompressed > 0.50 (${dec.toFixed(3)})`, dec > 0.5);
  check("CRO@ENG final side = yes", resolveBttsSide(dec, 1 - dec) === "yes");
}

// 2. Strong favorite vs weak underdog → stays BTTS NO (not force-flipped).
{
  const y = bttsYesFromLambdas(3.20, 0.40); // CPV@ESP blowout
  check(`blowout λ 3.20/0.40 → P(yes)<0.5 (${y.toFixed(3)})`, y < 0.5);
  check("blowout → side NO", resolveBttsSide(y, 1 - y) === "no");
}
{
  const y = bttsYesFromLambdas(1.96, 0.54); // JOR@AUT lopsided
  check(`lopsided λ 1.96/0.54 → P(yes)<0.5 (${y.toFixed(3)})`, y < 0.5);
}

// Decompression lifts but does NOT over-force: at the default a clear blowout stays No.
{
  const raw = bttsFromDistribution(bivariatePoissonScoreDistribution(3.2, 0.4, tau)).yes;
  const dec = bttsYesFromLambdas(3.2, 0.4);
  check("decompression lifts P(yes) vs raw", dec > raw);
  check("but blowout still < 0.5 (no fake YES)", dec < 0.5);
}

// 3. Market anchor CAN lift a close model over 0.5 (capability, model-dominant).
{
  check("market lifts close model over 0.5", calibrateBttsYes(0.49, 0.60, 0.5) > 0.5);
  check("market can also lower an over-model", calibrateBttsYes(0.55, 0.40, 0.5) < 0.5);
  check("model-dominant weight keeps model influence", Math.abs(calibrateBttsYes(0.50, 0.40, 0.7) - 0.47) < 1e-9);
}

// 4. Missing market BTTS falls back to raw model.
{
  check("null market → model unchanged", calibrateBttsYes(0.512, null) === 0.512);
}

// 5. No Toss-Up output exists for BTTS — only "yes" | "no".
{
  const sides = [resolveBttsSide(0.5, 0.5), resolveBttsSide(0.499, 0.501), resolveBttsSide(0.7, 0.3)];
  check("resolveBttsSide only yields yes/no", sides.every((s) => s === "yes" || s === "no"));
  check("exact 0.5 resolves to yes (argmax tie → yes, never toss-up)", resolveBttsSide(0.5, 0.5) === "yes");
}

// 6. Distribution auditor warns on all-No slate (but never forces output).
{
  check("all-No slate (6) warns", bttsDistributionWarning(["no", "no", "no", "no", "no", "no"]) !== null);
  check("healthy mix does not warn", bttsDistributionWarning(["no", "no", "yes", "no", "yes", "no"]) === null);
  check("tiny slate (<5) does not warn", bttsDistributionWarning(["no", "no"]) === null);
  check("all-Yes slate (6) also warns (over-decompression guard)", bttsDistributionWarning(["yes", "yes", "yes", "yes", "yes", "yes"]) !== null);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
