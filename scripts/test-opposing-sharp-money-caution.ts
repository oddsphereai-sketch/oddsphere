/**
 * Unit tests for isStrongOpposingSharpMoney (lib/services/verdictDerivation.ts)
 * — the wrong-side Caution trigger. Run:
 *   npx tsx scripts/test-opposing-sharp-money-caution.ts
 *
 * Inputs are the PICKED side's money% / tickets%. Caution fires only when the
 * OPPOSITE side holds ≥60% of the money AND ≥20pp more money than tickets.
 */
import {
  isStrongOpposingSharpMoney,
  OPPOSING_SHARP_MONEY_SHARE,
  OPPOSING_SHARP_MONEY_CAUTION_GAP_PP,
} from "../lib/services/verdictDerivation";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

check("thresholds are the high bar", OPPOSING_SHARP_MONEY_SHARE === 60 && OPPOSING_SHARP_MONEY_CAUTION_GAP_PP === 20);

// 17192-style: pick home, 82% tickets / 38% money → opp money 62%, gap 44pp → CAUTION.
check("strong opposing (38m/82b) → caution", isStrongOpposingSharpMoney(38, 82) === true);
// 17179-style total under pick: 13% money / 41% tickets → opp money 87%, gap 28pp → CAUTION.
check("strong opposing (13m/41b) → caution", isStrongOpposingSharpMoney(13, 41) === true);

// 17181-style: pick home, 65% money / 81% tickets → money STILL majority on us
// (opp money 35% < 60) → NOT caution (public-heavy but not sharp-faded).
check("public-heavy but money-majority on us (65m/81b) → no caution", isStrongOpposingSharpMoney(65, 81) === false);

// Sharp money WITH us (97% money / 75% tickets) → never caution.
check("sharp money with us (97m/75b) → no caution", isStrongOpposingSharpMoney(97, 75) === false);

// Boundary: opp money exactly 60 + gap exactly 20 → caution (inclusive).
check("boundary 40m/60b (opp 60%, gap 20) → caution", isStrongOpposingSharpMoney(40, 60) === true);
// Just under the money bar: opp money 59% → no caution even with big gap.
check("opp money 59% (41m/70b) → no caution", isStrongOpposingSharpMoney(41, 70) === false);
// Opp money ≥60 but gap only 15pp (mild — chip-amber band, not caution).
check("opp money 60 but gap 15 (40m/55b) → no caution (mild band)", isStrongOpposingSharpMoney(40, 55) === false);

// Null inputs → never caution (no false positives on missing splits).
check("null money → no caution", isStrongOpposingSharpMoney(null, 80) === false);
check("null bets → no caution", isStrongOpposingSharpMoney(38, null) === false);
check("both null → no caution", isStrongOpposingSharpMoney(null, null) === false);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
