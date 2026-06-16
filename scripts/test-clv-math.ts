/**
 * Unit tests for lib/streaming/clvMath.ts — pure CLV arithmetic.
 * Run: npx tsx scripts/test-clv-math.ts
 */
import { computeClv, computeClvPct, beatClosing, americanToImpliedProb } from "../lib/streaming/clvMath";

let failures = 0;
function approx(name: string, got: number | null, want: number | null, tol = 0.05): void {
  const ok =
    got === null && want === null
      ? true
      : got !== null && want !== null && Math.abs(got - want) <= tol;
  if (!ok) { failures++; console.error(`✗ ${name}\n    got:  ${got}\n    want: ${want}`); }
  else console.log(`✓ ${name}`);
}
function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
}

// implied prob sanity
approx("impl(-110)", americanToImpliedProb(-110), 0.5238);
approx("impl(+150)", americanToImpliedProb(+150), 0.4);
eq("impl(null)", americanToImpliedProb(null), null);
eq("impl(0)", americanToImpliedProb(0), null);

// bet -110, close -130: market moved toward us → positive CLV, beat close
approx("clv bet -110 close -130 (~+4.1pp)", computeClvPct(-110, -130), 4.14);
eq("beatClose bet -110 close -130", beatClosing(-110, -130), true);

// bet -130, close -110: market moved away → negative CLV, did not beat close
approx("clv bet -130 close -110 (~-4.1pp)", computeClvPct(-130, -110), -4.14);
eq("beatClose bet -130 close -110", beatClosing(-130, -110), false);

// dog: bet +150, close +120 → toward us, beat close
approx("clv bet +150 close +120 (~+5.5pp)", computeClvPct(+150, +120), 5.45);
eq("beatClose bet +150 close +120", beatClosing(+150, +120), true);

// no move → 0 CLV, not "beat" (strictly > 0)
approx("clv no move", computeClvPct(-120, -120), 0);
eq("beatClose no move (0 is not >0)", beatClosing(-120, -120), false);

// missing prices → null everywhere
eq("clv null bet", computeClvPct(null, -110), null);
eq("clv null close", computeClvPct(-110, null), null);
eq("beatClose null", beatClosing(null, null), null);
const r = computeClv(null, -110);
eq("computeClv shape on null bet", { clvPct: r.clvPct, beatClosing: r.beatClosing }, { clvPct: null, beatClosing: null });

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
