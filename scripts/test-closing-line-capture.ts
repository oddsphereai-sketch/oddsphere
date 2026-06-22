/**
 * Pure unit tests for closing-line / CLV capture (lib/services/closingLineCapture.ts).
 * Env-free. Run: npx tsx scripts/test-closing-line-capture.ts
 */
import {
  selectClosingLine,
  buildClosingLineValue,
  type ClosingLineHistoryRow,
} from "../lib/services/closingLineCapture";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const START = "2026-06-20T18:10:00Z";
const row = (o: Partial<ClosingLineHistoryRow>): ClosingLineHistoryRow => ({
  market_type: "moneyline", side: "home", sportsbook: "pinnacle",
  odds_american: -120, line_value: null, recorded_at: "2026-06-20T17:00:00Z", ...o,
});

console.log("━━━ selectClosingLine ━━━");
{
  // ML: prefers pinnacle's latest pre-start row over a more-recent draftkings row.
  const rows = [
    row({ sportsbook: "pinnacle", odds_american: -118, recorded_at: "2026-06-20T17:00:00Z" }),
    row({ sportsbook: "pinnacle", odds_american: -125, recorded_at: "2026-06-20T18:00:00Z" }),
    row({ sportsbook: "draftkings", odds_american: -130, recorded_at: "2026-06-20T18:05:00Z" }),
  ];
  const sel = selectClosingLine(rows, "moneyline", "home", START);
  check("ML: picks pinnacle (priority) latest pre-start", sel?.odds_american === -125 && sel?.sportsbook === "pinnacle");
}
{
  // Totals: carries the line_value (total number) too.
  const rows = [
    row({ market_type: "total", side: "under", odds_american: -105, line_value: 8.5, recorded_at: "2026-06-20T17:55:00Z" }),
  ];
  const sel = selectClosingLine(rows, "total", "under", START);
  check("Total: closing found with line_value", sel?.odds_american === -105 && sel?.line_value === 8.5);
}
{
  // Blocked book (fliff) ignored even if it is the latest.
  const rows = [
    row({ sportsbook: "fliff", odds_american: +200, recorded_at: "2026-06-20T18:09:00Z" }),
    row({ sportsbook: "pinnacle", odds_american: -120, recorded_at: "2026-06-20T17:30:00Z" }),
  ];
  const sel = selectClosingLine(rows, "moneyline", "home", START);
  check("Blocked book (fliff) excluded", sel?.sportsbook === "pinnacle" && sel?.odds_american === -120);
}
{
  // Rows recorded AFTER game start are excluded (no post-start contamination).
  const rows = [row({ recorded_at: "2026-06-20T18:30:00Z", odds_american: -150 })];
  const sel = selectClosingLine(rows, "moneyline", "home", START);
  check("Post-start row excluded → null", sel === null);
}
{
  // Wrong side excluded.
  const rows = [row({ side: "away" })];
  const sel = selectClosingLine(rows, "moneyline", "home", START);
  check("Wrong side excluded → null", sel === null);
}
{
  // No rows (e.g. first_inning never reaches here / no history) → null.
  check("No rows → null (graceful skip)", selectClosingLine([], "moneyline", "home", START) === null);
}

console.log("\n━━━ buildClosingLineValue (CLV math) ━━━");
{
  // bet -110, closing -130: market shortened our side → positive CLV.
  const sel = { odds_american: -130, line_value: null, sportsbook: "pinnacle", recorded_at: "2026-06-20T18:00:00Z" };
  const v = buildClosingLineValue({ market: "moneyline", side: "home", betOddsAmerican: -110, selection: sel, gameDateISO: START, nowISO: "2026-06-21T12:00:00Z" });
  check("CLV positive when closing shorter than bet", v.clv_pct !== null && v.clv_pct > 0 && v.beat_closing_line === true, `clv=${v.clv_pct}`);
  check("captures closing odds + book + recorded_at", v.closing_odds_american === -130 && v.closing_sportsbook === "pinnacle" && v.closing_recorded_at === "2026-06-20T18:00:00Z");
  check("bypasses 30d silence (recent game still computes)", v.clv_pct !== null);
}
{
  // bet -130, closing -110: market drifted off our side → negative CLV.
  const sel = { odds_american: -110, line_value: null, sportsbook: "pinnacle", recorded_at: START };
  const v = buildClosingLineValue({ market: "moneyline", side: "home", betOddsAmerican: -130, selection: sel, gameDateISO: START, nowISO: "2026-06-21T12:00:00Z" });
  check("CLV negative when closing longer than bet", v.clv_pct !== null && v.clv_pct < 0 && v.beat_closing_line === false, `clv=${v.clv_pct}`);
}
{
  // No closing line found → blob records the attempt with null CLV (graceful skip).
  const v = buildClosingLineValue({ market: "total", side: "over", betOddsAmerican: -110, selection: null, gameDateISO: START, nowISO: "2026-06-21T12:00:00Z" });
  check("Null selection → null closing/clv, no throw", v.closing_odds_american === null && v.clv_pct === null && v.beat_closing_line === null);
}

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("\n✅ Closing-line capture unit tests passed.");
