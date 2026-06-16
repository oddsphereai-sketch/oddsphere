/**
 * Unit tests for lib/services/postedLinesWriter.ts (pure parts).
 * Run: npx tsx scripts/test-posted-lines-writer.ts
 */
import {
  mergePostedLines,
  pickedSidePrice,
  buildIncomingPostedLines,
  type PostedLines,
  type LineRowLite,
} from "../lib/services/postedLinesWriter";

let failures = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
}
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

// ── mergePostedLines: set-if-null ──
{
  const r = mergePostedLines(null, { moneyline: { american: -130, at: "t1" } });
  eq("merge into empty adds", r.posted_lines, { moneyline: { american: -130, at: "t1" } });
  check("merge into empty changed", r.changed === true);
}
{
  const existing: PostedLines = { moneyline: { american: -130, at: "t1" } };
  // Existing ML must NOT be overwritten; new total IS added.
  const r = mergePostedLines(existing, { moneyline: { american: -150, at: "t2" }, total: { american: -110, at: "t2" } });
  eq("set-if-null keeps existing ML, adds total", r.posted_lines, {
    moneyline: { american: -130, at: "t1" },
    total: { american: -110, at: "t2" },
  });
  check("changed because total added", r.changed === true);
}
{
  const existing: PostedLines = { moneyline: { american: -130, at: "t1" } };
  const r = mergePostedLines(existing, { moneyline: { american: -150, at: "t2" } });
  check("no change when all markets already present", r.changed === false);
  eq("unchanged keeps original", r.posted_lines, existing);
}

// ── pickedSidePrice: trusted-book pick, excludes blocked + splits ──
{
  const rows: LineRowLite[] = [
    { market_type: "moneyline", side: "home", sportsbook: "fliff", odds_american: -999 },
    { market_type: "moneyline", side: "home", sportsbook: "betmgm", odds_american: -132 },
    { market_type: "moneyline", side: "home", sportsbook: "pinnacle", odds_american: -135 },
    { market_type: "moneyline", side: "away", sportsbook: "pinnacle", odds_american: 120 },
    { market_type: "moneyline", side: "home", sportsbook: "splits_consensus", odds_american: -100 },
  ];
  check("pinnacle preferred for home", pickedSidePrice(rows, "moneyline", "home") === -135);
  check("away side resolves", pickedSidePrice(rows, "moneyline", "away") === 120);
  check("no rows for total → null", pickedSidePrice(rows, "total", "over") === null);
}

// ── buildIncomingPostedLines: market mapping + NRFI → under ──
{
  const rows: LineRowLite[] = [
    { market_type: "moneyline", side: "home", sportsbook: "draftkings", odds_american: -130 },
    { market_type: "total", side: "over", sportsbook: "draftkings", odds_american: -105 },
    { market_type: "first_inning_total", side: "under", sportsbook: "draftkings", odds_american: -120 },
  ];
  const inc = buildIncomingPostedLines({ mlWinner: "home", ouSide: "over", nrfi: true }, rows, "t1");
  eq("incoming all three (NRFI→under)", inc, {
    moneyline: { american: -130, at: "t1" },
    total: { american: -105, at: "t1" },
    first_inning: { american: -120, at: "t1" },
  });
}
{
  // No pick → omitted; no price → omitted.
  const rows: LineRowLite[] = [{ market_type: "moneyline", side: "home", sportsbook: "draftkings", odds_american: -130 }];
  const inc = buildIncomingPostedLines({ mlWinner: "home", ouSide: null, nrfi: null }, rows, "t1");
  eq("only ML present", inc, { moneyline: { american: -130, at: "t1" } });
  const incNoPrice = buildIncomingPostedLines({ mlWinner: "away", ouSide: null, nrfi: null }, rows, "t1");
  eq("ML pick but no away price → empty", incNoPrice, {});
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
