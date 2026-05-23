/**
 * Unit tests for tracking models — outcomeResolver, aggregator,
 * calibrationComputer, clvCalculator.
 *
 * Run with: npm run test:tracking
 */

import {
  resolveProp,
  resolveGame,
} from "../lib/models/tracking/outcomeResolver";
import {
  computeAggregates,
  type PredictionResultRow,
} from "../lib/models/tracking/aggregator";
import {
  computeCalibration,
  type PredictionForCalibration,
} from "../lib/models/tracking/calibrationComputer";
import { computeClv } from "../lib/models/tracking/clvCalculator";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(title: string) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ─── outcomeResolver ─────────────────────────────────────────────────────
section("outcomeResolver — props");

// Judge hits over 1.5, actual 2 → win
{
  const r = resolveProp({
    prop_market: "batter_hits",
    prop_line: 1.5,
    predicted_side: "over",
    player_stat_line: { batting_h: 2 },
  });
  check("hits over 1.5, actual 2 → win", r.outcome === "win" && r.actual_value === 2);
}

// HR over 0.5, actual 0 → loss
{
  const r = resolveProp({
    prop_market: "batter_home_runs",
    prop_line: 0.5,
    predicted_side: "over",
    player_stat_line: { batting_hr: 0 },
  });
  check("HR over 0.5, actual 0 → loss", r.outcome === "loss" && r.actual_value === 0);
}

// Integer-line push: hits over 1, actual 1 → push
{
  const r = resolveProp({
    prop_market: "batter_hits",
    prop_line: 1,
    predicted_side: "over",
    player_stat_line: { batting_h: 1 },
  });
  check("hits over 1, actual 1 → push", r.outcome === "push");
}

// Under: K under 7.5, actual 5 → win
{
  const r = resolveProp({
    prop_market: "pitcher_strikeouts",
    prop_line: 7.5,
    predicted_side: "under",
    player_stat_line: { pitching_k: 5 },
  });
  check("K under 7.5, actual 5 → win", r.outcome === "win" && r.actual_value === 5);
}

// Under: K under 7.5, actual 9 → loss
{
  const r = resolveProp({
    prop_market: "pitcher_strikeouts",
    prop_line: 7.5,
    predicted_side: "under",
    player_stat_line: { pitching_k: 9 },
  });
  check("K under 7.5, actual 9 → loss", r.outcome === "loss" && r.actual_value === 9);
}

// Missing stat → defaults to 0
{
  const r = resolveProp({
    prop_market: "batter_total_bases",
    prop_line: 1.5,
    predicted_side: "over",
    player_stat_line: {}, // no TB recorded
  });
  check("TB over 1.5, no data → loss with actual=0", r.outcome === "loss" && r.actual_value === 0);
}

section("outcomeResolver — game predictions");

// Game ML home win
{
  const r = resolveGame({
    prediction_type: "game_ml",
    predicted_side: "home",
    game_outcome: { home_score: 5, away_score: 3, first_inning_total_runs: 0, total_line: 8.5 },
  });
  check("ML home, 5-3 → win", r.outcome === "win" && r.actual_value === 2);
}

// Game ML away — wrong side
{
  const r = resolveGame({
    prediction_type: "game_ml",
    predicted_side: "away",
    game_outcome: { home_score: 5, away_score: 3, first_inning_total_runs: 0, total_line: 8.5 },
  });
  check("ML away, 5-3 → loss", r.outcome === "loss");
}

// Game total over, 11 vs 8.5 line → win
{
  const r = resolveGame({
    prediction_type: "game_total",
    predicted_side: "over",
    game_outcome: { home_score: 7, away_score: 4, first_inning_total_runs: 0, total_line: 8.5 },
  });
  check("Total over 8.5, actual 11 → win", r.outcome === "win" && r.actual_value === 11);
}

// Game total under, 11 vs 8.5 → loss
{
  const r = resolveGame({
    prediction_type: "game_total",
    predicted_side: "under",
    game_outcome: { home_score: 7, away_score: 4, first_inning_total_runs: 0, total_line: 8.5 },
  });
  check("Total under 8.5, actual 11 → loss", r.outcome === "loss");
}

