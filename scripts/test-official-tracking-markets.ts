/**
 * Tests for lib/config/officialTrackingMarkets.ts — single source of
 * truth registry for public-tracking vs context-only display.
 *
 * P1-1 (2026-06-10) — codifies the corrected product direction:
 *   • Public tracking markets per sport:
 *       MLB: moneyline, total, first_inning
 *       NBA: moneyline, total
 *       NHL: moneyline, total
 *       WNBA: moneyline, total, spread
 *   • Context-only displayed markets per sport:
 *       NBA: spread (rendered in DailyEdgeShell as `Sprd*`)
 *       NHL: spread (rendered in DailyEdgeShell as `PL*`; puck-line
 *            is stored under market_type="spread")
 *   • Other sports (CBB, UCL): empty until intentional
 *     product launch.
 *   • Unknown / unregistered (sport, market) tuples FAIL CLOSED
 *     (return false from both `isOfficiallyTrackedMarket` and
 *     `isContextOnlyDisplayMarket`).
 */
import {
  OFFICIAL_TRACKING_MARKETS,
  CONTEXT_ONLY_DISPLAY_MARKETS,
  isOfficiallyTrackedMarket,
  isContextOnlyDisplayMarket,
  getOfficialTrackingMarkets,
  getContextOnlyDisplayMarkets,
  assertOfficialTrackingMarket,
} from "../lib/config/officialTrackingMarkets";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n━━━ Official public tracking market registry (P1-1) ━━━");

// MLB — moneyline, total, first_inning are officially tracked
check("MLB moneyline officially tracked", isOfficiallyTrackedMarket("mlb", "moneyline") === true);
check("MLB total officially tracked", isOfficiallyTrackedMarket("mlb", "total") === true);
check("MLB first_inning officially tracked", isOfficiallyTrackedMarket("mlb", "first_inning") === true);
check("MLB spread NOT officially tracked", isOfficiallyTrackedMarket("mlb", "spread") === false);
check("MLB context-only is empty", getContextOnlyDisplayMarkets("mlb").length === 0);

// NBA — moneyline + total tracked; spread is context-only
check("NBA moneyline officially tracked", isOfficiallyTrackedMarket("nba", "moneyline") === true);
check("NBA total officially tracked", isOfficiallyTrackedMarket("nba", "total") === true);
check("NBA spread NOT officially tracked", isOfficiallyTrackedMarket("nba", "spread") === false);
check("NBA spread IS context-only display", isContextOnlyDisplayMarket("nba", "spread") === true);
check("NBA first_inning NOT officially tracked", isOfficiallyTrackedMarket("nba", "first_inning") === false);

// NHL — moneyline + total tracked; spread (puck-line) is context-only
check("NHL moneyline officially tracked", isOfficiallyTrackedMarket("nhl", "moneyline") === true);
check("NHL total officially tracked", isOfficiallyTrackedMarket("nhl", "total") === true);
check("NHL spread (puck-line) NOT officially tracked", isOfficiallyTrackedMarket("nhl", "spread") === false);
check("NHL spread (puck-line) IS context-only display", isContextOnlyDisplayMarket("nhl", "spread") === true);
check("NHL first_inning NOT officially tracked", isOfficiallyTrackedMarket("nhl", "first_inning") === false);

// NFL — forward-only 2026 launch markets; preseason remains excluded by its
// separate lifecycle and public-start boundary.
check("NFL tracks moneyline, total, and spread from the 2026 regular season", JSON.stringify(getOfficialTrackingMarkets("nfl")) === JSON.stringify(["moneyline", "total", "spread"]));
check("NFL has empty context-only registry", getContextOnlyDisplayMarkets("nfl").length === 0);
check("NFL moneyline officially tracked", isOfficiallyTrackedMarket("nfl", "moneyline") === true);
check("NFL total officially tracked", isOfficiallyTrackedMarket("nfl", "total") === true);
check("NFL spread officially tracked", isOfficiallyTrackedMarket("nfl", "spread") === true);
check("CFB tracks moneyline, total, and spread from opening week", JSON.stringify(getOfficialTrackingMarkets("cfb")) === JSON.stringify(["moneyline", "total", "spread"]));
check("CFB has empty context-only registry", getContextOnlyDisplayMarkets("cfb").length === 0);
check("CFB moneyline officially tracked", isOfficiallyTrackedMarket("cfb", "moneyline") === true);
check("CFB total officially tracked", isOfficiallyTrackedMarket("cfb", "total") === true);
check("CFB spread officially tracked", isOfficiallyTrackedMarket("cfb", "spread") === true);
check("UCL tracks the four regulation soccer markets", JSON.stringify(getOfficialTrackingMarkets("ucl")) === JSON.stringify(["match_result", "total", "btts", "double_chance"]));
check("CBB has empty official tracking registry", getOfficialTrackingMarkets("cbb").length === 0);

