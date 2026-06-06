/**
 * Push 2 tests — SharpAPI row-level mapping helpers (mapMarketType,
 * mapSide, classifyBookQuality, aggregateBookQuality, hasTwoSidedPair).
 *
 * These helpers are exported from SharpAPIOddsProvider + the new
 * sharpApiMarketCoverage utility so the primary ingest and the
 * slate-driven fallback share the exact same row-level filtering
 * rules. Locking the behavior in tests prevents quiet drift between
 * the two paths.
 */

import {
  asNumberOrNull,
  asStringOrNull,
  mapMarketType,
  mapSide,
} from "../lib/providers/real_api/SharpAPIOddsProvider";
import {
  classifyBookQuality,
  aggregateBookQuality,
  hasTwoSidedPairForMarket,
} from "../lib/providers/real_api/sharpApiMarketCoverage";
import type { LineRecord } from "../lib/providers/interfaces/IOddsProvider";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── mapMarketType (every supported / dropped market) ──────────────
console.log("━━━ mapMarketType — supported markets ━━━");
check('moneyline → "moneyline"', mapMarketType("moneyline") === "moneyline");
check('h2h → "moneyline"', mapMarketType("h2h") === "moneyline");
check('ml → "moneyline"', mapMarketType("ml") === "moneyline");
check('total → "total"', mapMarketType("total") === "total");
check('total_runs → "total"', mapMarketType("total_runs") === "total");
check('totals → "total"', mapMarketType("totals") === "total");
check('over_under → "total"', mapMarketType("over_under") === "total");
check('ou → "total"', mapMarketType("ou") === "total");
check('spread → "spread"', mapMarketType("spread") === "spread");
check('runline → "spread"', mapMarketType("runline") === "spread");
check('run_line → "spread"', mapMarketType("run_line") === "spread");
check('first_inning_total → "first_inning_total"', mapMarketType("first_inning_total") === "first_inning_total");
check('1st_inning_total → "first_inning_total"', mapMarketType("1st_inning_total") === "first_inning_total");
check('1st_inning_total_runs → "first_inning_total"', mapMarketType("1st_inning_total_runs") === "first_inning_total");

console.log("\n━━━ mapMarketType — DROPS (must return null) ━━━");
// Player props
check("player_hits → null (player prop)", mapMarketType("player_hits") === null);
check("player_strikeouts → null", mapMarketType("player_strikeouts") === null);
check("player_total_bases → null", mapMarketType("player_total_bases") === null);
check("player_walks → null", mapMarketType("player_walks") === null);
check("player_hits_+_runs_+_rbis → null", mapMarketType("player_hits_+_runs_+_rbis") === null);
// F3/F5/F7 — different windows than NRFI
check("1st_3_innings_total_runs → null (F3 not F1)", mapMarketType("1st_3_innings_total_runs") === null);
check("1st_5_innings_total_runs → null (F5 not F1)", mapMarketType("1st_5_innings_total_runs") === null);
check("1st_7_innings_total_runs → null", mapMarketType("1st_7_innings_total_runs") === null);
check("1st_3_innings_run_line → null", mapMarketType("1st_3_innings_run_line") === null);
check("1st_5_innings_run_line → null", mapMarketType("1st_5_innings_run_line") === null);
check("1st_3_innings_moneyline_3-way → null (3-way)", mapMarketType("1st_3_innings_moneyline_3-way") === null);
check("1st_inning_moneyline_3-way → null (3-way at end of 1st)", mapMarketType("1st_inning_moneyline_3-way") === null);
// Team totals
check("team_total → null (team total)", mapMarketType("team_total") === null);
check("1st_3_innings_team_total → null", mapMarketType("1st_3_innings_team_total") === null);
// Other props
check("race_to_10_points → null", mapMarketType("race_to_10_points") === null);
check("game_prop → null", mapMarketType("game_prop") === null);
check("total_points_odd_even → null", mapMarketType("total_points_odd_even") === null);
// Edge cases
check("null input → null", mapMarketType(null) === null);
check("empty string → null", mapMarketType("") === null);
check("unknown string → null", mapMarketType("zzz_unknown") === null);

// ── mapSide ────────────────────────────────────────────────────────
console.log("\n━━━ mapSide ━━━");
check("home → home", mapSide("home") === "home");
check("away → away", mapSide("away") === "away");
check("over → over", mapSide("over") === "over");
check("under → under", mapSide("under") === "under");
check("yes → yes", mapSide("yes") === "yes");
check("no → no", mapSide("no") === "no");
check("HOME (uppercase) → home", mapSide("HOME") === "home");
check("undefined → null", mapSide(undefined) === null);
check("null → null", mapSide(null) === null);
check("random → null", mapSide("draw") === null);

// ── asNumberOrNull / asStringOrNull ───────────────────────────────
console.log("\n━━━ asNumberOrNull ━━━");
check("123 → 123", asNumberOrNull(123) === 123);
check("'-110' → -110", asNumberOrNull("-110") === -110);
check("null → null", asNumberOrNull(null) === null);
check("undefined → null", asNumberOrNull(undefined) === null);
check("NaN → null", asNumberOrNull(NaN) === null);
check("'abc' → null", asNumberOrNull("abc") === null);

