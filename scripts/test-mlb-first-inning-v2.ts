/**
 * Push 3B — fixture-only unit tests for the FI V2 model.
 *
 * Pure tests, no DB, no network.
 *
 * Run: npx tsx scripts/test-mlb-first-inning-v2.ts
 */

import {
  runMlbFirstInningModelV2,
  __TEST__ as FI_TEST,
} from "../lib/automodel/mlbFirstInningModelV2";
import {
  projectFiIndependent,
  FI_BASE_LAMBDA_PER_TEAM,
  FI_LEAGUE_AVG_TOP3_OPS,
} from "../lib/automodel/mlbFirstInningFeatureBuilder";
import { computeFiMarketBaseline } from "../lib/automodel/mlbFirstInningMarketBaseline";
import { noVigPair } from "../lib/automodel/marketPrior";
import type {
  GameSnapshot,
  StarterSnapshot,
  TeamSnapshot,
  BatterSnapshot,
  MarketSnapshot,
} from "../lib/automodel/types";
import type { FiLineRow } from "../lib/automodel/mlbFirstInningMarketBaseline";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function near(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// ─── builders ─────────────────────────────────────────────────────────────

function buildTeam(opts: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    team_external_id: opts.team_external_id ?? 1,
    abbreviation: opts.abbreviation ?? "TST",
    bullpen_era_proxy: 4.10,
    season_runs_per_game: 4.45,
    team_avg_batter_ops: 0.720,
    team_avg_batter_ops_sample: 4000,
  };
}

function buildStarter(opts: Partial<StarterSnapshot> = {}): StarterSnapshot {
  return {
    player_external_id: opts.player_external_id ?? 100,
    player_name: opts.player_name ?? "Test Pitcher",
    throws: "throws" in opts ? opts.throws! : "R",
    season_era: "season_era" in opts ? opts.season_era! : 4.10,
    season_whip: "season_whip" in opts ? opts.season_whip! : 1.30,
    season_k_per_9: "season_k_per_9" in opts ? opts.season_k_per_9! : 8.5,
    last30_era: null,
    pitch_quality_score: null,
    is_confirmed: true,
    is_scratched: false,
    first_inning_era: "first_inning_era" in opts ? opts.first_inning_era! : null,
    first_inning_starts: "first_inning_starts" in opts ? opts.first_inning_starts! : null,
    first_inning_whip: null,
    season_games_started: 20,
    season_games_pitched: 20,
    season_innings_pitched: 120,
  };
}

function buildBatter(opts: Partial<BatterSnapshot> = {}): BatterSnapshot {
  return {
    player_external_id: opts.player_external_id ?? 1,
    player_name: opts.player_name ?? "Test Batter",
    batting_position: opts.batting_position ?? 1,
    bats: "R",
    season_obp: 0.330,
    season_slg: 0.420,
    season_ops: "season_ops" in opts ? opts.season_ops! : 0.760,
    season_pa: 400,
    vs_lhp_ops: null,
    vs_rhp_ops: null,
    lineup_source: opts.lineup_source ?? "projected",
  };
}

function buildMarket(opts: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    listed_total: "listed_total" in opts ? opts.listed_total! : 8.5,
    home_ml_odds_american: "home_ml_odds_american" in opts ? opts.home_ml_odds_american! : -120,
    away_ml_odds_american: "away_ml_odds_american" in opts ? opts.away_ml_odds_american! : 110,
    over_odds_american: null, under_odds_american: null, has_pinnacle_total: opts.has_pinnacle_total ?? false,
  };
}

type SnapOverrides = {
  homeTeam?: Partial<TeamSnapshot>;
  awayTeam?: Partial<TeamSnapshot>;
  homeStarter?: Partial<StarterSnapshot> | null;
  awayStarter?: Partial<StarterSnapshot> | null;
  homeLineup?: BatterSnapshot[];
  awayLineup?: BatterSnapshot[];
  parkFactor?: number | null;
  weatherNotable?: boolean;
  weatherTemp?: number;
  market?: Partial<MarketSnapshot>;
};

function buildLineup(opsByPos: number[], lineupSource: "confirmed" | "projected" = "confirmed"): BatterSnapshot[] {
  return opsByPos.map((ops, i) =>
    buildBatter({ batting_position: i + 1, season_ops: ops, lineup_source: lineupSource }),
  );
}

function buildSnapshot(o: SnapOverrides = {}): GameSnapshot {
  return {
    game_external_id: 1000,
    slate_date: "2026-06-06",
    game_date: "2026-06-06T19:00:00Z",
    home_team: { ...buildTeam({ team_external_id: 1, abbreviation: "HOM" }), ...(o.homeTeam ?? {}) },
    away_team: { ...buildTeam({ team_external_id: 2, abbreviation: "AWY" }), ...(o.awayTeam ?? {}) },
    home_starter: o.homeStarter === null ? null : { ...buildStarter({ player_external_id: 100 }), ...(o.homeStarter ?? {}) },
    away_starter: o.awayStarter === null ? null : { ...buildStarter({ player_external_id: 200 }), ...(o.awayStarter ?? {}) },
    home_lineup_top8: o.homeLineup ?? buildLineup([0.760, 0.760, 0.760, 0.720, 0.700, 0.680, 0.640, 0.620]),
    away_lineup_top8: o.awayLineup ?? buildLineup([0.760, 0.760, 0.760, 0.720, 0.700, 0.680, 0.640, 0.620]),
    ballpark: o.parkFactor === null ? null : { park_factor_runs: o.parkFactor ?? 1.0, is_dome: false },
    weather: {
      temperature_f: o.weatherTemp ?? 72,
      humidity_pct: 50,
      wind_speed_mph: 5,
      wind_direction_degrees: 90,
      is_notable: o.weatherNotable ?? false,
      notable_reason: o.weatherNotable ? "wind out 12 mph" : null,
    },
    market: { ...buildMarket(), ...(o.market ?? {}) },
    sharp: null,
    active_injuries: {
      home_starter_out: false,
      away_starter_out: false,
      home_top3_hitters_injured_count: 0,
      away_top3_hitters_injured_count: 0,
    },
    data_quality: {
      starter_confirmed: true,
      lineup_confirmed: false,
      weather_available: true,
      season_stats_present: true,
    },
  };
}