// NRFI (predict no run) when 0 first-inning runs → win
{
  const r = resolveGame({
    prediction_type: "game_nrfi",
    predicted_side: "nrfi",
    game_outcome: { home_score: 5, away_score: 3, first_inning_total_runs: 0, total_line: 8.5 },
  });
  check("NRFI predict, 0 first-inning runs → win", r.outcome === "win" && r.actual_value === 0);
}

// NRFI (predict no run) when 2 first-inning runs → loss
{
  const r = resolveGame({
    prediction_type: "game_nrfi",
    predicted_side: "nrfi",
    game_outcome: { home_score: 5, away_score: 3, first_inning_total_runs: 2, total_line: 8.5 },
  });
  check("NRFI predict, 2 first-inning runs → loss", r.outcome === "loss" && r.actual_value === 2);
}

// YRFI (predict yes run) when 2 first-inning runs → win
{
  const r = resolveGame({
    prediction_type: "game_nrfi",
    predicted_side: "yrfi",
    game_outcome: { home_score: 5, away_score: 3, first_inning_total_runs: 2, total_line: 8.5 },
  });
  check("YRFI predict, 2 first-inning runs → win", r.outcome === "win");
}

// ─── aggregator ──────────────────────────────────────────────────────────
section("aggregator");

const TODAY = "2026-05-22";
const SEASON_START = "2026-03-28";

// Synthetic dataset
const sample: PredictionResultRow[] = [
  // ml — 4 wins / 3 losses / 1 push in season
  { sport: "mlb", market: "ml", outcome: "win", game_date: "2026-05-21" }, // yesterday
  { sport: "mlb", market: "ml", outcome: "loss", game_date: "2026-05-20" }, // this_week
  { sport: "mlb", market: "ml", outcome: "win", game_date: "2026-05-19" }, // this_week
  { sport: "mlb", market: "ml", outcome: "push", game_date: "2026-05-15" }, // this_week
  { sport: "mlb", market: "ml", outcome: "win", game_date: "2026-04-15" }, // season
  { sport: "mlb", market: "ml", outcome: "win", game_date: "2026-04-01" }, // season
  { sport: "mlb", market: "ml", outcome: "loss", game_date: "2026-03-29" }, // season
  { sport: "mlb", market: "ml", outcome: "loss", game_date: "2026-03-15" }, // pre-season → all_time only
  // total — 2 wins yesterday + this_week
  { sport: "mlb", market: "total", outcome: "win", game_date: "2026-05-21" },
  { sport: "mlb", market: "total", outcome: "win", game_date: "2026-05-18" },
];

const agg = computeAggregates(sample, { today: TODAY, seasonStart: SEASON_START });
const find = (sport: string, market: string, w: string) =>
  agg.find((r) => r.sport === sport && r.market === market && r.time_window === w);

check("agg: ml yesterday → 1 win", find("mlb", "ml", "yesterday")?.wins === 1);
{
  const r = find("mlb", "ml", "this_week");
  check("agg: ml this_week → 2W/1L/1P",
    r?.wins === 2 && r?.losses === 1 && r?.pushes === 1);
}
{
  const r = find("mlb", "ml", "season");
  check("agg: ml season → 4W/2L/1P",
    r?.wins === 4 && r?.losses === 2 && r?.pushes === 1);
}
{
  const r = find("mlb", "ml", "all_time");
  check("agg: ml all_time → 4W/3L/1P",
    r?.wins === 4 && r?.losses === 3 && r?.pushes === 1);
}
{
  // 4 wins, 2 losses, 1 push → 4/(4+2) = 66.67%
  const r = find("mlb", "ml", "season");
  check("agg: hit_rate excludes pushes from denom",
    r?.hit_rate !== null && Math.abs((r?.hit_rate ?? 0) - 66.67) < 0.01);
}
check("agg: total yesterday → 1 win", find("mlb", "total", "yesterday")?.wins === 1);
check("agg: total all_time → 2W", find("mlb", "total", "all_time")?.wins === 2);
check("agg: no rows for empty combos", agg.every((r) => r.total > 0));

// ─── calibrationComputer ─────────────────────────────────────────────────
section("calibrationComputer");

