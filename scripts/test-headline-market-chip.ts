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
 *  - When v2 is enabled, uses v2's member-safe label and never falls back to
 *    legacy interpretation row-by-row.
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
type V2Read = { label: string; tone: "emerald" | "amber" | "gray" } | null | undefined;

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
  mlV2Enabled?: boolean;
  totalV2Enabled?: boolean;
  fiV2Enabled?: boolean;
  mlV2?: V2Read;
  totalV2?: V2Read;
  fiV2?: V2Read;
}): DailyEdgeGameDto {
  return {
    predictions: {
      ml: { grade: opts.mlGrade ?? null },
      total: { grade: opts.totalGrade ?? null },
      nrfi: { grade: opts.nrfiGrade ?? null },
    },
    markets: {
      moneyline: { marketInterpretation: opts.mlInterp, marketReadV2Enabled: opts.mlV2Enabled, marketReadV2: opts.mlV2 },
      total: { marketInterpretation: opts.totalInterp, marketReadV2Enabled: opts.totalV2Enabled, marketReadV2: opts.totalV2 },
      first_inning: { marketInterpretation: opts.fiInterp, marketReadV2Enabled: opts.fiV2Enabled, marketReadV2: opts.fiV2 },
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

// v2 enabled: headline chip must use v2 and ignore contradictory legacy copy.
eq("v2 enabled → v2 label wins over legacy",
  selectHeadlineMarketChip(makeGame({
    mlGrade: "sharp_confirmed",
    mlV2Enabled: true,
    mlV2: { label: "Market Support", tone: "emerald" },
    mlInterp: { chipLabel: "Sharp money against our side", chipTone: "amber", flags: ["sharp_money_against"] },
  })),
  { label: "Market Support", tone: "emerald" });

// v2 enabled but no valid read: hide cleanly, no row-level legacy fallback.
eq("v2 enabled with no valid read → hidden, no legacy fallback",
  selectHeadlineMarketChip(makeGame({
    mlGrade: "sharp_confirmed",
    mlV2Enabled: true,
    mlV2: null,
    mlInterp: { chipLabel: "Sharp money against our side", chipTone: "amber", flags: ["sharp_money_against"] },
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
