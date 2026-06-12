/**
 * Unit tests for the pure helpers in lib/services/soccer/writeSoccerLines.ts.
 *
 * No DB. No network. Fixture-only. Encodes the Option-A scope Daniel
 * approved on 2026-06-11:
 *   • match_result / double_chance / btts → all rows pass through.
 *   • total → main per book + the immediately-adjacent alt on each side.
 *   • Provider precedence: SharpAPI wins on tuple collision; BDL fills
 *     the rest.
 *   • Hard non-mixing: markets and sides stay in their own keys.
 *
 * Run: npx tsx scripts/test-soccer-lines.ts
 */
import {
  filterToPersistableRows,
  mergeProviderRows,
  pickMainTotalPerBook,
  selectMainAndAdjacentTotals,
  toLineHistoryRow,
  toLinesRow,
} from "../lib/services/soccer/writeSoccerLines";
import type { NormalizedSoccerOddsRecord } from "../lib/providers/real_api/_soccerMarketNormalizer";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint !== undefined ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

const baseFetched = "2026-06-11T20:00:00.000Z";

function row(o: {
  market: "match_result" | "double_chance" | "total" | "btts";
  selection: string;
  line?: number | null;
  odds_american?: number | null;
  odds_decimal?: number | null;
  sportsbook?: string | null;
  provider?: "bdl" | "sharpapi";
  provider_endpoint?: string;
  provider_event_id?: string | null;
  fetched_at?: string;
}): NormalizedSoccerOddsRecord {
  return {
    market: o.market,
    selection: o.selection,
    line: o.line ?? null,
    odds_american: o.odds_american ?? -110,
    odds_decimal: o.odds_decimal ?? 1.91,
    sportsbook: o.sportsbook ?? "fanduel",
    provider: o.provider ?? "sharpapi",
    provider_endpoint: o.provider_endpoint ?? "test",
    provider_event_id: o.provider_event_id ?? null,
    fetched_at: o.fetched_at ?? baseFetched,
  } as NormalizedSoccerOddsRecord;
}

// ─── pickMainTotalPerBook ──────────────────────────────────────────
console.log("\n=== pickMainTotalPerBook ===");