// Soccer (WC-1) — match_result/total/btts officially tracked; moneyline
// deliberately NOT (draw is a first-class outcome, not collapsible to 2-way).
check("Soccer match_result officially tracked", isOfficiallyTrackedMarket("soccer", "match_result") === true);
check("Soccer total officially tracked", isOfficiallyTrackedMarket("soccer", "total") === true);
check("Soccer btts officially tracked", isOfficiallyTrackedMarket("soccer", "btts") === true);
check("Soccer double_chance officially tracked", isOfficiallyTrackedMarket("soccer", "double_chance") === true);
check("Soccer moneyline NOT officially tracked (would erase draw)", isOfficiallyTrackedMarket("soccer", "moneyline") === false);
check("Soccer spread NOT officially tracked", isOfficiallyTrackedMarket("soccer", "spread") === false);
check("Soccer context-only is empty", getContextOnlyDisplayMarkets("soccer").length === 0);

// WNBA — public launch tracks moneyline + total + spread
check("WNBA moneyline officially tracked", isOfficiallyTrackedMarket("wnba", "moneyline") === true);
check("WNBA total officially tracked", isOfficiallyTrackedMarket("wnba", "total") === true);
check("WNBA spread officially tracked", isOfficiallyTrackedMarket("wnba", "spread") === true);
check("WNBA first_inning NOT officially tracked", isOfficiallyTrackedMarket("wnba", "first_inning") === false);
check("WNBA context-only is empty", getContextOnlyDisplayMarkets("wnba").length === 0);

// Fail-closed semantics — unknown market strings return false
check("Unknown market 'frobnicate' NOT tracked for any sport (MLB probe)", isOfficiallyTrackedMarket("mlb", "frobnicate") === false);
check("Unknown market 'frobnicate' NOT context-only for any sport (NBA probe)", isContextOnlyDisplayMarket("nba", "frobnicate") === false);

// Registry shape — verify constants directly
check("OFFICIAL_TRACKING_MARKETS.mlb = [moneyline, total, first_inning]",
  JSON.stringify(OFFICIAL_TRACKING_MARKETS.mlb) === JSON.stringify(["moneyline", "total", "first_inning"]));
check("OFFICIAL_TRACKING_MARKETS.nba = [moneyline, total]",
  JSON.stringify(OFFICIAL_TRACKING_MARKETS.nba) === JSON.stringify(["moneyline", "total"]));
check("OFFICIAL_TRACKING_MARKETS.nhl = [moneyline, total]",
  JSON.stringify(OFFICIAL_TRACKING_MARKETS.nhl) === JSON.stringify(["moneyline", "total"]));
check("OFFICIAL_TRACKING_MARKETS.soccer = [match_result, total, btts, double_chance]",
  JSON.stringify(OFFICIAL_TRACKING_MARKETS.soccer) === JSON.stringify(["match_result", "total", "btts", "double_chance"]));
check("OFFICIAL_TRACKING_MARKETS.wnba = [moneyline, total, spread]",
  JSON.stringify(OFFICIAL_TRACKING_MARKETS.wnba) === JSON.stringify(["moneyline", "total", "spread"]));
check("OFFICIAL_TRACKING_MARKETS.nfl = [moneyline, total, spread]",
  JSON.stringify(OFFICIAL_TRACKING_MARKETS.nfl) === JSON.stringify(["moneyline", "total", "spread"]));
check("OFFICIAL_TRACKING_MARKETS.cfb = [moneyline, total, spread]",
  JSON.stringify(OFFICIAL_TRACKING_MARKETS.cfb) === JSON.stringify(["moneyline", "total", "spread"]));
