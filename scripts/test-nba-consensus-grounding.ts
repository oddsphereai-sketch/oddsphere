/**
 * NBA-P0 — consensus + grounding unit tests.
 *
 *   1. Fliff flipped-ML is rejected (contradicts spread-implied favorite).
 *   2. One book accepted + spread-confirmed → limited_spread_confirmed,
 *      grade capped (no Lean/Best Angle), confidence capped.
 *   3. Too-corrupted (no clean ML, no spread) → clean=false HOLD with reason.
 *   4. Raw vs adjusted audit: grounding keeps raw AND grounded, pulled toward
 *      market when evidence is thin (not anchored, not unmoved).
 *
 * Run: npx tsx scripts/test-nba-consensus-grounding.ts
 */
import { buildNbaMarketConsensus, type NbaBookLine } from "../lib/automodel/nba/nbaMarketConsensus";
import { groundNbaPrediction } from "../lib/automodel/nba/nbaGrounding";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`✓ ${n}`); else { failures++; console.error(`✗ ${n}${d ? " — " + d : ""}`); } };

// G5-shaped lines: fliff ML flipped (SA+385/NY-500), ballybet ML SA-205/NY+165, spreads SA -4.5/-5.5.
const g5Lines: NbaBookLine[] = [
  { sportsbook: "fliff", market_type: "moneyline", side: "home", line_value: null, odds_american: 385 },
  { sportsbook: "fliff", market_type: "moneyline", side: "away", line_value: null, odds_american: -500 },
  { sportsbook: "ballybet", market_type: "moneyline", side: "home", line_value: null, odds_american: -205 },
  { sportsbook: "ballybet", market_type: "moneyline", side: "away", line_value: null, odds_american: 165 },
  { sportsbook: "onexbet", market_type: "spread", side: "home", line_value: -4.5, odds_american: -113 },
  { sportsbook: "fliff", market_type: "spread", side: "home", line_value: -5.5, odds_american: -105 },
  { sportsbook: "onexbet", market_type: "total", side: "over", line_value: 215.5, odds_american: -108 },
  { sportsbook: "fliff", market_type: "total", side: "over", line_value: 216.5, odds_american: -110 },
];

// 1 — fliff flipped ML rejected.
const c1 = buildNbaMarketConsensus(g5Lines);
ok("1. fliff ML rejected", c1.mlRejectedBooks.some((r) => r.book === "fliff"));
ok("1. ballybet ML accepted", c1.mlAcceptedBooks.includes("ballybet"));
ok("1. clean baseline formed", c1.clean === true);
ok("1. spread favorite = home (SA)", c1.spreadImpliedFavorite === "home");
ok("1. consensus ML home ~64%", Math.abs((c1.mlHomeNoVig ?? 0) - 0.64) < 0.03);

// 2 — one book + spread confirmed → limited, capped.
ok("2. consensus_strength = limited_spread_confirmed", c1.consensusStrength === "limited_spread_confirmed");
ok("2. spread_confirmation true", c1.spreadConfirmation === true);
const g2 = groundNbaPrediction({
  rawHomeScore: 115.4, rawAwayScore: 113.0, consensusSpreadHome: c1.spreadHome, consensusTotal: c1.totalLine,
  consensusHomeMlNoVig: c1.mlHomeNoVig, mlIsSpreadImpliedFallback: false, consensusStrength: c1.consensusStrength,
  tier: "medium", injuryHomePts: 0, injuryAwayPts: 0, injuriesKnown: false,
});
ok("2. confidence capped ≤58", g2.confidence <= 58);
ok("2. NOT lean/best_angle (limited consensus)", g2.playGrade !== "lean");
ok("2. grade is market_aligned or watch", g2.playGrade === "market_aligned" || g2.playGrade === "watch");

// 3 — too corrupted → HOLD. Only an incomplete ML pair, no spread/total.
const corrupt: NbaBookLine[] = [
  { sportsbook: "fliff", market_type: "moneyline", side: "home", line_value: null, odds_american: -200 },
];
const c3 = buildNbaMarketConsensus(corrupt);
ok("3. corrupted/incomplete → clean=false", c3.clean === false);
ok("3. hold reason present", typeof c3.holdReason === "string" && c3.holdReason!.length > 0);
ok("3. mlHomeNoVig null", c3.mlHomeNoVig === null);

// 4 — raw vs adjusted audit: raw far from market → grounded between, both present.
const g4 = groundNbaPrediction({
  rawHomeScore: 120, rawAwayScore: 108, // raw total 228, margin +12 (model loves home)
  consensusSpreadHome: -5, consensusTotal: 216.5, consensusHomeMlNoVig: 0.64,
  mlIsSpreadImpliedFallback: false, consensusStrength: "multi_book",
  tier: "high", injuryHomePts: 0, injuryAwayPts: 0, injuriesKnown: true,
});
ok("4. raw total preserved (228)", g4.rawTotal === 228);
ok("4. grounded total pulled toward market (between 216.5 and 228)", g4.groundedTotal > 216.5 && g4.groundedTotal < 228);
ok("4. grounded != raw (model moved toward market)", g4.groundedTotal !== g4.rawTotal);
ok("4. NOT anchored (grounded total still above market — keeps own view)", g4.groundedTotal > 216.5);
ok("4. raw margin preserved (+12)", g4.rawMargin === 12);
ok("4. regularized prob present + bounded", g4.mlHomeProbRegularized > 0.5 && g4.mlHomeProbRegularized <= 1);

if (failures > 0) { console.error(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nAll NBA consensus + grounding assertions passed.");
