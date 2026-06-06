/**
 * Push 3B-7 follow-up (Phase 6B.1.6i) — FI V2 breakdown alignment tests.
 *
 * Pure unit tests against the copy/key-stats helpers — no DB, no model.
 * Asserts that the breakdown copy is pick-aligned and that partial-
 * data scenarios surface explicit unavailability markers instead of
 * silently disappearing.
 */

import { generatePerMarketCopy } from "../lib/services/perMarketCopyGenerator";
import { formatKeyStats } from "../lib/services/keyStatsFormatter";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

console.log(`\n━━━ FI V2 breakdown alignment tests ━━━\n`);

// Helper to build a valid CopyInput.
type CopyMarket = "moneyline" | "total" | "first_inning";
function copyInput(pick: string | null, market: CopyMarket, modelDriver: string | null, riskDriver: string | null) {
  return {
    market,
    verdict: "lean" as const,
    pick: pick ?? "—",
    confidence: 0.55,
    sharpDirection: "none" as const,
    modelDriver,
    riskDriver,
    marketDataLimited: false,
  } as Parameters<typeof generatePerMarketCopy>[0];
}

// T1 — YRFI gets directionally-correct WHY when modelDriver is null
const yrfiFallback = generatePerMarketCopy(copyInput("YRFI", "first_inning", null, null));
check(
  "T1 YRFI fallback driver does not say 'low projected 1st-inning runs'",
  !yrfiFallback.whyLine.includes("low projected 1st-inning runs"),
);

// T2 — Toss-Up gets neutral driver, never one-sided
const tossUp = generatePerMarketCopy(copyInput("Toss-Up", "first_inning", null, null));
check(
  "T2 Toss-Up driver does not say 'low projected'",
  !tossUp.whyLine.includes("low projected"),
);
check(
  "T2 Toss-Up driver contains 'coin-flip' or 'toss' (neutral)",
  /coin-flip|toss/i.test(tossUp.whyLine),
);

// T3 — Held FI (route flow uses verdict=no_play with pick label, not null
// through perMarketCopyGenerator). The Held branch in buildWhyLine is a
// defense-in-depth fallback for any path that does pass null. Skipped:
// route doesn't currently invoke this path.

// T4 — NRFI with "low projected 1st-inning runs" modelDriver is supported
const nrfiLow = generatePerMarketCopy(copyInput("NRFI", "first_inning", "low projected 1st-inning runs", null));
check(
  "T4 NRFI primary driver may quote 'low projected 1st-inning runs'",
  nrfiLow.whyLine.includes("low projected 1st-inning runs"),
);

// T5 — Even a "low projected" modelDriver leaking through for Toss-Up is suppressed
const tossUpLeak = generatePerMarketCopy(copyInput("Toss-Up", "first_inning", "low projected 1st-inning runs", null));
check(
  "T5 Toss-Up suppresses 'low projected' even when modelDriver string is set",
  !tossUpLeak.whyLine.includes("low projected"),
);

// T6 — YRFI with "elevated projected" support is allowed
const yrfiHi = generatePerMarketCopy(copyInput("YRFI", "first_inning", "elevated projected 1st-inning runs", null));
check(
  "T6 YRFI may quote 'elevated projected 1st-inning runs' when supplied",
  yrfiHi.whyLine.includes("elevated projected 1st-inning runs"),
);

// ─── KeyStats partial-data scenarios ───────────────────────────────

// T7 — MIL@COL-style: nrfi_expected_runs + one season ERA, no FI/WHIP/OPS.
const milColRows = formatKeyStats(
  {
    nrfi_expected_runs: 0.92,
    away_first_inning_era: null,
    home_first_inning_era: null,
    away_first_inning_whip: null,
    home_first_inning_whip: null,
    away_first_inning_starts: null,
    home_first_inning_starts: null,
    away_top_order_ops: null,
    home_top_order_ops: null,
    away_starter_era: 1.65,
    home_starter_era: null,
  },
  "first_inning",
);
check(
  "T7 MIL@COL-style partial-data panel is not empty",
  milColRows.length > 0,
);
const hasStatusRow = milColRows.some((r) => r.label === "Starter data status");
check(
  "T7 partial pitcher data adds explicit 'Starter data status' row",
  hasStatusRow,
);
const statusRow = milColRows.find((r) => r.label === "Starter data status");
check(
  "T7 status row marks home as unavailable",
  statusRow?.homeValue === "unavailable",
);
check(
  "T7 status row marks away as available (Agnos season ERA present)",
  statusRow?.awayValue === "available",
);
check(
  "T7 fallback Season ERA row still shows for away (Agnos 1.65)",
  milColRows.some((r) => r.label === "Starter ERA (season)" && r.awayValue?.includes("1.65")),
);

// T8 — full FI data: status row is NOT added when both sides have FI ERA
const fullFiRows = formatKeyStats(
  {
    nrfi_expected_runs: 0.95,
    away_first_inning_era: 2.10,
    home_first_inning_era: 3.20,
    away_first_inning_whip: 0.95,
    home_first_inning_whip: 1.15,
    away_first_inning_starts: 8,
    home_first_inning_starts: 10,
    away_top_order_ops: 0.750,
    home_top_order_ops: 0.700,
  },
  "first_inning",
);
check(
  "T8 full-data game has no 'Starter data status' row",
  !fullFiRows.some((r) => r.label === "Starter data status"),
);
check(
  "T8 full-data game shows 'Starter 1st-inning ERA' row",
  fullFiRows.some((r) => r.label === "Starter 1st-inning ERA"),
);

// T9 — both sides missing all pitcher data: status row both-unavailable
const allMissing = formatKeyStats(
  {
    nrfi_expected_runs: 1.0,
    away_first_inning_era: null,
    home_first_inning_era: null,
    away_first_inning_whip: null,
    home_first_inning_whip: null,
    away_first_inning_starts: null,
    home_first_inning_starts: null,
    away_top_order_ops: null,
    home_top_order_ops: null,
    away_starter_era: null,
    home_starter_era: null,
  },
  "first_inning",
);
check(
  "T9 all-missing game still surfaces at least Projected runs + status row",
  allMissing.length >= 2,
);
const allMissingStatus = allMissing.find((r) => r.label === "Starter data status");
check(
  "T9 all-missing status row marks both sides unavailable",
  allMissingStatus?.awayValue === "unavailable" && allMissingStatus?.homeValue === "unavailable",
);

// T10 — moneyline / total are unaffected by the FI changes
const mlRows = formatKeyStats(
  { home_starter_era: 3.0, away_starter_era: 4.5, home_lineup_ops_weighted: 0.75, away_lineup_ops_weighted: 0.70 },
  "moneyline",
);
check(
  "T10 moneyline KeyStats unaffected (no FI 'Starter data status' row)",
  !mlRows.some((r) => r.label === "Starter data status"),
);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