check("CONTEXT_ONLY_DISPLAY_MARKETS.nba = [spread]",
  JSON.stringify(CONTEXT_ONLY_DISPLAY_MARKETS.nba) === JSON.stringify(["spread"]));
check("CONTEXT_ONLY_DISPLAY_MARKETS.nhl = [spread]",
  JSON.stringify(CONTEXT_ONLY_DISPLAY_MARKETS.nhl) === JSON.stringify(["spread"]));

// assertOfficialTrackingMarket — happy path doesn't throw
let assertHappyOk = true;
try {
  assertOfficialTrackingMarket("mlb", "moneyline");
  assertOfficialTrackingMarket("mlb", "total");
  assertOfficialTrackingMarket("mlb", "first_inning");
  assertOfficialTrackingMarket("nba", "moneyline");
  assertOfficialTrackingMarket("nba", "total");
  assertOfficialTrackingMarket("nhl", "moneyline");
  assertOfficialTrackingMarket("nhl", "total");
  assertOfficialTrackingMarket("wnba", "moneyline");
  assertOfficialTrackingMarket("wnba", "total");
  assertOfficialTrackingMarket("wnba", "spread");
  assertOfficialTrackingMarket("nfl", "moneyline");
  assertOfficialTrackingMarket("nfl", "total");
  assertOfficialTrackingMarket("nfl", "spread");
  assertOfficialTrackingMarket("cfb", "moneyline");
  assertOfficialTrackingMarket("cfb", "total");
  assertOfficialTrackingMarket("cfb", "spread");
} catch {
  assertHappyOk = false;
}
check("assertOfficialTrackingMarket allows all officially-tracked markets", assertHappyOk);

// assertOfficialTrackingMarket — throws for NBA spread (context-only)
let assertNbaSpreadThrew = false;
let nbaSpreadErrMessage = "";
try {
  assertOfficialTrackingMarket("nba", "spread");
} catch (e: unknown) {
  assertNbaSpreadThrew = true;
  nbaSpreadErrMessage = e instanceof Error ? e.message : String(e);
}
check("assertOfficialTrackingMarket throws for NBA spread", assertNbaSpreadThrew);
check("NBA spread error mentions CONTEXT-ONLY",
  nbaSpreadErrMessage.includes("CONTEXT-ONLY"),
  `got: ${nbaSpreadErrMessage.slice(0, 200)}`);

// assertOfficialTrackingMarket — throws for NHL spread (puck-line)
let assertNhlSpreadThrew = false;
try {
  assertOfficialTrackingMarket("nhl", "spread");
} catch {
  assertNhlSpreadThrew = true;
}
check("assertOfficialTrackingMarket throws for NHL spread (puck-line)", assertNhlSpreadThrew);

// assertOfficialTrackingMarket — throws for unknown market
let assertUnknownThrew = false;
let unknownErrMessage = "";
try {
  assertOfficialTrackingMarket("mlb", "totally_made_up");
} catch (e: unknown) {
  assertUnknownThrew = true;
  unknownErrMessage = e instanceof Error ? e.message : String(e);
}
check("assertOfficialTrackingMarket throws for unknown market", assertUnknownThrew);
check("Unknown market error mentions deliberate product launch",
  unknownErrMessage.includes("product launch") || unknownErrMessage.includes("deliberate"),
  `got: ${unknownErrMessage.slice(0, 200)}`);

// Sanity — official and context-only registries must be disjoint per sport
for (const sport of ["mlb", "nba", "nhl", "nfl", "cbb", "cfb", "ucl", "soccer", "wnba"] as const) {
  const official = new Set(getOfficialTrackingMarkets(sport) as ReadonlyArray<string>);
  const context = new Set(getContextOnlyDisplayMarkets(sport));
  const intersect: string[] = [];
  for (const m of official) if (context.has(m)) intersect.push(m);
  check(`${sport.toUpperCase()} official and context-only are disjoint`,
    intersect.length === 0,
    intersect.length > 0 ? `overlap: ${intersect.join(", ")}` : undefined);
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  • ${f}`);
  console.log("\n❌ Official tracking markets registry tests FAILED.");
  process.exit(1);
}
console.log("\n✅ Official tracking markets registry tests passed.");