{
  const rows = [
    row({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    row({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 3.5, odds_american: +180, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 1.5, odds_american: -260, sportsbook: "fanduel" }),
  ];
  const m = pickMainTotalPerBook(rows);
  check("FanDuel main picked at line nearest fair odds (2.5, |odds+100|=10)", m.get("fanduel") === 2.5);
}

{
  const rows = [
    row({ market: "total", selection: "over", line: 3.0, odds_american: -120, sportsbook: "draftkings" }),
    row({ market: "total", selection: "over", line: 3.5, odds_american: -101, sportsbook: "draftkings" }),
    row({ market: "total", selection: "over", line: 4.0, odds_american: +140, sportsbook: "draftkings" }),
  ];
  const m = pickMainTotalPerBook(rows);
  check("DraftKings main picked at 3.5 (|-101+100|=1 < |-120+100|=20)", m.get("draftkings") === 3.5);
}

{
  const rows = [
    row({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 3.5, odds_american: +175, sportsbook: "draftkings" }),
    row({ market: "match_result", selection: "home", line: null, odds_american: +145, sportsbook: "fanduel" }),
  ];
  const m = pickMainTotalPerBook(rows);
  check("Per-book independence: 2 books → 2 main entries", m.size === 2);
  check("Non-total rows ignored entirely", m.has("fanduel") && m.has("draftkings"));
}

{
  const m = pickMainTotalPerBook([]);
  check("Empty input → empty map", m.size === 0);
}

{
  const rows = [
    row({ market: "total", selection: "over", line: 2.5, odds_american: null, sportsbook: "fanduel" }),
    row({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
  ];
  const m = pickMainTotalPerBook(rows);
  check("Null odds_american skipped, main falls back to under side", m.get("fanduel") === 2.5);
}

// ─── selectMainAndAdjacentTotals ────────────────────────────────────
console.log("\n=== selectMainAndAdjacentTotals ===");

{
  // Book with full 2.0/2.5/3.0/3.5/4.0 alt ladder. Main = 2.5.
  // Expected keep set: 2.0, 2.5, 3.0 (over+under at each).
  const lines = [2.0, 2.5, 3.0, 3.5, 4.0];
  const rs: NormalizedSoccerOddsRecord[] = [];
  for (const l of lines) {
    rs.push(row({ market: "total", selection: "over", line: l, odds_american: l === 2.5 ? -110 : 200, sportsbook: "fanduel" }));
    rs.push(row({ market: "total", selection: "under", line: l, odds_american: l === 2.5 ? -110 : -300, sportsbook: "fanduel" }));
  }
  const kept = selectMainAndAdjacentTotals(rs);
  const keptLines = [...new Set(kept.map((r) => r.line))].sort((a, b) => (a ?? 0) - (b ?? 0));
  check("Ladder 2.0–4.0 keeps {2.0, 2.5, 3.0}", JSON.stringify(keptLines) === JSON.stringify([2.0, 2.5, 3.0]));
  check("Both sides kept at each line (6 rows total)", kept.length === 6);
  check("No 3.5 line in result (out of ±1 window)", kept.find((r) => r.line === 3.5) === undefined);
  check("No 4.0 line in result (out of ±1 window)", kept.find((r) => r.line === 4.0) === undefined);
}

{
  // Book offers only main, no adjacents.
  const rs = [
    row({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "betmgm" }),
    row({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "betmgm" }),
  ];
  const kept = selectMainAndAdjacentTotals(rs);
  check("Book with only main → 2 rows kept, no fabrication", kept.length === 2);
}

{
  // Two books with different mains.
  const rs = [
    // FanDuel main = 2.5, alts at 2.0 and 3.0.
    row({ market: "total", selection: "over", line: 2.0, odds_american: -260, sportsbook: "fanduel" }),
    row({ market: "total", selection: "under", line: 2.0, odds_american: +200, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    row({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 3.0, odds_american: +140, sportsbook: "fanduel" }),
    row({ market: "total", selection: "under", line: 3.0, odds_american: -180, sportsbook: "fanduel" }),
    // DraftKings main = 3.5 (different!), alts at 3.0 and 4.0.
    row({ market: "total", selection: "over", line: 3.0, odds_american: -180, sportsbook: "draftkings" }),
    row({ market: "total", selection: "under", line: 3.0, odds_american: +140, sportsbook: "draftkings" }),
    row({ market: "total", selection: "over", line: 3.5, odds_american: -105, sportsbook: "draftkings" }),
    row({ market: "total", selection: "under", line: 3.5, odds_american: -115, sportsbook: "draftkings" }),
    row({ market: "total", selection: "over", line: 4.0, odds_american: +160, sportsbook: "draftkings" }),
    row({ market: "total", selection: "under", line: 4.0, odds_american: -200, sportsbook: "draftkings" }),
  ];
  const kept = selectMainAndAdjacentTotals(rs);
  const fdLines = [...new Set(kept.filter((r) => r.sportsbook === "fanduel").map((r) => r.line))].sort((a, b) => (a ?? 0) - (b ?? 0));
  const dkLines = [...new Set(kept.filter((r) => r.sportsbook === "draftkings").map((r) => r.line))].sort((a, b) => (a ?? 0) - (b ?? 0));
  check(
    "Disagreeing-main books each get their own ±1 window — FanDuel {2.0,2.5,3.0}",
    JSON.stringify(fdLines) === JSON.stringify([2.0, 2.5, 3.0]),
    `got ${JSON.stringify(fdLines)}`,
  );
  check(
    "Disagreeing-main books each get their own ±1 window — DraftKings {3.0,3.5,4.0}",
    JSON.stringify(dkLines) === JSON.stringify([3.0, 3.5, 4.0]),
    `got ${JSON.stringify(dkLines)}`,
  );
}

// ─── filterToPersistableRows ───────────────────────────────────────
console.log("\n=== filterToPersistableRows (Option A) ===");

{
  const rs: NormalizedSoccerOddsRecord[] = [
    // match_result — all 3 should pass
    row({ market: "match_result", selection: "home", odds_american: +145 }),
    row({ market: "match_result", selection: "draw", odds_american: +220 }),
    row({ market: "match_result", selection: "away", odds_american: +185 }),
    // double_chance — all 3 should pass
    row({ market: "double_chance", selection: "home_or_draw" }),
    row({ market: "double_chance", selection: "away_or_draw" }),
    row({ market: "double_chance", selection: "home_or_away" }),
    // btts — both should pass
    row({ market: "btts", selection: "yes", odds_american: -120 }),
    row({ market: "btts", selection: "no", odds_american: +100 }),
    // total — ladder with main at 2.5, only 2.0/2.5/3.0 should survive
    row({ market: "total", selection: "over", line: 1.5, odds_american: -350, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 2.0, odds_american: -260, sportsbook: "fanduel" }),
    row({ market: "total", selection: "under", line: 2.0, odds_american: +200, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    row({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 3.0, odds_american: +140, sportsbook: "fanduel" }),
    row({ market: "total", selection: "under", line: 3.0, odds_american: -180, sportsbook: "fanduel" }),
    row({ market: "total", selection: "over", line: 4.0, odds_american: +400, sportsbook: "fanduel" }),
  ];
  const kept = filterToPersistableRows(rs);

  check("match_result count preserved", kept.filter((r) => r.market === "match_result").length === 3);
  check("double_chance count preserved", kept.filter((r) => r.market === "double_chance").length === 3);
  check("btts count preserved", kept.filter((r) => r.market === "btts").length === 2);
  const totalKept = kept.filter((r) => r.market === "total");
  check("Total trimmed to main + ±1 (6 rows from 8 alts)", totalKept.length === 6);
  check("1.5 alt dropped (out of window)", totalKept.find((r) => r.line === 1.5) === undefined);
  check("4.0 alt dropped (out of window)", totalKept.find((r) => r.line === 4.0) === undefined);

  // Hard non-mixing assertions on the kept set.
  const distinctMarkets = new Set(kept.map((r) => r.market));
  check("All four official markets retained as distinct types", distinctMarkets.size === 4);
  const dcSides = new Set(kept.filter((r) => r.market === "double_chance").map((r) => r.selection));
  check("Double Chance sides survived (home_or_draw/away_or_draw/home_or_away)", dcSides.size === 3);
}

// ─── mergeProviderRows ──────────────────────────────────────────────
console.log("\n=== mergeProviderRows (SharpAPI wins ties, BDL fills gaps) ===");

{
  const bdl = [
    row({ market: "match_result", selection: "home", odds_american: +140, sportsbook: "bovada", provider: "bdl" }),
    row({ market: "match_result", selection: "draw", odds_american: +210, sportsbook: "bovada", provider: "bdl" }),
    row({ market: "match_result", selection: "away", odds_american: +180, sportsbook: "bovada", provider: "bdl" }),
  ];
  const sharp = [
    row({ market: "match_result", selection: "home", odds_american: +145, sportsbook: "bovada", provider: "sharpapi" }),
    // SharpAPI doesn't cover draw on Bovada — leaves BDL row intact.
  ];
  const merged = mergeProviderRows(bdl, sharp);

  const home = merged.find((r) => r.market === "match_result" && r.selection === "home" && r.sportsbook === "bovada");
  const draw = merged.find((r) => r.market === "match_result" && r.selection === "draw" && r.sportsbook === "bovada");
  const away = merged.find((r) => r.market === "match_result" && r.selection === "away" && r.sportsbook === "bovada");

  check("SharpAPI overrides BDL on (market, side, book, line) tie — home odds = +145", home?.odds_american === +145);
  check("BDL row preserved where SharpAPI silent — draw odds = +210", draw?.odds_american === +210);
  check("BDL row preserved where SharpAPI silent — away odds = +180", away?.odds_american === +180);
  check("No duplicate (market, side, book, line) rows after merge", merged.length === 3);
}

{
  // Markets/sides/lines never collide.
  const bdl = [
    row({ market: "total", selection: "over", line: 2.5, sportsbook: "fanduel", provider: "bdl" }),
    row({ market: "total", selection: "under", line: 2.5, sportsbook: "fanduel", provider: "bdl" }),
    row({ market: "total", selection: "over", line: 3.5, sportsbook: "fanduel", provider: "bdl" }),
  ];
  const sharp = [
    row({ market: "total", selection: "over", line: 2.5, sportsbook: "fanduel", odds_american: -108, provider: "sharpapi" }),
  ];
  const merged = mergeProviderRows(bdl, sharp);
  check("Total at different line_values stay as separate rows (2.5 over, 2.5 under, 3.5 over)", merged.length === 3);
  const o25 = merged.find((r) => r.selection === "over" && r.line === 2.5);
  check("SharpAPI override applied at exact line_value 2.5/over", o25?.odds_american === -108);
}

// ─── toLinesRow / toLineHistoryRow ─────────────────────────────────
console.log("\n=== toLinesRow / toLineHistoryRow ===");

{
  const r = row({
    market: "double_chance",
    selection: "home_or_draw",
    odds_american: -180,
    odds_decimal: 1.55,
    sportsbook: "fanduel",
  });
  const linesRow = toLinesRow(15721, r, "2026-06-11T22:00:00.000Z");
  check("toLinesRow keeps market name verbatim", linesRow.market_type === "double_chance");
  check("toLinesRow keeps selection as `side`", linesRow.side === "home_or_draw");
  check("toLinesRow sets player_id null (no player markets for WC)", linesRow.player_id === null);
  check("toLinesRow preserves DECIMAL-safe line null", linesRow.line_value === null);
  check("toLinesRow preserves odds_american", linesRow.odds_american === -180);
  check("toLinesRow preserves odds_decimal", linesRow.odds_decimal === 1.55);
  check("toLinesRow stamps captured-at ISO", linesRow.fetched_at === "2026-06-11T22:00:00.000Z");

  const histRow = toLineHistoryRow(linesRow, "2026-06-11T22:00:00.000Z");
  check("toLineHistoryRow inherits all lines fields", histRow.market_type === "double_chance" && histRow.side === "home_or_draw");
  check("toLineHistoryRow stamps recorded_at", histRow.recorded_at === "2026-06-11T22:00:00.000Z");
  check("toLineHistoryRow does NOT pre-set is_opener (opener helper handles it)", histRow.is_opener === undefined);
  // Schema fix: line_history has no `fetched_at` or `odds_decimal` columns.
  check("toLineHistoryRow does NOT include fetched_at (schema mismatch fix)", !("fetched_at" in histRow));
  check("toLineHistoryRow does NOT include odds_decimal (schema mismatch fix)", !("odds_decimal" in histRow));
}

{
  const r = row({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" });
  const linesRow = toLinesRow(15721, r, baseFetched);
  check("Total row keeps line_value=2.5 (DECIMAL safe)", linesRow.line_value === 2.5);
}

// ─── Summary ───────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
if (fail === 0) {
  console.log(`✅ All tests passed (${pass}/${pass})`);
  process.exit(0);
} else {
  console.log(`❌ ${fail} test(s) failed, ${pass} passed`);
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exit(1);
}