console.log("\n━━━ asStringOrNull ━━━");
check("'foo' → 'foo'", asStringOrNull("foo") === "foo");
check("'  bar  ' → 'bar'", asStringOrNull("  bar  ") === "bar");
check("'' → null", asStringOrNull("") === null);
check("null → null", asStringOrNull(null) === null);

// ── classifyBookQuality ───────────────────────────────────────────
console.log("\n━━━ classifyBookQuality (BookQuality bucket) ━━━");
check('"draftkings" → "high"', classifyBookQuality("draftkings") === "high");
check('"DraftKings" (case insensitive) → "high"', classifyBookQuality("DraftKings") === "high");
check('"fanduel" → "high"', classifyBookQuality("fanduel") === "high");
check('"betmgm" → "high"', classifyBookQuality("betmgm") === "high");
check('"circa" → "high"', classifyBookQuality("circa") === "high");
check('"bet365 us" → "high"', classifyBookQuality("bet365 us") === "high");
check('"betrivers" → "high"', classifyBookQuality("betrivers") === "high");
check('"saba" → "normal"', classifyBookQuality("saba") === "normal");
check('"fliff" → "normal"', classifyBookQuality("fliff") === "normal");
check('"ballybet" → "normal"', classifyBookQuality("ballybet") === "normal");
check('"onexbet" → "normal"', classifyBookQuality("onexbet") === "normal");
check('"bovada" → "normal"', classifyBookQuality("bovada") === "normal");
check('"kalshi" → "low"', classifyBookQuality("kalshi") === "low");
check('"polymarket" → "low"', classifyBookQuality("polymarket") === "low");
check('"unknownbook" → "unknown"', classifyBookQuality("unknownbook") === "unknown");
check('null → "unknown"', classifyBookQuality(null) === "unknown");
check('undefined → "unknown"', classifyBookQuality(undefined) === "unknown");

// ── aggregateBookQuality ──────────────────────────────────────────
console.log("\n━━━ aggregateBookQuality — best of set ━━━");
check("['draftkings'] → 'high'", aggregateBookQuality(["draftkings"]) === "high");
check("['kalshi', 'draftkings'] → 'high' (tier-1 wins)", aggregateBookQuality(["kalshi", "draftkings"]) === "high");
check("['saba', 'kalshi'] → 'normal'", aggregateBookQuality(["saba", "kalshi"]) === "normal");
check("['kalshi'] only → 'low'", aggregateBookQuality(["kalshi"]) === "low");
check("['unknownbook'] → 'unknown'", aggregateBookQuality(["unknownbook"]) === "unknown");
check("[] → 'unknown'", aggregateBookQuality([]) === "unknown");
check("['draftkings','fanduel','circa'] → 'high' (all tier-1)", aggregateBookQuality(["draftkings","fanduel","circa"]) === "high");
check("['saba','fliff','ballybet'] → 'normal' (no high)", aggregateBookQuality(["saba","fliff","ballybet"]) === "normal");

// ── hasTwoSidedPairForMarket ──────────────────────────────────────
console.log("\n━━━ hasTwoSidedPairForMarket ━━━");
function lr(market: string, book: string, side: string, oa: number): LineRecord {
  return {
    game_external_id: 1,
    market_type: market as never,
    player_external_id: null,
    sportsbook: book as never,
    side: side as never,
    line_value: null,
    odds_american: oa,
    odds_decimal: null,
    implied_probability: null,
    ev_percent: null,
    fair_odds: null,
    is_ev_positive: null,
    fetched_at: "2026-06-06T16:00:00Z",
  };
}

{
  const oneSided: LineRecord[] = [lr("moneyline", "saba", "home", -120)];
  check("ML one-sided → false", !hasTwoSidedPairForMarket(oneSided, "moneyline" as never, "home" as never, "away" as never));
}
{
  const twoSidedSameBook: LineRecord[] = [
    lr("moneyline", "saba", "home", -120),
    lr("moneyline", "saba", "away", +110),
  ];
  check("ML two-sided same book → true", hasTwoSidedPairForMarket(twoSidedSameBook, "moneyline" as never, "home" as never, "away" as never));
}
{
  const splitAcrossBooks: LineRecord[] = [
    lr("moneyline", "saba", "home", -120),
    lr("moneyline", "fliff", "away", +110),
  ];
  check("ML split across books, no single book has both → false", !hasTwoSidedPairForMarket(splitAcrossBooks, "moneyline" as never, "home" as never, "away" as never));
}
{
  const totalsTwoSided: LineRecord[] = [
    lr("total", "ballybet", "over", -110),
    lr("total", "ballybet", "under", -110),
  ];
  check("Total two-sided same book → true", hasTwoSidedPairForMarket(totalsTwoSided, "total" as never, "over" as never, "under" as never));
}
{
  const mixedMarkets: LineRecord[] = [
    lr("moneyline", "saba", "home", -120),
    lr("moneyline", "saba", "away", +110),
    lr("total", "saba", "over", -110),
  ];
  check("Multi-market — only ML two-sided → ML=true, Total=false", hasTwoSidedPairForMarket(mixedMarkets, "moneyline" as never, "home" as never, "away" as never) && !hasTwoSidedPairForMarket(mixedMarkets, "total" as never, "over" as never, "under" as never));
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All SharpAPI market mapping tests passed.");
