/**
 * Unit tests for selectHeadlineMarketChip (app/lab/components/daily-edge/
 * sharedCardParts.tsx) — the single collapsed-card market-intelligence chip.
 * Run: npx tsx scripts/test-headline-market-chip.ts
 *
 * Rules under test:
 *  - Reads the HEADLINE market's interpretation (strongest grade, ML→OU→NRFI).
 *  - Hides (null) when no interpretation on the headline market.
 *  - Hides when tone is gray AND there are no flags (pure "Market steady").
 *  - Surfaces emerald/amber always, and gray when it carries a flag.
 *  - first_inning_total headline maps to the `first_inning` market key.
 */
import { selectHeadlineMarketChip } from "../app/lab/components/daily-edge/sharedCardParts";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";

let failures = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
}

type Interp = { chipLabel: string; chipTone: "emerald" | "amber" | "gray"; flags: string[]; detail?: string[] } | undefined;

// Minimal fixture: per-pick grades drive the headline market; markets carry
// the interpretation. Everything else is cast away — the function only reads
// these two slices.
function makeGame(opts: {
  mlGrade?: string | null;
  totalGrade?: string | null;
  nrfiGrade?: string | null;
  mlInterp?: Interp;
  totalInterp?: Interp;
  fiInterp?: Interp;
}): DailyEdgeGameDto {
  return {
    predictions: {
      ml: { grade: opts.mlGrade ?? null },
      total: { grade: opts.totalGrade ?? null },
      nrfi: { grade: opts.nrfiGrade ?? null },
    },
    markets: {
      moneyline: { marketInterpretation: opts.mlInterp },
      total: { marketInterpretation: opts.totalInterp },
      first_inning: { marketInterpretation: opts.fiInterp },
    },
  } as unknown as DailyEdgeGameDto;
}

// Headline = ML (strongest). Emerald chip surfaces.
eq("headline ML emerald surfaces",
  selectHeadlineMarketChip(makeGame({
    mlGrade: "sharp_confirmed",
    mlInterp: { chipLabel: "Market moved toward our side", chipTone: "emerald", flags: ["toward"] },
  })),
  { label: "Market moved toward our side", tone: "emerald" });

// Headline = total (stronger grade than ML). Amber chip surfaces from total.
eq("headline total amber surfaces",
  selectHeadlineMarketChip(makeGame({
    mlGrade: "market_watch", totalGrade: "sharp_confirmed",
    mlInterp: { chipLabel: "Market steady", chipTone: "gray", flags: [] },
    totalInterp: { chipLabel: "Public-heavy, sharp unconfirmed", chipTone: "amber", flags: ["public_heavy"] },
  })),
  { label: "Public-heavy, sharp unconfirmed", tone: "amber" });

// Gray with NO flags on the headline market → hide (pure "Market steady").
eq("gray + no flags → hidden",
  selectHeadlineMarketChip(makeGame({
    mlGrade: "market_watch",
    mlInterp: { chipLabel: "Market steady", chipTone: "gray", flags: [] },
  })),
  null);

// Gray WITH a flag (e.g. splits stale) → surfaces.
eq("gray + flag → surfaces",
  selectHeadlineMarketChip(makeGame({
    mlGrade: "market_watch",
    mlInterp: { chipLabel: "Market steady · splits stale", chipTone: "gray", flags: ["splits_stale"] },
  })),
  { label: "Market steady · splits stale", tone: "gray" });

// No interpretation on the headline market → hide (even if another market has one).
eq("no interp on headline market → hidden",
  selectHeadlineMarketChip(makeGame({
    mlGrade: "sharp_confirmed", totalGrade: "market_watch",
    totalInterp: { chipLabel: "Market moved toward our side", chipTone: "emerald", flags: ["toward"] },
  })),
  null);

// No grades at all → no headline → hide.
eq("no picks → hidden", selectHeadlineMarketChip(makeGame({})), null);

// first_inning_total headline maps to the `first_inning` market key.
eq("FI headline maps to first_inning key",
  selectHeadlineMarketChip(makeGame({
    nrfiGrade: "sharp_confirmed",
    fiInterp: { chipLabel: "Reverse move against our side", chipTone: "amber", flags: ["reverse"] },
  })),
  { label: "Reverse move against our side", tone: "amber" });

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
