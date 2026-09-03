/**
 * WC-2 tracking-scope invariant test.
 *
 * Locks the WC-1 public-tracking contract: soccer official tracked
 * markets must remain exactly `match_result`, `double_chance`, `total`,
 * `btts` AFTER all WC-2 provider/normalizer changes. If a future change
 * silently widens or shrinks the official soccer registry, this test
 * fails loudly so the operator notices.
 *
 * Also locks the inverse: every market that WC-2 ingests but treats as
 * "non-tracked" (point_spread, draw_no_bet, team_total_*, props, etc.)
 * must NOT appear in the official registry — these are model context
 * only.
 */

import {
  OFFICIAL_TRACKING_MARKETS,
  getContextOnlyDisplayMarkets,
  isOfficiallyTrackedMarket,
} from "../lib/config/officialTrackingMarkets";
import {
  OFFICIAL_SOCCER_MARKETS,
  isNonTrackedSoccerMarketType,
} from "../lib/providers/real_api/_soccerMarketNormalizer";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`);
}
function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }
}

console.log("\nscripts/test-wc2-tracking-scope-invariant.ts");
console.log("─".repeat(60));

// ─── 1. Soccer tracked markets exactly the four launch markets ──────

test("soccer registry has exactly: match_result, total, btts, double_chance", () => {
  const soccer = OFFICIAL_TRACKING_MARKETS.soccer;
  assert(soccer.length === 4, `soccer registry must be 4 markets, got ${soccer.length}`);
  for (const m of ["match_result", "total", "btts", "double_chance"]) {
    assert((soccer as ReadonlyArray<string>).includes(m), `must include ${m}`);
  }
});

test("OFFICIAL_SOCCER_MARKETS const matches OFFICIAL_TRACKING_MARKETS.soccer", () => {
  const a = [...OFFICIAL_SOCCER_MARKETS].sort();
  const b = [...OFFICIAL_TRACKING_MARKETS.soccer].sort();
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `normalizer whitelist (${a.join(",")}) must equal registry (${b.join(",")})`,
  );
});

test("soccer context-only registry is empty (no displayed-but-not-tracked markets at launch)", () => {
  assert(getContextOnlyDisplayMarkets("soccer").length === 0, "soccer has no context-only markets");
});

test("soccer 'moneyline' is NOT officially tracked (would erase draw)", () => {
  assert(isOfficiallyTrackedMarket("soccer", "moneyline") === false, "moneyline must remain non-tracked");
});

test("soccer 'spread' is NOT officially tracked", () => {
  assert(isOfficiallyTrackedMarket("soccer", "spread") === false);
});

test("soccer 'point_spread' is NOT officially tracked", () => {
  assert(isOfficiallyTrackedMarket("soccer", "point_spread") === false);
});

test("soccer 'draw_no_bet' is NOT officially tracked", () => {
  assert(isOfficiallyTrackedMarket("soccer", "draw_no_bet") === false);
});

test("soccer 'team_total_goals' is NOT officially tracked", () => {
  assert(isOfficiallyTrackedMarket("soccer", "team_total_goals") === false);
});

test("soccer 'first_half_total_goals' is NOT officially tracked", () => {
  assert(isOfficiallyTrackedMarket("soccer", "first_half_total_goals") === false);
});

test("soccer 'anytime_goal_scorer' is NOT officially tracked", () => {
  assert(isOfficiallyTrackedMarket("soccer", "anytime_goal_scorer") === false);
});

test("soccer 'championship_winner' is NOT officially tracked", () => {
  assert(isOfficiallyTrackedMarket("soccer", "championship_winner") === false);
});

// ─── 2. Cross-check the normalizer denies every non-tracked market ──

const nonTrackedMarkets = [
  "point_spread", "spread", "draw_no_bet",
  "team_total_goals", "team_total_corners", "team_total_cards", "team_total_shots",
  "total_cards", "total_corners", "total_shots", "total_offsides",
  "1st_half_moneyline_3-way", "1st_half_total_goals", "1st_half_both_teams_to_score",
  "2nd_half_both_teams_to_score", "match_result_both_teams_to_score",
  "anytime_goal_scorer", "anytime_goal_scorer_by_header",
  "player_goals", "player_to_score_or_assist",
  "first_team_to_score", "to_win_either_half", "team_clean_sheet",
  "will_there_be_a_penalty",
  "championship_winner", "tournament_winner", "outright",
  "to_lift_trophy", "to_win_outright",
  "group_winner", "group_qualification", "stage_of_elimination",
  "to_reach_final", "to_reach_semifinal",
  "golden_boot", "golden_ball", "top_goalscorer",
  "correct_score",
];

test("every non-tracked market is flagged by isNonTrackedSoccerMarketType", () => {
  for (const m of nonTrackedMarkets) {
    assert(isNonTrackedSoccerMarketType(m) === true, `expected non-tracked: ${m}`);
  }
});

test("every non-tracked market is NOT in the official soccer registry", () => {
  for (const m of nonTrackedMarkets) {
    assert(isOfficiallyTrackedMarket("soccer", m) === false, `${m} must not be tracked`);
  }
});

// ─── 3. MLB / NBA / NHL registries unchanged ────────────────────────

test("MLB tracked markets unchanged: moneyline, total, first_inning", () => {
  const mlb = [...OFFICIAL_TRACKING_MARKETS.mlb].sort();
  assert(JSON.stringify(mlb) === JSON.stringify(["first_inning", "moneyline", "total"]), `MLB drifted: ${mlb.join(",")}`);
});

test("NBA tracked markets unchanged: moneyline, total", () => {
  const nba = [...OFFICIAL_TRACKING_MARKETS.nba].sort();
  assert(JSON.stringify(nba) === JSON.stringify(["moneyline", "total"]), `NBA drifted: ${nba.join(",")}`);
});

test("NHL tracked markets unchanged: moneyline, total", () => {
  const nhl = [...OFFICIAL_TRACKING_MARKETS.nhl].sort();
  assert(JSON.stringify(nhl) === JSON.stringify(["moneyline", "total"]), `NHL drifted: ${nhl.join(",")}`);
});

test("UCL launches the shared four soccer markets while CBB remains empty", () => {
  const ucl = [...OFFICIAL_TRACKING_MARKETS.ucl].sort();
  assert(JSON.stringify(ucl) === JSON.stringify(["btts", "double_chance", "match_result", "total"]), `UCL drifted: ${ucl.join(",")}`);
  assert(OFFICIAL_TRACKING_MARKETS.cbb.length === 0, "cbb should be empty");
});

test("CFB launch registry carries moneyline, total, and spread", () => {
  const cfb = [...OFFICIAL_TRACKING_MARKETS.cfb].sort();
  assert(JSON.stringify(cfb) === JSON.stringify(["moneyline", "spread", "total"]), `CFB drifted: ${cfb.join(",")}`);
});

test("NFL launch registry carries moneyline, total, and spread", () => {
  const nfl = [...OFFICIAL_TRACKING_MARKETS.nfl].sort();
  assert(JSON.stringify(nfl) === JSON.stringify(["moneyline", "spread", "total"]), `NFL drifted: ${nfl.join(",")}`);
});

console.log("\n" + "━".repeat(60));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("❌ wc2-tracking-scope-invariant FAILED");
  process.exit(1);
}
console.log(`✅ All ${pass} tests passed.`);
