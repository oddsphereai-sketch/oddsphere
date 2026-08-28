import {
  verifiedHundredSplitPct,
  verifiedSourceAwareSplitPctHundred,
  verifiedUnitSplitPct,
} from "../lib/services/splitEvidenceQuality";

const failures: string[] = [];
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}`);
    failures.push(label);
  }
}

check("valid unit percentage is preserved", verifiedUnitSplitPct(0.67) === 0.67);
check("zero unit endpoint is unavailable", verifiedUnitSplitPct(0) === null);
check("one unit endpoint is unavailable", verifiedUnitSplitPct(1) === null);
check("valid hundred percentage is preserved", verifiedHundredSplitPct(67) === 67);
check("zero hundred endpoint is unavailable", verifiedHundredSplitPct(0) === null);
check("one-hundred endpoint is unavailable", verifiedHundredSplitPct(100) === null);
check("source-aware fraction converts for display", verifiedSourceAwareSplitPctHundred(0.673) === 67);
check("legacy source-aware hundred value remains compatible", verifiedSourceAwareSplitPctHundred(67) === 67);
check("source-aware endpoint stays unavailable", verifiedSourceAwareSplitPctHundred(1) === null);
check("malformed values stay unavailable", verifiedHundredSplitPct(Number.NaN) === null);

if (failures.length > 0) process.exitCode = 1;
else console.log("\nSplit evidence quality tests passed.");