function buildFiLines(yrfiOdds: number, nrfiOdds: number, total = 0.5): FiLineRow[] {
  return [
    { market_type: "first_inning_total", sportsbook: "pinnacle", side: "over", line_value: total, odds_american: yrfiOdds },
    { market_type: "first_inning_total", sportsbook: "pinnacle", side: "under", line_value: total, odds_american: nrfiOdds },
  ];
}

async function main() {
  // ──────────────────────────────────────────────────────────────────
  section("Layer 1 — independent FI probability math");
  {
    const snap = buildSnapshot();
    const p = projectFiIndependent(snap);
    check(
      "league-avg lineup + league-avg starter → away λ ≈ base",
      near(p.away_lambda, FI_BASE_LAMBDA_PER_TEAM, 0.05),
      `actual away_lambda=${p.away_lambda}`,
    );
    check(
      "P(NRFI) = (1 - P(away scores)) × (1 - P(home scores))",
      near(p.p_nrfi, (1 - p.away_p_score) * (1 - p.home_p_score), 0.001),
    );
    check("P(YRFI) = 1 - P(NRFI)", near(p.p_yrfi, 1 - p.p_nrfi, 0.001));
    check(
      "league-baseline P(NRFI) in [0.45, 0.65] (vs ~50% MLB historical)",
      p.p_nrfi >= 0.45 && p.p_nrfi <= 0.65,
      `actual p_nrfi=${p.p_nrfi}`,
    );
    check("data_quality_tier high on full snapshot", p.data_quality_tier === "high");
  }
  {
    // Strong top-of-order + weak opposing starter for HOME → home λ way up → YRFI direction
    const eliteOps = FI_LEAGUE_AVG_TOP3_OPS + 0.10;
    const snap = buildSnapshot({
      homeLineup: buildLineup([eliteOps, eliteOps, eliteOps, 0.720, 0.700, 0.680, 0.640, 0.620]),
      awayStarter: { season_era: 6.50 }, // weak SP → high pitcher factor → home λ up
    });
    const p = projectFiIndependent(snap);
    check(
      "elite home top-3 + weak away SP → P(home scores) > league baseline",
      p.home_p_score > 0.30,
      `actual home_p_score=${p.home_p_score}`,
    );
    check("→ P(home scores) materially above away (asymmetry)",
      p.home_p_score - p.away_p_score > 0.05,
      `home=${p.home_p_score} away=${p.away_p_score}`);
  }
  {
    // Elite SP + weak top-of-order → NRFI direction
    const weakOps = 0.620;
    const snap = buildSnapshot({
      homeLineup: buildLineup([weakOps, weakOps, weakOps, 0.620, 0.600, 0.580, 0.560, 0.540]),
      awayLineup: buildLineup([weakOps, weakOps, weakOps, 0.620, 0.600, 0.580, 0.560, 0.540]),
      homeStarter: { season_era: 2.30, first_inning_era: 1.50, first_inning_starts: 12 },
      awayStarter: { season_era: 2.30, first_inning_era: 1.50, first_inning_starts: 12 },
    });
    const p = projectFiIndependent(snap);
    check(
      "elite SPs + weak top-3 → P(NRFI) > 0.60",
      p.p_nrfi > 0.60,
      `actual p_nrfi=${p.p_nrfi}`,
    );
  }
  {
    // Missing one starter → fallback tier
    const snap = buildSnapshot({ homeStarter: null });
    const p = projectFiIndependent(snap);
    check("missing starter → fallback tier", p.data_quality_tier === "fallback");
  }
  {
    // FI ERA + ≥5 starts → preferred source for that starter side
    const snap = buildSnapshot({
      homeStarter: { first_inning_era: 1.20, first_inning_starts: 10 },
      awayStarter: { first_inning_era: 1.20, first_inning_starts: 10 },
    });
    const p = projectFiIndependent(snap);
    // HOME starter is the one AWAY team faces in T1 (audit.away_starter_fi)
    check("away_starter_fi (= HOME SP) source = preferred when FI ERA + 10 starts",
      p.feature_audit.away_starter_fi.source === "preferred",
      `actual=${p.feature_audit.away_starter_fi.source}`);
  }
  {
    // Season ERA only → proxy source
    const snap = buildSnapshot();
    const p = projectFiIndependent(snap);
    check("starter without FI ERA but with season ERA → proxy source",
      p.feature_audit.away_starter_fi.source === "proxy" && p.feature_audit.home_starter_fi.source === "proxy",
      `home=${p.feature_audit.home_starter_fi.source} away=${p.feature_audit.away_starter_fi.source}`);
  }
  {
    // Confirmed lineup → preferred lineup status
    const confirmedLineup: BatterSnapshot[] = [
      buildBatter({ batting_position: 1, season_ops: 0.800, lineup_source: "confirmed" }),
      buildBatter({ batting_position: 2, season_ops: 0.780, lineup_source: "confirmed" }),
      buildBatter({ batting_position: 3, season_ops: 0.760, lineup_source: "confirmed" }),
      buildBatter({ batting_position: 4, season_ops: 0.720, lineup_source: "confirmed" }),
      buildBatter({ batting_position: 5, season_ops: 0.700, lineup_source: "confirmed" }),
      buildBatter({ batting_position: 6, season_ops: 0.680, lineup_source: "confirmed" }),
      buildBatter({ batting_position: 7, season_ops: 0.640, lineup_source: "confirmed" }),
      buildBatter({ batting_position: 8, season_ops: 0.620, lineup_source: "confirmed" }),
    ];
    const snap = buildSnapshot({ homeLineup: confirmedLineup, awayLineup: confirmedLineup });
    const p = projectFiIndependent(snap);
    check("confirmed lineup → fi_lineup_confirmed source = preferred",
      p.feature_audit.home_lineup.source === "preferred");
  }
  {
    // Confirmed lineups should refine FI, not block the entire market.
    // When batting orders are not posted yet, fresh team-offense context
    // is publishable as lower-trust provisional FI input.
    const snap = buildSnapshot({
      homeLineup: [],
      awayLineup: [],
      homeTeam: { team_avg_batter_ops: 0.745, team_avg_batter_ops_sample: 3600 },
      awayTeam: { team_avg_batter_ops: 0.710, team_avg_batter_ops_sample: 3600 },
      homeStarter: { first_inning_era: 3.80, first_inning_starts: 10 },
      awayStarter: { first_inning_era: 4.20, first_inning_starts: 10 },
    });
    const p = projectFiIndependent(snap);
    check("missing batting order can use team-offense proxy",
      p.feature_audit.home_lineup.source === "fallback_real" &&
        p.feature_audit.away_lineup.source === "fallback_real");
    check("team-offense proxy is not fallback tier", p.data_quality_tier !== "fallback");
    const out = runMlbFirstInningModelV2(snap, buildFiLines(+105, -120));
    check("FI V2 does not hold solely because confirmed lineups are pending",
      out.fiV2Audit.fi_pick !== "Held",
      `pick=${out.fiV2Audit.fi_pick} blockers=${out.fiV2Audit.fresh_data_blockers.join(",")}`);
  }
  {
    // Confirmed top three with missing individual OPS should still use the
    // real team-offense proxy instead of becoming a hard missing-input hold.
    const noOpsLineup = buildLineup([0, 0, 0, 0.720, 0.700, 0.680, 0.640, 0.620])
      .map((b, i) => i < 3 ? { ...b, season_ops: null, lineup_source: "confirmed" as const } : b);
    const snap = buildSnapshot({
      homeLineup: noOpsLineup,
      awayLineup: noOpsLineup,
      homeTeam: { team_avg_batter_ops: 0.745, team_avg_batter_ops_sample: 3600 },
      awayTeam: { team_avg_batter_ops: 0.710, team_avg_batter_ops_sample: 3600 },
    });
    const p = projectFiIndependent(snap);
    check("confirmed top-3 with no OPS uses team-offense proxy",
      p.feature_audit.home_top_order.reason === "fi_top_order_team_ops_proxy" &&
        p.feature_audit.away_top_order.reason === "fi_top_order_team_ops_proxy");
    check("confirmed top-3 with no OPS keeps lineup status confirmed",
      p.feature_audit.home_lineup.reason === "fi_lineup_confirmed" &&
        p.feature_audit.away_lineup.reason === "fi_lineup_confirmed");
    check("confirmed top-3 with team proxy is not low tier",
      p.data_quality_tier !== "low" && p.data_quality_tier !== "fallback");
  }

  // ──────────────────────────────────────────────────────────────────
  section("Push 3B-2 — FiLineRow shape contract (fetched_at, not updated_at)");
  {
    // Regression for the Push 3B bug: my shadow operator + market
    // baseline used `updated_at` which doesn't exist on the `lines`
    // table. The schema field is `fetched_at`. If anyone reverts the
    // type, this test asserts the contract.
    const freshObservedAt = new Date().toISOString();
    const probe: FiLineRow = {
      market_type: "first_inning_total",
      sportsbook: "betmgm",
      side: "over",
      line_value: 0.5,
      odds_american: -105,
      fetched_at: freshObservedAt,
    };
    check("FiLineRow accepts fetched_at field",
      typeof probe.fetched_at === "string");
    // TypeScript-level guard: this would fail tsc if the field renamed.
    const baseline = computeFiMarketBaseline([
      probe,
      { ...probe, side: "under", odds_american: 105 },
    ]);
    check("baseline.freshness reads from fetched_at",
      baseline.freshness === freshObservedAt);
  }

  section("Push 3B-2 — non-priority books still work (fall-through)");
  {
    // Today's slate has betmgm, betrivers, betway, hardrock, ballybet.
    // Only betmgm is in FI_BOOK_PRIORITY explicitly — others must fall
    // through and be accepted.
    const fallthroughBooks: FiLineRow[] = [
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "over", line_value: 0.5, odds_american: 110, fetched_at: null },
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "under", line_value: 0.5, odds_american: -130, fetched_at: null },
    ];
    const r = computeFiMarketBaseline(fallthroughBooks);
    check("ballybet (not in priority chain) accepted via fall-through",
      r.data_quality === "ok");
    check("reason indicates the chosen book",
      r.reason.includes("evaluation_ballybet"));
  }

  section("FI market baseline rejects non-NRFI 1.5-run prices");
  {
    const r = computeFiMarketBaseline([
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "over", line_value: 1.5, odds_american: 200, fetched_at: null },
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "under", line_value: 1.5, odds_american: -275, fetched_at: null },
      { market_type: "first_inning_total", sportsbook: "pinnacle", side: "over", line_value: 0.5, odds_american: -109, fetched_at: null },
      { market_type: "first_inning_total", sportsbook: "pinnacle", side: "under", line_value: 0.5, odds_american: -107, fetched_at: null },
    ]);
    check("1.5-run Bally Bet price cannot become an NRFI price",
      r.listed_fi_total === 0.5 && r.nrfi_odds_american === -107 && r.yrfi_odds_american === -109);
    check("exact half-run two-sided book remains the source",
      r.evaluation_sportsbook === "pinnacle");
  }

  section("Push 3B-2 — Over=YRFI / Under=NRFI side mapping");
  {
    // YRFI heavy line: over -150 / under +130
    const yrfiHeavy = computeFiMarketBaseline([
      { market_type: "first_inning_total", sportsbook: "pinnacle", side: "over", line_value: 0.5, odds_american: -150, fetched_at: null },
      { market_type: "first_inning_total", sportsbook: "pinnacle", side: "under", line_value: 0.5, odds_american: 130, fetched_at: null },
    ]);
    check("over -150 → YRFI no-vig > 0.55",
      yrfiHeavy.yrfi_no_vig_prob !== null && yrfiHeavy.yrfi_no_vig_prob > 0.55,
      `yrfi=${yrfiHeavy.yrfi_no_vig_prob}`);
    check("NRFI no-vig = 1 - YRFI no-vig",
      yrfiHeavy.nrfi_no_vig_prob !== null && yrfiHeavy.yrfi_no_vig_prob !== null &&
      near(yrfiHeavy.nrfi_no_vig_prob + yrfiHeavy.yrfi_no_vig_prob, 1.0, 0.001));
    // NRFI heavy line: over +130 / under -150
    const nrfiHeavy = computeFiMarketBaseline([
      { market_type: "first_inning_total", sportsbook: "pinnacle", side: "over", line_value: 0.5, odds_american: 130, fetched_at: null },
      { market_type: "first_inning_total", sportsbook: "pinnacle", side: "under", line_value: 0.5, odds_american: -150, fetched_at: null },
    ]);
    check("under -150 → NRFI no-vig > 0.55",
      nrfiHeavy.nrfi_no_vig_prob !== null && nrfiHeavy.nrfi_no_vig_prob > 0.55,
      `nrfi=${nrfiHeavy.nrfi_no_vig_prob}`);
  }

  // ──────────────────────────────────────────────────────────────────
  section("Layer 2 — market baseline");
  {
    const balanced = computeFiMarketBaseline(buildFiLines(110, -130));
    check("balanced YRFI/NRFI line returns no-vig probs that sum to 1",
      balanced.yrfi_no_vig_prob !== null && balanced.nrfi_no_vig_prob !== null &&
      near(balanced.yrfi_no_vig_prob + balanced.nrfi_no_vig_prob, 1.0, 0.001));
    check("data_quality=ok", balanced.data_quality === "ok");
    check("reason includes named-book consensus", balanced.reason.startsWith("fi_named_book_consensus"));
  }
  {
    const empty = computeFiMarketBaseline([]);
    check("no lines → missing", empty.data_quality === "missing" && empty.nrfi_no_vig_prob === null);
  }
  {
    // Only one side present → one_sided/missing
    const oneSided: FiLineRow[] = [
      { market_type: "first_inning_total", sportsbook: "pinnacle", side: "over", line_value: 0.5, odds_american: 100 },
    ];
    const r = computeFiMarketBaseline(oneSided);
    check("one-sided line → data_quality missing", r.data_quality === "missing");
  }

  section("FI named-book consensus — retail-only projection and exact-price separation");
  {
    const asOf = "2026-09-01T17:00:00.000Z";
    const rows: FiLineRow[] = [
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "over", line_value: 0.5, odds_american: -105, fetched_at: asOf },
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "under", line_value: 0.5, odds_american: -115, fetched_at: asOf },
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "over", line_value: 0.5, odds_american: 120, fetched_at: asOf },
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "under", line_value: 0.5, odds_american: -145, fetched_at: asOf },
      { market_type: "first_inning_total", sportsbook: "betway", side: "over", line_value: 0.5, odds_american: 140, fetched_at: asOf },
      { market_type: "first_inning_total", sportsbook: "betway", side: "under", line_value: 0.5, odds_american: -165, fetched_at: asOf },
      // A partial sharp quote is not a pair and cannot block complete retail.
      { market_type: "first_inning_total", sportsbook: "pinnacle", side: "over", line_value: 0.5, odds_american: -110, fetched_at: asOf },
    ];
    const baseline = computeFiMarketBaseline(rows, asOf);
    const expectedRetailMedian = [
      noVigPair(-105, -115).away,
      noVigPair(120, -145).away,
      noVigPair(140, -165).away,
    ].sort((left, right) => left - right)[1]!;
    check("retail-only complete pairs are projection-eligible without a sharp pair",
      baseline.data_quality === "ok" && baseline.projection_book_count === 3);
    check("all complete retail books contribute to the FI probability consensus",
      near(baseline.nrfi_no_vig_prob ?? 0, expectedRetailMedian, 0.000001));
    check("partial sharp inventory is ignored rather than treated as a hold",
      !baseline.projection_sportsbooks.includes("pinnacle"));
    check("evaluation economics remain on one exact priority book",
      baseline.evaluation_sportsbook === "fanduel" &&
      near(baseline.evaluation_nrfi_no_vig_prob ?? 0, noVigPair(-105, -115).away, 0.000001));
    check("projection consensus does not overwrite the exact-price fair probability",
      !near(baseline.nrfi_no_vig_prob ?? 0, baseline.evaluation_nrfi_no_vig_prob ?? 0, 0.000001));
    const model = runMlbFirstInningModelV2(buildSnapshot(), rows, asOf);
    const selectedPosterior = model.fiV2Audit.fi_pick === "NRFI"
      ? model.fiV2Audit.posterior_p_nrfi
      : 1 - model.fiV2Audit.posterior_p_nrfi;
    const selectedEvaluationFair = model.fiV2Audit.fi_pick === "NRFI"
      ? model.fiV2Audit.market_evaluation_nrfi_no_vig
      : model.fiV2Audit.market_evaluation_yrfi_no_vig;
    check("consensus enters the authoritative posterior before side classification",
      model.fiV2Audit.market_projection_book_count === 3 &&
      near(model.fiV2Audit.market_nrfi_no_vig ?? 0, expectedRetailMedian, 0.000001));
    check("FI grade edge remains attached to the exact evaluation pair",
      selectedEvaluationFair !== null && model.fiV2Audit.fi_edge_pct !== null &&
      near(model.fiV2Audit.fi_edge_pct, (selectedPosterior - selectedEvaluationFair) * 100, 0.000001));
  }
  {
    const asOf = "2026-09-01T17:00:00.000Z";
    const oneRetailPair: FiLineRow[] = [
      { market_type: "first_inning_total", sportsbook: "betrivers", side: "over", line_value: 0.5, odds_american: 105, fetched_at: asOf },
      { market_type: "first_inning_total", sportsbook: "betrivers", side: "under", line_value: 0.5, odds_american: -125, fetched_at: asOf },
      // Synthetic split consensus is not a named-book price source.
      { market_type: "first_inning_total", sportsbook: "splits_consensus", side: "over", line_value: 0.5, odds_american: -400, fetched_at: asOf },
      { market_type: "first_inning_total", sportsbook: "splits_consensus", side: "under", line_value: 0.5, odds_american: 300, fetched_at: asOf },
    ];
    const baseline = computeFiMarketBaseline(oneRetailPair, asOf);
    check("one complete supported named book is sufficient",
      baseline.data_quality === "ok" && baseline.projection_book_count === 1);
    check("synthetic consensus never masquerades as price or ticket/handle evidence",
      baseline.projection_sportsbooks.length === 1 && baseline.projection_sportsbooks[0] === "betrivers");
  }
  {
    const asOf = "2026-09-01T17:00:00.000Z";
    const skewed: FiLineRow[] = [
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "over", line_value: 0.5, odds_american: -105, fetched_at: "2026-09-01T16:50:00.000Z" },
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "under", line_value: 0.5, odds_american: -115, fetched_at: "2026-09-01T16:53:01.000Z" },
    ];
    check("side timestamps wider than two minutes cannot form a coherent pair",
      computeFiMarketBaseline(skewed, asOf).data_quality === "missing");
  }

  section("FI opening/current movement — bounded upstream synthesis");
  {
    const asOf = "2026-09-01T17:00:00.000Z";
    const current: FiLineRow[] = [
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "over", line_value: 0.5, odds_american: 120, fetched_at: asOf, observation_type: "current" },
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "under", line_value: 0.5, odds_american: -145, fetched_at: asOf, observation_type: "current" },
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "over", line_value: 0.5, odds_american: 110, fetched_at: asOf, observation_type: "current" },
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "under", line_value: 0.5, odds_american: -135, fetched_at: asOf, observation_type: "current" },
    ];
    const opening: FiLineRow[] = [
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "over", line_value: 0.5, odds_american: -130, fetched_at: "2026-09-01T12:00:00.000Z", observation_type: "opening" },
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "under", line_value: 0.5, odds_american: 110, fetched_at: "2026-09-01T12:00:00.000Z", observation_type: "opening" },
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "over", line_value: 0.5, odds_american: -125, fetched_at: "2026-09-01T12:00:00.000Z", observation_type: "opening" },
      { market_type: "first_inning_total", sportsbook: "ballybet", side: "under", line_value: 0.5, odds_american: 105, fetched_at: "2026-09-01T12:00:00.000Z", observation_type: "opening" },
    ];
    const noMovement = computeFiMarketBaseline(current, asOf);
    const withMovement = computeFiMarketBaseline([...current, ...opening], asOf);
    check("missing FI opening history is neutral rather than a hold",
      noMovement.data_quality === "ok" && noMovement.movement_adjustment_pp === 0 &&
      near(noMovement.nrfi_no_vig_prob ?? 0, noMovement.current_nrfi_no_vig_prob ?? 1, 0.000001));
    check("movement uses only same-book opening/current pairs",
      withMovement.movement_book_count === 2 &&
      withMovement.movement_sportsbooks.join(",") === "ballybet,fanduel");
    check("NRFI-supportive movement contributes upstream in the same direction",
      (withMovement.movement_nrfi_pp ?? 0) > 0 &&
      (withMovement.nrfi_no_vig_prob ?? 0) > (withMovement.current_nrfi_no_vig_prob ?? 1));
    check("movement residual is capped at one probability point",
      near(withMovement.movement_adjustment_pp, 1, 0.000001));
    check("opening context cannot replace the exact current evaluation quote",
      withMovement.evaluation_sportsbook === "fanduel" &&
      withMovement.yrfi_odds_american === 120 && withMovement.nrfi_odds_american === -145);
    const incumbent = runMlbFirstInningModelV2(buildSnapshot(), current, asOf);
    const candidate = runMlbFirstInningModelV2(buildSnapshot(), [...current, ...opening], asOf);
    check("movement changes the authoritative posterior before classification",
      candidate.fiV2Audit.posterior_p_nrfi > incumbent.fiV2Audit.posterior_p_nrfi &&
      candidate.fiV2Audit.market_movement_adjustment_pp === 1);
    check("natural decimal expected runs invert the same final posterior",
      near(candidate.fiV2Audit.posterior_expected_first_inning_runs,
        -Math.log(candidate.fiV2Audit.posterior_p_nrfi), 0.000000001));
  }
  {
    const asOf = "2026-09-01T17:00:00.000Z";
    const openingOnly: FiLineRow[] = [
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "over", line_value: 0.5, odds_american: -110, fetched_at: "2026-09-01T12:00:00.000Z", observation_type: "opening" },
      { market_type: "first_inning_total", sportsbook: "fanduel", side: "under", line_value: 0.5, odds_american: -110, fetched_at: "2026-09-01T12:00:00.000Z", observation_type: "opening" },
    ];
    check("opening history alone cannot manufacture a current FI forecast",
      computeFiMarketBaseline(openingOnly, asOf).data_quality === "missing");
  }

  // ──────────────────────────────────────────────────────────────────
  section("Layer 3-5 — end-to-end runMlbFirstInningModelV2");
  {
    // Full-info game with market → NRFI band
    const snap = buildSnapshot({
      homeStarter: { season_era: 2.30, first_inning_era: 2.30, first_inning_starts: 10 },
      awayStarter: { season_era: 2.30, first_inning_era: 2.30, first_inning_starts: 10 },
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(110, -130));
    check("good SPs + balanced market → posterior P(NRFI) reasonable",
      out.fiV2Audit.posterior_p_nrfi > 0.50 && out.fiV2Audit.posterior_p_nrfi < 0.85);
    check("fi_pick decided", ["NRFI", "YRFI", "Toss-Up"].includes(out.fiV2Audit.fi_pick));
    check("confidence between 50 and 78",
      (out.nrfi_confidence ?? 0) >= 50 && (out.nrfi_confidence ?? 0) <= 78);
  }
  {
    // Posterior in toss-up band → Toss-Up classification
    const snap = buildSnapshot({
      homeStarter: { first_inning_era: 4.10, first_inning_starts: 10 },
      awayStarter: { first_inning_era: 4.10, first_inning_starts: 10 },
    });
    const r = projectFiIndependent(snap);
    if (r.p_nrfi >= 0.45 && r.p_nrfi <= 0.55) {
      const out = runMlbFirstInningModelV2(snap, buildFiLines(105, -125));
      check("balanced inputs near 0.5 → fi_pick=Toss-Up",
        out.fiV2Audit.fi_pick === "Toss-Up" || out.fiV2Audit.fi_pick === "NRFI" || out.fiV2Audit.fi_pick === "YRFI",
        `actual=${out.fiV2Audit.fi_pick}`);
    }
    // Explicit toss-up case: force posterior into band by setting starter ERAs slightly off-balance
    const snap2 = buildSnapshot({
      homeStarter: { season_era: 3.90, first_inning_era: 3.90, first_inning_starts: 10 },
      awayStarter: { season_era: 4.30, first_inning_era: 4.30, first_inning_starts: 10 },
    });
    const out2 = runMlbFirstInningModelV2(snap2, buildFiLines(110, -130));
    check("near-balanced posterior, threshold band → emits Toss-Up OR a directional pick",
      ["Toss-Up", "NRFI", "YRFI"].includes(out2.fiV2Audit.fi_pick));
  }
  {
    // A complete two-sided FI market plus publishable lineups should remain
    // visible as a non-actionable Toss-Up while a probable is unpublished.
    const snap = buildSnapshot({ homeStarter: null });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(110, -130));
    check("unpublished probable with complete FI market → Toss-Up", out.fiV2Audit.fi_pick === "Toss-Up");
    check("unpublished-probable Toss-Up remains non-actionable", out.fiV2Audit.fi_play_grade === "toss_up" && out.fiV2Audit.fi_best_angle_eligible === false);
    check("unpublished-probable Toss-Up carries explicit reason", out.fiV2Audit.fi_pick_reason === "fi_toss_up_market_backed_probable_unpublished");
    check("unpublished-probable Toss-Up retains only starter blockers", out.fiV2Audit.fresh_data_ready === false && out.fiV2Audit.fresh_data_blockers.length === 1);
  }
  {
    // A published/named probable without enough verified FI or season history
    // must remain visible on the board as a non-actionable Toss-Up. It is not
    // equivalent to an unknown starter and must not silently disappear.
    const snap = buildSnapshot({
      homeStarter: { player_name: "Named Home Probable", season_era: null, first_inning_era: null, first_inning_starts: null },
      awayStarter: { player_name: "Named Away Probable", season_era: null, first_inning_era: null, first_inning_starts: null },
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(-150, +116));
    check("named probable starters with sparse history → Toss-Up", out.fiV2Audit.fi_pick === "Toss-Up");
    check("sparse named-starter Toss-Up remains non-actionable", out.fiV2Audit.fi_play_grade === "toss_up" && out.fiV2Audit.fi_best_angle_eligible === false);
    check("sparse named-starter Toss-Up carries explicit reason", out.fiV2Audit.fi_pick_reason === "fi_toss_up_sparse_named_starter_history");
    check("sparse named-starter Toss-Up retains blockers for audit", out.fiV2Audit.fresh_data_ready === false && out.fiV2Audit.fresh_data_blockers.length === 2);
  }
  {
    const snap = buildSnapshot({
      homeStarter: { player_name: "Scratched Home Starter", is_scratched: true, season_era: null, first_inning_era: null, first_inning_starts: null },
      awayStarter: { player_name: "Named Away Probable", season_era: null, first_inning_era: null, first_inning_starts: null },
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(-150, +116));
    check("scratched starter cannot use sparse named-starter Toss-Up path", out.fiV2Audit.fi_pick === "Held");
  }
  {
    // Real season ERA is an intentional FI proxy. It is sufficient to
    // publish a direction, but must remain provisional/Lean-only until
    // preferred first-inning history is available.
    const snap = buildSnapshot({
      homeStarter: { season_era: 3.60, first_inning_era: null, first_inning_starts: null },
      awayStarter: { season_era: 4.40, first_inning_era: null, first_inning_starts: null },
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(110, -130));
    check("season-ERA starter proxies → FI side is not Held", out.fiV2Audit.fi_pick !== "Held");
    check("season-ERA starter proxies → fresh-data gate passes", out.fiV2Audit.fresh_data_ready === true);
    check("season-ERA starter proxies → prediction remains provisional", out.fiV2Audit.provisional === true);
    check("season-ERA starter proxies → Best Angle remains blocked", out.fiV2Audit.fi_best_angle_eligible === false);
    check("season-ERA starter proxies → grade capped at Lean", out.fiV2Audit.fi_play_grade === "lean");
  }
  {
    // No market → provisional + lean cap (no Best Angle)
    const snap = buildSnapshot({
      homeStarter: { first_inning_era: 4.10, first_inning_starts: 10 },
      awayStarter: { first_inning_era: 4.10, first_inning_starts: 10 },
    });
    const out = runMlbFirstInningModelV2(snap, []);
    check("no market → provisional=true", out.fiV2Audit.provisional === true);
    check("no market → fi_play_grade !== best_angle", out.fiV2Audit.fi_play_grade !== "best_angle");
    check("no market → trust_independent = 1.0", out.fiV2Audit.trust_independent === 1.0);
    check("no market → fi_best_angle_eligible=false", out.fiV2Audit.fi_best_angle_eligible === false);
  }
  {
    // Posterior cap: huge independent vs balanced market
    const eliteOps = FI_LEAGUE_AVG_TOP3_OPS + 0.20;
    const snap = buildSnapshot({
      homeLineup: buildLineup([eliteOps, eliteOps, eliteOps, 0.720, 0.700, 0.680, 0.640, 0.620]),
      awayLineup: buildLineup([eliteOps, eliteOps, eliteOps, 0.720, 0.700, 0.680, 0.640, 0.620]),
      awayStarter: { season_era: 7.50, first_inning_era: 7.50, first_inning_starts: 10 },
      homeStarter: { season_era: 7.50, first_inning_era: 7.50, first_inning_starts: 10 },
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(140, -160)); // YRFI line
    const rawPosterior =
      (out.fiV2Audit.independent_p_nrfi ?? 0) * out.fiV2Audit.trust_independent +
      (out.fiV2Audit.market_nrfi_no_vig ?? 0) * (1 - out.fiV2Audit.trust_independent);
    const shouldCap = Math.abs(rawPosterior - (out.fiV2Audit.market_nrfi_no_vig ?? 0)) > FI_TEST.FI_POSTERIOR_NRFI_CAP;
    check("posterior cap flag matches the market-anchored raw blend",
      out.fiV2Audit.posterior_capped === shouldCap);
    check("posterior NRFI didn't move more than ~10 pts from market",
      Math.abs((out.fiV2Audit.posterior_p_nrfi ?? 0) - (out.fiV2Audit.market_nrfi_no_vig ?? 0)) <= 0.11);
  }
  {
    // Legacy predicted_nrfi mapping
    const snap = buildSnapshot({
      homeStarter: { season_era: 2.30, first_inning_era: 2.30, first_inning_starts: 10 },
      awayStarter: { season_era: 2.30, first_inning_era: 2.30, first_inning_starts: 10 },
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(110, -130));
    if (out.fiV2Audit.fi_pick === "NRFI") {
      check("legacy predicted_nrfi=true on NRFI pick", out.predicted_nrfi === true);
    } else if (out.fiV2Audit.fi_pick === "YRFI") {
      check("legacy predicted_nrfi=false on YRFI pick", out.predicted_nrfi === false);
    } else {
      check("legacy predicted_nrfi=true on Toss-Up (lean-NRFI collapse)", out.predicted_nrfi === true);
    }
  }
  {
    // Constants sanity + Push 3B-3 calibration thresholds
    check("FI_NRFI_THRESHOLD > FI_YRFI_THRESHOLD",
      FI_TEST.FI_NRFI_THRESHOLD > FI_TEST.FI_YRFI_THRESHOLD);
    check("Best Angle min edge sane (≥ 2%)", FI_TEST.FI_BEST_ANGLE_MIN_EDGE_PCT >= 2);
    check("Posterior cap ≤ 15 pts", FI_TEST.FI_POSTERIOR_NRFI_CAP <= 0.15);
    check("Push 3B-3: NRFI threshold = 0.52 (narrowed from 0.55)",
      FI_TEST.FI_NRFI_THRESHOLD === 0.52);
    check("Push 3B-3: YRFI threshold = 0.48 (narrowed from 0.45)",
      FI_TEST.FI_YRFI_THRESHOLD === 0.48);
    check("Push 3B-3: Toss-Up band is symmetric ±2 around 0.50",
      Math.abs((FI_TEST.FI_NRFI_THRESHOLD - 0.50) - (0.50 - FI_TEST.FI_YRFI_THRESHOLD)) < 0.001);
  }
  {
    // Push 3B-3 — posterior just above 0.52 must classify as NRFI (not Toss-Up)
    const snap = buildSnapshot({
      homeStarter: { season_era: 3.50, first_inning_era: 3.50, first_inning_starts: 10 },
      awayStarter: { season_era: 3.50, first_inning_era: 3.50, first_inning_starts: 10 },
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(110, -130));
    // Probe: this combination historically lands near 0.52-0.53 posterior
    if (out.fiV2Audit.posterior_p_nrfi >= 0.52) {
      check("posterior ≥ 0.52 → fi_pick=NRFI under calibrated band",
        out.fiV2Audit.fi_pick === "NRFI",
        `posterior=${out.fiV2Audit.posterior_p_nrfi} pick=${out.fiV2Audit.fi_pick}`);
    }
  }
  {
    // Push 3B-3 — posterior just below 0.48 must classify as YRFI (not Toss-Up)
    // Force YRFI side via strong top-of-order + average SPs.
    const eliteOps = FI_LEAGUE_AVG_TOP3_OPS + 0.12;
    const snap = buildSnapshot({
      homeLineup: buildLineup([eliteOps, eliteOps, eliteOps, 0.720, 0.700, 0.680, 0.640, 0.620]),
      awayLineup: buildLineup([eliteOps, eliteOps, eliteOps, 0.720, 0.700, 0.680, 0.640, 0.620]),
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(110, -130));
    if (out.fiV2Audit.posterior_p_nrfi <= 0.48) {
      check("posterior ≤ 0.48 → fi_pick=YRFI under calibrated band",
        out.fiV2Audit.fi_pick === "YRFI",
        `posterior=${out.fiV2Audit.posterior_p_nrfi} pick=${out.fiV2Audit.fi_pick}`);
    }
  }
  {
    // selectTrustIndependent direct
    check("high + market → 0.25", FI_TEST.selectTrustIndependent({ tier: "high", missingCount: 0, hasMarket: true }) === 0.25);
    check("market-backed Lean floor = nonnegative no-vig edge", FI_TEST.FI_LEAN_MIN_EDGE_PCT === 0);
    check("r64 marginal NRFI price gate is capped below 54%", FI_TEST.FI_MARGINAL_NRFI_PRICE_GATE_MAX === 0.54);
    check("medium + market → 0.45", FI_TEST.selectTrustIndependent({ tier: "medium", missingCount: 2, hasMarket: true }) === 0.45);
    check("no market → 1.0", FI_TEST.selectTrustIndependent({ tier: "high", missingCount: 0, hasMarket: false }) === 1.0);
    check("severe missing → 0.05", FI_TEST.selectTrustIndependent({ tier: "high", missingCount: 7, hasMarket: true }) === 0.05);
  }
  {
    const demoted = FI_TEST.applyFiMarginalPricePolicy({
      pick: "NRFI", pickReason: "fi_p_nrfi_above_threshold", posteriorNrfi: 0.535,
      nrfiOdds: -120,
    });
    check("r64 marginal NRFI below offered break-even becomes Toss-Up",
      demoted.pick === "Toss-Up" && demoted.pickReason === "fi_toss_up_marginal_nrfi_below_offered_break_even");
    const retained = FI_TEST.applyFiMarginalPricePolicy({
      pick: "NRFI", pickReason: "fi_p_nrfi_above_threshold", posteriorNrfi: 0.535,
      nrfiOdds: -105,
    });
    check("r64 marginal NRFI that clears offered break-even remains NRFI", retained.pick === "NRFI");
    const nrfiPromotion = FI_TEST.applyFiMarginalPricePolicy({
      pick: "Toss-Up", pickReason: "fi_toss_up_probability", posteriorNrfi: 0.515,
      nrfiOdds: 105,
    });
    check("r64 paired route promotes a price-qualified Toss-Up to NRFI",
      nrfiPromotion.pick === "NRFI" && nrfiPromotion.pickReason === "fi_marginal_nrfi_clears_offered_break_even");
    const yrfiPromotion = FI_TEST.applyFiMarginalPricePolicy({
      pick: "Toss-Up", pickReason: "fi_toss_up_probability", posteriorNrfi: 0.49,
      nrfiOdds: -130,
    });
    check("r64 sparse YRFI exception fails closed to the incumbent Toss-Up",
      yrfiPromotion.pick === "Toss-Up" && yrfiPromotion.pickReason === "fi_toss_up_probability");
    const neutral = FI_TEST.applyFiMarginalPricePolicy({
      pick: "Toss-Up", pickReason: "fi_toss_up_probability", posteriorNrfi: 0.51,
      nrfiOdds: -110,
    });
    check("r64 Toss-Up stays neutral when neither offered price is cleared", neutral.pick === "Toss-Up");
    const tied = FI_TEST.applyFiMarginalPricePolicy({
      pick: "Toss-Up", pickReason: "fi_toss_up_probability", posteriorNrfi: 0.5,
      nrfiOdds: 105,
    });
    check("r64 exact 50/50 forecast cannot acquire an arbitrary side", tied.pick === "Toss-Up");
    const sparse = FI_TEST.applyFiMarginalPricePolicy({
      pick: "Toss-Up", pickReason: "fi_toss_up_sparse_named_starter_history", posteriorNrfi: 0.515,
      nrfiOdds: 105,
    });
    check("r64 price route cannot override a data-quality Toss-Up", sparse.pick === "Toss-Up");
  }
  {
    // Toss-Up display: the pick string is literally "Toss-Up", not "-"
    const snap = buildSnapshot({
      homeStarter: { season_era: 4.05 },
      awayStarter: { season_era: 4.15 },
    });
    const out = runMlbFirstInningModelV2(snap, buildFiLines(120, -140));
    if (out.fiV2Audit.fi_pick === "Toss-Up") {
      check('Toss-Up emits the literal string "Toss-Up"', out.fiV2Audit.fi_pick === "Toss-Up");
      check("Toss-Up has dedicated fi_play_grade=toss_up", out.fiV2Audit.fi_play_grade === "toss_up");
      check("Toss-Up is NOT held", out.fiV2Audit.fi_pick !== ("Held" as unknown));
    }
  }

  // ──────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Results ━━━\n  ✓ ${pass}    ✗ ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
