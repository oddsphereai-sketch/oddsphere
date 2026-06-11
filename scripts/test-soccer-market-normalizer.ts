/**
 * Tests for the soccer market + selection normalizers (WC-2).
 *
 * Pure-function tests — no HTTP, no DB.
 */

import {
  normalizeSharpApiMarketType,
  normalizeBdlMarket,
  normalizeMatchResultSelection,
  normalizeDoubleChanceSelection,
  normalizeTotalSelection,
  normalizeBttsSelection,
  validateNormalizedRecord,
  isNonTrackedSoccerMarketType,
  OFFICIAL_SOCCER_MARKETS,
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

console.log("\nscripts/test-soccer-market-normalizer.ts");
console.log("─".repeat(60));

// ─── SharpAPI market_type normalization ────────────────────────────────

test("SharpAPI moneyline → match_result", () => {
  assert(normalizeSharpApiMarketType("moneyline") === "match_result", "moneyline should map to match_result");
});
test("SharpAPI total_goals → total", () => {
  assert(normalizeSharpApiMarketType("total_goals") === "total", "total_goals should map to total");
});
test("SharpAPI both_teams_to_score → btts", () => {
  assert(normalizeSharpApiMarketType("both_teams_to_score") === "btts", "BTTS map");
});
test("SharpAPI double_chance → double_chance", () => {
  assert(normalizeSharpApiMarketType("double_chance") === "double_chance", "DC map");
});

const nonTrackedSharpMarkets = [
  "point_spread",
  "draw_no_bet",
  "team_total_goals",
  "team_total_corners",
  "team_total_cards",
  "team_total_shots",
  "1st_half_moneyline_3-way",
  "1st_half_total_goals",
  "1st_half_both_teams_to_score",
  "2nd_half_both_teams_to_score",
  "match_result_both_teams_to_score",
  "anytime_goal_scorer",
  "anytime_goal_scorer_by_header",
  "player_goals",
  "player_to_score_or_assist",
  "first_team_to_score",
  "to_win_either_half",
  "team_clean_sheet",
  "total_cards",
  "total_corners",
  "total_shots",
  "will_there_be_a_penalty",
  "championship_winner",
  "tournament_winner",
  "outright",
];
test("SharpAPI: every non-tracked market returns null from normalizeSharpApiMarketType", () => {
  for (const m of nonTrackedSharpMarkets) {
    assert(normalizeSharpApiMarketType(m) === null, `${m} must be null`);
  }
});
test("isNonTrackedSoccerMarketType flags non-tracked markets", () => {
  for (const m of nonTrackedSharpMarkets) {
    assert(isNonTrackedSoccerMarketType(m) === true, `${m} should be flagged as non-tracked`);
  }
});
test("isNonTrackedSoccerMarketType does NOT flag official tracked markets", () => {
  for (const m of ["moneyline", "total_goals", "both_teams_to_score", "double_chance"]) {
    assert(isNonTrackedSoccerMarketType(m) === false, `${m} should NOT be flagged`);
  }
});

// ─── BDL market normalization ──────────────────────────────────────────

test("BDL type=moneyline → match_result", () => {
  assert(normalizeBdlMarket({ type: "moneyline" }) === "match_result", "BDL moneyline maps");
});
test("BDL type=total, period=match, scope=match → total", () => {
  assert(normalizeBdlMarket({ type: "total", period: "match", scope: "match" }) === "total", "BDL match total maps");
});
test("BDL type=total, scope=home_team → null (team total)", () => {
  assert(normalizeBdlMarket({ type: "total", period: "match", scope: "home_team" }) === null, "team total drops");
});
test("BDL type=total, scope=away_team → null", () => {
  assert(normalizeBdlMarket({ type: "total", period: "match", scope: "away_team" }) === null, "away team total drops");
});
test("BDL type=total, period=1st_half → null", () => {
  assert(normalizeBdlMarket({ type: "total", period: "1st_half", scope: "match" }) === null, "1st half total drops");
});
test("BDL type=total, name contains '1st Half' → null", () => {
  assert(normalizeBdlMarket({ type: "total", name: "1st Half Over/Under 2.5 Goals", period: null, scope: null }) === null);
});
test("BDL type=both_teams_to_score → btts (match-level)", () => {
  assert(normalizeBdlMarket({ type: "both_teams_to_score", period: "match", scope: "match" }) === "btts", "BTTS maps");
});
test("BDL type=both_teams_to_score, name='Both Teams to Score - 1st Half' → null", () => {
  assert(normalizeBdlMarket({ type: "both_teams_to_score", name: "Both Teams to Score - 1st Half", period: null, scope: null }) === null);
});
test("BDL type=double_chance → double_chance", () => {
  assert(normalizeBdlMarket({ type: "double_chance", period: "match", scope: "match" }) === "double_chance", "DC maps");
});
test("BDL type=spread → null", () => {
  assert(normalizeBdlMarket({ type: "spread", period: "match", scope: "match" }) === null, "spread drops");
});
test("BDL type=correct_score → null", () => {
  assert(normalizeBdlMarket({ type: "correct_score", period: "match", scope: "match" }) === null, "correct score drops");
});
test("BDL type=margin → null", () => {
  assert(normalizeBdlMarket({ type: "margin" }) === null);
});
test("BDL type=other → null", () => {
  assert(normalizeBdlMarket({ type: "other" }) === null);
});
test("BDL type=timing → null", () => {
  assert(normalizeBdlMarket({ type: "timing" }) === null);
});

// ─── Selection normalization ───────────────────────────────────────────

const mexicoRsa = { home_team: "Mexico", away_team: "South Africa" };
const curacaoGermany = { home_team: "Curacao", away_team: "Germany" };
const saoTomeWithDiacritics = { home_team: "São Tomé and Príncipe", away_team: "Algeria" };

test("Match Result: home name → home", () => {
  assert(normalizeMatchResultSelection("Mexico", mexicoRsa) === "home", "Mexico→home");
});
test("Match Result: away name → away", () => {
  assert(normalizeMatchResultSelection("South Africa", mexicoRsa) === "away", "South Africa→away");
});
test("Match Result: 'Draw' → draw", () => {
  assert(normalizeMatchResultSelection("Draw", mexicoRsa) === "draw", "Draw→draw");
});
test("Match Result: 'X' → draw", () => {
  assert(normalizeMatchResultSelection("X", mexicoRsa) === "draw", "X→draw");
});
test("Match Result: '1' → home, '2' → away", () => {
  assert(normalizeMatchResultSelection("1", mexicoRsa) === "home");
  assert(normalizeMatchResultSelection("2", mexicoRsa) === "away");
});
test("Match Result: case-insensitive team name", () => {
  assert(normalizeMatchResultSelection("MEXICO", mexicoRsa) === "home");
});
test("Match Result: diacritics tolerated", () => {
  assert(normalizeMatchResultSelection("Sao Tome and Principe", saoTomeWithDiacritics) === "home", "ASCII fold");
});
test("Match Result: unknown selection → null", () => {
  assert(normalizeMatchResultSelection("Argentina", mexicoRsa) === null);
});

test("Double Chance: '1X' → home_or_draw", () => {
  assert(normalizeDoubleChanceSelection("1X", mexicoRsa) === "home_or_draw");
});
test("Double Chance: 'X2' → away_or_draw", () => {
  assert(normalizeDoubleChanceSelection("X2", mexicoRsa) === "away_or_draw");
});
test("Double Chance: '12' → home_or_away", () => {
  assert(normalizeDoubleChanceSelection("12", mexicoRsa) === "home_or_away");
});
test("Double Chance: 'Mexico/Draw' → home_or_draw", () => {
  assert(normalizeDoubleChanceSelection("Mexico/Draw", mexicoRsa) === "home_or_draw");
});
test("Double Chance: 'Mexico or Draw' → home_or_draw", () => {
  assert(normalizeDoubleChanceSelection("Mexico or Draw", mexicoRsa) === "home_or_draw");
});
test("Double Chance: 'South Africa / Draw' → away_or_draw", () => {
  assert(normalizeDoubleChanceSelection("South Africa / Draw", mexicoRsa) === "away_or_draw");
});
test("Double Chance: 'Mexico / South Africa' → home_or_away", () => {
  assert(normalizeDoubleChanceSelection("Mexico / South Africa", mexicoRsa) === "home_or_away");
});

// ─── Live BDL phrasing (captured 2026-06-11 via /fifa/worldcup/v1/odds).
//     BDL uses " And " as the separator (e.g., "Mexico And Draw") rather
//     than "/" or "or". These tests lock that shape into the regression
//     suite so a future BDL rename or live drift fails loudly.
test("Double Chance (BDL live shape): 'Mexico And Draw' → home_or_draw", () => {
  assert(normalizeDoubleChanceSelection("Mexico And Draw", mexicoRsa) === "home_or_draw");
});
test("Double Chance (BDL live shape): 'South Africa And Draw' → away_or_draw", () => {
  assert(normalizeDoubleChanceSelection("South Africa And Draw", mexicoRsa) === "away_or_draw");
});
test("Double Chance (BDL live shape): 'Mexico And South Africa' → home_or_away", () => {
  assert(normalizeDoubleChanceSelection("Mexico And South Africa", mexicoRsa) === "home_or_away");
});
test("Double Chance (BDL live shape): cross-vendor example 'Ivory Coast And Draw' → home_or_draw", () => {
  assert(normalizeDoubleChanceSelection("Ivory Coast And Draw", { home_team: "Ivory Coast", away_team: "Ecuador" }) === "home_or_draw");
});
test("Double Chance (BDL live shape): cross-vendor example 'Ivory Coast And Ecuador' → home_or_away", () => {
  assert(normalizeDoubleChanceSelection("Ivory Coast And Ecuador", { home_team: "Ivory Coast", away_team: "Ecuador" }) === "home_or_away");
});
test("Double Chance (BDL live shape): team name containing 'and' ('Trinidad And Tobago') still maps correctly", () => {
  // Defensive — Trinidad & Tobago aren't at the 2026 WC but the team-name
  // containing-and case is a real risk for future competitions. The
  // normalizer matches on substring presence, not the literal "And"
  // separator, so this case must still resolve.
  const ctx = { home_team: "Trinidad And Tobago", away_team: "South Africa" };
  assert(normalizeDoubleChanceSelection("Trinidad And Tobago And Draw", ctx) === "home_or_draw");
  assert(normalizeDoubleChanceSelection("Trinidad And Tobago And South Africa", ctx) === "home_or_away");
  assert(normalizeDoubleChanceSelection("South Africa And Draw", ctx) === "away_or_draw");
});
test("Double Chance: unknown → null", () => {
  assert(normalizeDoubleChanceSelection("Frobnicate", mexicoRsa) === null);
});

test("Total: 'Over' → over", () => {
  assert(normalizeTotalSelection("Over") === "over");
});
test("Total: 'Under' → under", () => {
  assert(normalizeTotalSelection("Under") === "under");
});
test("Total: 'Over 2.5' → over", () => {
  assert(normalizeTotalSelection("Over 2.5") === "over");
});
test("Total: 'Frobnicate' → null", () => {
  assert(normalizeTotalSelection("Frobnicate") === null);
});

test("BTTS: 'Yes' → yes", () => {
  assert(normalizeBttsSelection("Yes") === "yes");
});
test("BTTS: 'No' → no", () => {
  assert(normalizeBttsSelection("No") === "no");
});
test("BTTS: 'Maybe' → null", () => {
  assert(normalizeBttsSelection("Maybe") === null);
});

// ─── Validation ────────────────────────────────────────────────────────

test("validateNormalizedRecord: rejects total without line", () => {
  const r = validateNormalizedRecord({
    market: "total",
    selection: "over",
    line: null,
    odds_american: -110,
    odds_decimal: null,
    sportsbook: "fanduel",
    provider: "bdl",
    provider_endpoint: "/fifa/worldcup/v1/odds",
    fetched_at: new Date().toISOString(),
    provider_event_id: null,
  });
  assert(r === null, "total without line must be rejected");
});

test("validateNormalizedRecord: rejects record with both odds null", () => {
  const r = validateNormalizedRecord({
    market: "match_result",
    selection: "home",
    line: null,
    odds_american: null,
    odds_decimal: null,
    sportsbook: "fanduel",
    provider: "bdl",
    provider_endpoint: "/fifa/worldcup/v1/odds",
    fetched_at: new Date().toISOString(),
    provider_event_id: null,
  });
  assert(r === null, "no odds must be rejected");
});

test("validateNormalizedRecord: accepts a clean total over 2.5 row", () => {
  const r = validateNormalizedRecord({
    market: "total",
    selection: "over",
    line: 2.5,
    odds_american: -110,
    odds_decimal: 1.909,
    sportsbook: "fanduel",
    provider: "bdl",
    provider_endpoint: "/fifa/worldcup/v1/odds",
    fetched_at: new Date().toISOString(),
    provider_event_id: "bdl_match_1",
  });
  assert(r !== null, "clean record must validate");
});

test("OFFICIAL_SOCCER_MARKETS contains exactly the four launch markets", () => {
  assert(OFFICIAL_SOCCER_MARKETS.length === 4, "must be exactly 4");
  for (const m of ["match_result", "double_chance", "total", "btts"]) {
    assert(OFFICIAL_SOCCER_MARKETS.includes(m as never), `must include ${m}`);
  }
});

console.log("\n" + "━".repeat(60));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("❌ soccer-market-normalizer tests FAILED");
  process.exit(1);
}
console.log(`✅ All ${pass} tests passed.`);
