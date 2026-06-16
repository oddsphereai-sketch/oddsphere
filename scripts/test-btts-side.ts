/**
 * Unit tests for BTTS side helpers + auditor (lib/services/soccer/bttsSide.ts).
 * Run: npx tsx scripts/test-btts-side.ts
 *
 * The live model uses the RAW score distribution for BTTS (no λ decompression —
 * that was reverted as anti-predictive). These tests assert the raw model is
 * monotonic/predictive, that the side is argmax (Yes/No only, never toss-up),
 * and that the slate auditor flags runaway skew.
 */
import {
  resolveBttsSide,
  bttsDistributionWarning,
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
function rawBttsYes(lh: number, la: number): number {
  return bttsFromDistribution(bivariatePoissonScoreDistribution(lh, la, tau)).yes;
}

// 1. Predictive ordering: BTTS-yes must rise monotonically with the weaker
//    team's λ. This is the property the reverted decompression VIOLATED.
{
  const weakLadder = [0.54, 0.74, 0.90, 1.08]; // weaker-team λ, ascending
  const fav = 1.7;
  const ys = weakLadder.map((w) => rawBttsYes(fav, w));
  let monotonic = true;
  for (let i = 1; i < ys.length; i++) if (ys[i] <= ys[i - 1]) monotonic = false;
  check(`BTTS-yes rises with weaker λ [${ys.map((y) => y.toFixed(3)).join(", ")}]`, monotonic);
}

// 2. Genuinely two-sided games are the strongest BTTS-yes candidates.
{
  const pan = rawBttsYes(1.42, 1.08); // PAN@GHA live case — most balanced on slate
  check(`even λ 1.42/1.08 → P(yes)≥0.5 (${pan.toFixed(3)})`, pan >= 0.5);
  check("balanced → side YES", resolveBttsSide(pan, 1 - pan) === "yes");
}

// 3. Lopsided games (low weaker-team λ) correctly lean BTTS NO — and are NOT
//    force-flipped to Yes the way the gap-decompression did.
{
  const alg = rawBttsYes(2.75, 0.58); // ALG@ARG — decompression wrongly made this YES
  check(`blowout λ 2.75/0.58 → P(yes)<0.5 (${alg.toFixed(3)})`, alg < 0.5);
  check("blowout → side NO", resolveBttsSide(alg, 1 - alg) === "no");
}
{
  const y = rawBttsYes(3.20, 0.40); // extreme blowout
  check(`extreme blowout λ 3.20/0.40 → P(yes)<0.5 (${y.toFixed(3)})`, y < 0.5);
}

// 4. No Toss-Up output exists for BTTS — only "yes" | "no".
{
  const sides = [resolveBttsSide(0.5, 0.5), resolveBttsSide(0.499, 0.501), resolveBttsSide(0.7, 0.3)];
  check("resolveBttsSide only yields yes/no", sides.every((s) => s === "yes" || s === "no"));
  check("exact 0.5 resolves to yes (argmax tie → yes, never toss-up)", resolveBttsSide(0.5, 0.5) === "yes");
}

// 5. Distribution auditor warns on runaway skew (but never forces output).
{
  check("all-No slate (6) warns", bttsDistributionWarning(["no", "no", "no", "no", "no", "no"]) !== null);
  check("healthy mix does not warn", bttsDistributionWarning(["no", "no", "yes", "no", "yes", "no"]) === null);
  check("tiny slate (<5) does not warn", bttsDistributionWarning(["no", "no"]) === null);
  check("all-Yes slate (6) also warns", bttsDistributionWarning(["yes", "yes", "yes", "yes", "yes", "yes"]) !== null);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
