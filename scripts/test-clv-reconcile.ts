/**
 * Unit tests for lib/services/clvReconcile.ts (pure closing-line + CLV update).
 * Run: npx tsx scripts/test-clv-reconcile.ts
 */
import { pickClosingLine, computeClvUpdate, type HistoryTick } from "../lib/services/clvReconcile";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

const START = Date.parse("2026-06-16T23:00:00Z");
const t = (iso: string, book: string, odds: number | null): HistoryTick => ({ sportsbook: book, odds_american: odds, recorded_at: iso });

// Latest trusted pre-start tick wins.
check("latest pre-start wins",
  pickClosingLine([
    t("2026-06-16T20:00:00Z", "draftkings", -140),
    t("2026-06-16T22:45:00Z", "draftkings", -155), // closest to start
    t("2026-06-16T18:00:00Z", "draftkings", -130),
  ], START) === -155);

// Post-start ticks excluded.
check("post-start excluded",
  pickClosingLine([
    t("2026-06-16T22:45:00Z", "draftkings", -155),
    t("2026-06-16T23:30:00Z", "draftkings", -300), // after start — ignore
  ], START) === -155);

// Blocked + splits_consensus excluded.
check("blocked book excluded",
  pickClosingLine([
    t("2026-06-16T22:50:00Z", "fliff", -999),
    t("2026-06-16T22:45:00Z", "draftkings", -155),
  ], START) === -155);
check("splits_consensus excluded",
  pickClosingLine([
    t("2026-06-16T22:50:00Z", "splits_consensus", -999),
    t("2026-06-16T22:45:00Z", "draftkings", -155),
  ], START) === -155);

// Tie at latest timestamp → book priority (pinnacle > betmgm).
check("tie → book priority",
  pickClosingLine([
    t("2026-06-16T22:45:00Z", "betmgm", -150),
    t("2026-06-16T22:45:00Z", "pinnacle", -158),
  ], START) === -158);

// No eligible rows → null.
check("no eligible → null", pickClosingLine([t("2026-06-16T23:30:00Z", "draftkings", -155)], START) === null);
check("empty → null", pickClosingLine([], START) === null);

// computeClvUpdate
const rec = { gamePredictionId: 1, gameId: 10, market: "moneyline", betAmerican: -110 };
const up = computeClvUpdate(rec, -130);
check("update beat close (bet -110 close -130)", up !== null && up.beat_closing_line === true && (up.clv_pct ?? 0) > 0);
check("update carries bet + closing", up?.bet_odds_american === -110 && up?.closing_odds_american === -130);
const upNoClose = computeClvUpdate(rec, null);
check("null closing → clv null, not beat", upNoClose !== null && upNoClose.clv_pct === null && upNoClose.beat_closing_line === null);
check("null bet → null update", computeClvUpdate({ ...rec, betAmerican: null }, -130) === null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