const calSample: PredictionForCalibration[] = [
  // 50 predictions @ confidence=72 → 70-80 bucket, 35 wins (70% hit rate)
  ...Array.from({ length: 50 }, (_, i) => ({
    prediction_type: "game_ml" as const,
    sport: "mlb",
    market: "ml",
    confidence: 72,
    outcome: (i < 35 ? "win" : "loss") as "win" | "loss",
    game_date: "2026-05-01",
  })),
  // 20 predictions @ confidence=82 → 80-90 bucket (below min 30 default)
  ...Array.from({ length: 20 }, (_, i) => ({
    prediction_type: "game_ml" as const,
    sport: "mlb",
    market: "ml",
    confidence: 82,
    outcome: (i < 18 ? "win" : "loss") as "win" | "loss",
    game_date: "2026-05-01",
  })),
];

const cal = computeCalibration(calSample, {
  today: TODAY,
  seasonStart: SEASON_START,
});

const cal70 = cal.find(
  (b) => b.confidence_bucket_lower === 70 && b.time_window === "all_time"
);
const cal80 = cal.find(
  (b) => b.confidence_bucket_lower === 80 && b.time_window === "all_time"
);

check("cal: 70-80 bucket has 50 samples", cal70?.sample_count === 50);
check("cal: 70-80 bucket hit_rate = 70%", cal70?.hit_rate === 70);
check("cal: 80-90 bucket has 20 samples (below min)", cal80?.sample_count === 20);
check("cal: 80-90 bucket hit_rate is null (n < 30)", cal80?.hit_rate === null);

// Confidence < 50 excluded
const calLow: PredictionForCalibration[] = [
  {
    prediction_type: "prop",
    sport: "mlb",
    market: "prop_hits",
    confidence: 30,
    outcome: "win",
    game_date: "2026-05-01",
  },
];
const calLowResult = computeCalibration(calLow, { today: TODAY, seasonStart: SEASON_START });
check(
  "cal: confidence < 50 produces no buckets",
  calLowResult.filter((b) => b.confidence_bucket_lower < 50).length === 0 && calLowResult.length === 0
);

// ─── clvCalculator ───────────────────────────────────────────────────────
section("clvCalculator");

// Within silence window → null
{
  const r = computeClv({
    bet_odds_american: -120,
    closing_odds_american: -130,
    game_date: "2026-05-10",
    today: "2026-05-22", // 12 days ago — within 30-day window
  });
  check("CLV within silence window → null", r.clv_pct === null && r.beat_closing_line === null);
}

// Beyond silence window, beat the close (got better odds)
{
  // bet at -120 (implied 0.545), closing at -150 (implied 0.600)
  // We got 0.545 implied, closing was 0.600 → diff = 0.055 → clv_pct = +5.5
  // (Positive = we got better odds than close = beat the line)
  const r = computeClv({
    bet_odds_american: -120,
    closing_odds_american: -150,
    game_date: "2026-03-01", // > 30 days ago
    today: "2026-05-22",
  });
  check("CLV beat close: -120 bet vs -150 close → positive", (r.clv_pct ?? -1) > 0);
  check("  beat_closing_line = true", r.beat_closing_line === true);
}

// Beyond silence window, lost the close (worse odds)
{
  // bet at -150 (implied 0.600), closing at -120 (implied 0.545)
  // We got 0.600 implied, closing was 0.545 → diff = -0.055 → clv_pct = -5.5
  const r = computeClv({
    bet_odds_american: -150,
    closing_odds_american: -120,
    game_date: "2026-03-01",
    today: "2026-05-22",
  });
  check("CLV lost close: -150 bet vs -120 close → negative", (r.clv_pct ?? 1) < 0);
  check("  beat_closing_line = false", r.beat_closing_line === false);
}

// Missing closing → null
{
  const r = computeClv({
    bet_odds_american: -120,
    closing_odds_american: null,
    game_date: "2026-03-01",
    today: "2026-05-22",
  });
  check("CLV missing closing → null", r.clv_pct === null && r.beat_closing_line === null);
}

// At exactly 30 days → still silent (silence window inclusive)
{
  const r = computeClv({
    bet_odds_american: -120,
    closing_odds_american: -130,
    game_date: "2026-04-22", // 30 days ago
    today: "2026-05-22",
  });
  check("CLV at exactly 30 days → still silent", r.clv_pct === null);
}

// At 31 days → published
{
  const r = computeClv({
    bet_odds_american: -120,
    closing_odds_american: -130,
    game_date: "2026-04-21", // 31 days ago
    today: "2026-05-22",
  });
  check("CLV at 31 days → published", r.clv_pct !== null);
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log("\n✅ All tracking tests passed.");
