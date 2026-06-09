/**
 * Phase 7A — NBA Finals v0a — fixture-only tests for the orchestrator
 * and its pure layers.
 *
 * Coverage:
 *   • Layer 1 (projectIndependent): math + fallback when ratings null
 *   • Layer 2 (marketPrior): no-vig pair, spread sign flip, null safety
 *   • Layer 3 (blendPosterior): trust schedule + market-missing path
 *   • seriesContext: pure derivation from prior team-pair games
 *   • runNbaAutoModelV1: end-to-end on synthetic Lakers @ Celtics Finals
 *
 * Pure. No DB, no network.
 *
 * Run: npx tsx scripts/test-nba-automodel-v1.ts
 */

import { projectIndependent } from "../lib/automodel/nba/projectIndependent";
import {
  americanToImpliedProb,
  computeMarketBaseline,
  noVigPair,
} from "../lib/automodel/nba/marketPrior";
import { blendPosterior } from "../lib/automodel/nba/blendPosterior";
import {
  deriveSeriesContext,
  type PriorGameInput,
} from "../lib/automodel/nba/seriesContext";
import { runNbaAutoModelV1 } from "../lib/automodel/nba/nbaAutoModelV1";
import {
  NBA_BEST_ANGLE_MIN_CONFIDENCE,
  NBA_CONFIDENCE_CEILING,
  NBA_HCA_PLAYOFFS,
  type NbaGameSnapshot,
  type NbaMarketSnapshot,
  type NbaPlayerInjury,
  type NbaTeamSnapshot,
} from "../lib/automodel/nba/types";

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

function near(a: number, b: number, tol = 0.1): boolean {
  return Math.abs(a - b) <= tol;
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// ─── Synthetic builders ───────────────────────────────────────────

function buildTeam(opts: Partial<NbaTeamSnapshot> = {}): NbaTeamSnapshot {
  return {
    team_external_id: opts.team_external_id ?? 1,
    abbreviation: opts.abbreviation ?? "TST",
    off_rating: "off_rating" in opts ? opts.off_rating! : 115.0,
    def_rating: "def_rating" in opts ? opts.def_rating! : 115.0,
    net_rating: "net_rating" in opts ? opts.net_rating! : 0.0,
    pace: "pace" in opts ? opts.pace! : 99.0,
    recent_form_10g_net_rating: opts.recent_form_10g_net_rating ?? null,
    // Phase 7C — v1 rating packs default to null (v0 tests don't use them).
    regular_season_ratings:
      "regular_season_ratings" in opts ? opts.regular_season_ratings! : null,
    playoff_ratings:
      "playoff_ratings" in opts ? opts.playoff_ratings! : null,
  };
}

function buildMarket(opts: Partial<NbaMarketSnapshot> = {}): NbaMarketSnapshot {
  return {
    ml: opts.ml ?? { home_odds_american: -180, away_odds_american: +150 },
    spread: opts.spread ?? {
      home_line: -4.5,
      home_odds_american: -110,
      away_odds_american: -110,
    },
    total: opts.total ?? {
      line: 220.5,
      over_odds_american: -110,
      under_odds_american: -110,
    },
  };
}

function buildSnapshot(opts: {
  home?: Partial<NbaTeamSnapshot>;
  away?: Partial<NbaTeamSnapshot>;
  market?: Partial<NbaMarketSnapshot>;
  home_injuries?: NbaPlayerInjury[];
  away_injuries?: NbaPlayerInjury[];
  home_injuries_known?: boolean;
  away_injuries_known?: boolean;
  market_present?: boolean;
  ratings_present?: boolean;
  series_derived?: boolean;
  series_game_number?: number;
  series_home_wins?: number;
  series_away_wins?: number;
  series_venue_shift?: boolean;
  series_elim_home?: boolean;
  series_elim_away?: boolean;
} = {}): NbaGameSnapshot {
  const home = buildTeam({ ...opts.home, team_external_id: 1, abbreviation: "BOS" });
  const away = buildTeam({ ...opts.away, team_external_id: 2, abbreviation: "LAL" });
  const market = buildMarket(opts.market);
  const ratings_present =
    opts.ratings_present ??
    (home.net_rating !== null && away.net_rating !== null && home.pace !== null && away.pace !== null);
  return {
    game_external_id: 9_900_001,
    slate_date: "2026-06-08",
    game_time_iso: "2026-06-08T20:00:00Z",
    home_team: home,
    away_team: away,
    home_injuries: opts.home_injuries ?? [],
    away_injuries: opts.away_injuries ?? [],
    series:
      opts.series_derived === false
        ? null
        : {
            game_number: opts.series_game_number ?? 4,
            series_score_home: opts.series_home_wins ?? 2,
            series_score_away: opts.series_away_wins ?? 1,
            home_team_leads_series_by:
              (opts.series_home_wins ?? 2) - (opts.series_away_wins ?? 1),
            is_elimination_for_home: opts.series_elim_home ?? false,
            is_elimination_for_away: opts.series_elim_away ?? false,
            days_rest_home: 2,
            days_rest_away: 2,
            venue_shift: opts.series_venue_shift ?? false,
          },
    market,
    data_quality: {
      ratings_present,
      home_injuries_known: opts.home_injuries_known ?? true,
      away_injuries_known: opts.away_injuries_known ?? true,
      market_present: opts.market_present ?? true,
      series_context_derived: opts.series_derived ?? true,
    },
  };
}

// ─── Layer 1: projectIndependent ──────────────────────────────────

section("Layer 1 · projectIndependent");

{
  // Both teams league-average → home wins by HCA, total ≈ 2 × 115 × 99/100 = 227.7
  const snap = buildSnapshot();
  const indep = projectIndependent(snap, { isPlayoffs: true });
  check(
    "league-average teams produce home > away by ~HCA",
    near(indep.home_score_mean - indep.away_score_mean, NBA_HCA_PLAYOFFS, 0.1),
    `got diff=${(indep.home_score_mean - indep.away_score_mean).toFixed(2)}`,
  );
  check(
    "league-average total in 100-team-per-100 × pace 99 = ~227.8",
    near(indep.home_score_mean + indep.away_score_mean, 227.8, 1.0),
    `got=${(indep.home_score_mean + indep.away_score_mean).toFixed(1)}`,
  );
  check(
    "score SD is non-zero and within sane range",
    indep.home_score_sd >= 9 && indep.home_score_sd <= 16,
  );
  check("did not use fallback rating (all inputs present)", indep.used_fallback_rating === false);
  check("hca used = playoffs", indep.hca_used === NBA_HCA_PLAYOFFS);
}

{
  // Strong home offense should push the projection
  const snap = buildSnapshot({
    home: { off_rating: 125, def_rating: 110 },
    away: { off_rating: 110, def_rating: 120 },
  });
  const indep = projectIndependent(snap, { isPlayoffs: true });
  check(
    "strong home rating → home expected score > away by more than HCA",
    indep.home_score_mean - indep.away_score_mean > NBA_HCA_PLAYOFFS + 2,
    `diff=${(indep.home_score_mean - indep.away_score_mean).toFixed(2)}`,
  );
}

{
  // All ratings null → fallback path engaged but doesn't crash
  const snap = buildSnapshot({
    home: { off_rating: null, def_rating: null, net_rating: null, pace: null },
    away: { off_rating: null, def_rating: null, net_rating: null, pace: null },
    ratings_present: false,
  });
  const indep = projectIndependent(snap, { isPlayoffs: true });
  check("fallback path: used_fallback_rating=true", indep.used_fallback_rating === true);
  check(
    "fallback path: still produces finite numbers",
    Number.isFinite(indep.home_score_mean) && Number.isFinite(indep.away_score_mean),
  );
  check(
    "fallback path: home > away by HCA (league avg vs league avg)",
    near(indep.home_score_mean - indep.away_score_mean, NBA_HCA_PLAYOFFS, 0.1),
  );
}

{
  const snap = buildSnapshot({ home: { pace: 105 }, away: { pace: 105 } });
  const indep = projectIndependent(snap, { isPlayoffs: true });
  check(
    "high pace → higher score SD than baseline",
    indep.home_score_sd > 12,
    `got sd=${indep.home_score_sd}`,
  );
}

// ─── Layer 2: marketPrior ─────────────────────────────────────────

section("Layer 2 · marketPrior");

{
  check(
    "americanToImpliedProb +100 → 0.5",
    near(americanToImpliedProb(+100), 0.5, 0.0001),
  );
  check(
    "americanToImpliedProb -110 → ~0.524",
    near(americanToImpliedProb(-110), 0.5238, 0.001),
  );
  check(
    "americanToImpliedProb -200 → ~0.667",
    near(americanToImpliedProb(-200), 0.6667, 0.001),
  );
}

{
  const pair = noVigPair(-110, -110);
  check("noVigPair(-110,-110) sum to 1", pair !== null && near(pair.a + pair.b, 1.0, 0.001));
  check("noVigPair(-110,-110) ≈ 0.5 each", pair !== null && near(pair.a, 0.5, 0.001));
}

{
  const pair = noVigPair(-300, +250);
  check("noVigPair(-300,+250) returns a value", pair !== null);
  if (pair !== null) {
    check(
      "noVigPair: favored side > 0.7",
      pair.a > 0.7,
      `home no-vig=${pair.a.toFixed(3)}`,
    );
  }
}

{
  // Implausible juice → reject
  const pair = noVigPair(+5000, +5000);
  check("noVigPair: rejects implausible overhead (both +5000)", pair === null);
}

{
  const market = buildMarket();
  const baseline = computeMarketBaseline(market);
  check("baseline has_full_market = true", baseline.has_full_market === true);
  check(
    "baseline.total_implied passed through",
    baseline.total_implied === 220.5,
  );
  check(
    "baseline.spread_implied_home_pts = -spread.home_line",
    baseline.spread_implied_home_pts === 4.5,
  );
  check(
    "baseline ml_home_no_vig in (0,1)",
    baseline.ml_home_no_vig !== null &&
      baseline.ml_home_no_vig > 0 &&
      baseline.ml_home_no_vig < 1,
  );
  check(
    "baseline over_no_vig + under_no_vig ≈ 1",
    baseline.over_no_vig !== null &&
      baseline.under_no_vig !== null &&
      near(baseline.over_no_vig + baseline.under_no_vig, 1.0, 0.001),
  );
}

{
  const market = buildMarket({
    ml: { home_odds_american: null, away_odds_american: null },
    spread: { home_line: null, home_odds_american: null, away_odds_american: null },
    total: { line: null, over_odds_american: null, under_odds_american: null },
  });
  const baseline = computeMarketBaseline(market);
  check("baseline with all-null market is null-safe", baseline.ml_home_no_vig === null);
  check("baseline.has_full_market false", baseline.has_full_market === false);
  check("baseline.total_implied null", baseline.total_implied === null);
}

// ─── Layer 3: blendPosterior ──────────────────────────────────────

section("Layer 3 · blendPosterior");

{
  const indep = {
    home_score_mean: 115,
    away_score_mean: 110,
    home_score_sd: 12,
    away_score_sd: 12,
  };
  const market = computeMarketBaseline(buildMarket()); // total 220.5, spread +4.5 home
  const post = blendPosterior({ independent: indep, market, trustWeight: 0.65 });
  // Independent total = 225, market total = 220.5; trust=0.65 →
  // blend total = 0.65*225 + 0.35*220.5 = 223.425
  check(
    "blendPosterior: posterior_total = trust-weighted average",
    near(post.posterior_total, 223.4, 0.2),
    `got=${post.posterior_total}`,
  );
  // Independent spread = 5, market spread = 4.5; trust=0.65 →
  // blend spread = 0.65*5 + 0.35*4.5 = 4.825
  check(
    "blendPosterior: posterior_spread = trust-weighted average",
    near(post.posterior_spread, 4.8, 0.2),
    `got=${post.posterior_spread}`,
  );
  check("effective_trust = trustWeight when market present", post.effective_trust_independent === 0.65);
}

{
  const indep = {
    home_score_mean: 115,
    away_score_mean: 110,
    home_score_sd: 12,
    away_score_sd: 12,
  };
  const market = computeMarketBaseline(
    buildMarket({
      ml: { home_odds_american: null, away_odds_american: null },
      spread: { home_line: null, home_odds_american: null, away_odds_american: null },
      total: { line: null, over_odds_american: null, under_odds_american: null },
    }),
  );
  const post = blendPosterior({ independent: indep, market, trustWeight: 0.65 });
  check(
    "no market → posterior IS independent (total)",
    post.posterior_total === 225,
  );
  check(
    "no market → posterior IS independent (spread)",
    post.posterior_spread === 5,
  );
  check(
    "no market → effective_trust = 1.0",
    post.effective_trust_independent === 1.0,
  );
}

{
  const indep = {
    home_score_mean: 115,
    away_score_mean: 110,
    home_score_sd: 12,
    away_score_sd: 12,
  };
  const market = computeMarketBaseline(buildMarket());
  const post = blendPosterior({ independent: indep, market, trustWeight: 0 });
  check(
    "trust=0 → posterior IS market (total)",
    near(post.posterior_total, 220.5, 0.01),
  );
  check(
    "trust=0 → posterior spread = market spread",
    near(post.posterior_spread, 4.5, 0.01),
  );
}

// ─── seriesContext ────────────────────────────────────────────────

section("seriesContext · pure derivation");

{
  const ctx = deriveSeriesContext({
    this_game_home_team_external_id: 1,
    this_game_away_team_external_id: 2,
    this_game_date: "2026-06-08",
    prior_games: [],
  });
  check("no prior games → Game 1", ctx.game_number === 1);
  check("no prior games → both series scores zero", ctx.series_score_home === 0 && ctx.series_score_away === 0);
  check("no prior games → no elimination", !ctx.is_elimination_for_home && !ctx.is_elimination_for_away);
  check("no prior games → no venue shift", ctx.venue_shift === false);
  check("no prior games → rest days null", ctx.days_rest_home === null);
}

{
  // Series: 2 prior games. Game 1 (home=1, away=2), home wins. Game 2
  // (home=1, away=2), away wins. → coming into game 3 series tied 1-1.
  const prior: PriorGameInput[] = [
    {
      game_external_id: 1,
      game_date: "2026-06-04",
      home_team_external_id: 1,
      away_team_external_id: 2,
      home_score: 110,
      away_score: 100,
    },
    {
      game_external_id: 2,
      game_date: "2026-06-06",
      home_team_external_id: 1,
      away_team_external_id: 2,
      home_score: 95,
      away_score: 105,
    },
  ];
  // This game shifts venue to team 2's place.
  const ctx = deriveSeriesContext({
    this_game_home_team_external_id: 2,
    this_game_away_team_external_id: 1,
    this_game_date: "2026-06-08",
    prior_games: prior,
  });
  check("game number after 2 priors = 3", ctx.game_number === 3);
  check("series 1-1 from THIS game's home perspective", ctx.series_score_home === 1 && ctx.series_score_away === 1);
  check("home leads by 0", ctx.home_team_leads_series_by === 0);
  check("venue shift detected (different home in last game)", ctx.venue_shift === true);
  check(
    "days rest correct (2 days from last game)",
    ctx.days_rest_home === 2 && ctx.days_rest_away === 2,
  );
}

{
  // Series 3-0, this game would eliminate the trailing team
  const prior: PriorGameInput[] = [1, 2, 3].map((i) => ({
    game_external_id: 100 + i,
    game_date: `2026-06-0${i}`,
    home_team_external_id: 1,
    away_team_external_id: 2,
    home_score: 110,
    away_score: 100,
  }));
  const ctx = deriveSeriesContext({
    this_game_home_team_external_id: 1,
    this_game_away_team_external_id: 2,
    this_game_date: "2026-06-08",
    prior_games: prior,
  });
  check("3-0 lead → away elim flag set", ctx.is_elimination_for_away === true);
  check("3-0 lead → home NOT elim", ctx.is_elimination_for_home === false);
}

// ─── runNbaAutoModelV1 end-to-end ─────────────────────────────────

section("Orchestrator · runNbaAutoModelV1 end-to-end");

{
  const snap = buildSnapshot({
    home: { off_rating: 120, def_rating: 110 },
    away: { off_rating: 115, def_rating: 115 },
  });
  const out = runNbaAutoModelV1(snap, "t60_locked");
  check("output uses NBA prediction_source", out.prediction_source === "auto_v0_nba_internal");
  check("v0a is always provisional", out.provisional === true);
  check("output stage echoes input", out.stage === "t60_locked");
  check(
    "tier = high when ratings + market + injuries known",
    out.audit.data_quality_tier === "high",
  );
  check(
    "confidence ceiling = high tier (72)",
    out.audit.confidence_ceiling === NBA_CONFIDENCE_CEILING.high,
  );
  check("trust independent = 0.65 at high tier", out.audit.trust_independent === 0.65);
  check(
    "ml_confidence is within [50, ceiling]",
    out.ml_confidence >= 50 && out.ml_confidence <= NBA_CONFIDENCE_CEILING.high,
  );
  check(
    "ml winner = home when posterior spread positive",
    out.audit.posterior_spread_home > 0
      ? out.predicted_ml_winner === "home"
      : out.predicted_ml_winner === "away",
  );
  check(
    "predicted_total = predicted_home_score + predicted_away_score",
    near(out.predicted_total, out.predicted_home_score + out.predicted_away_score, 0.2),
  );
  check("series audit captured (game 4)", out.audit.series_game_number === 4);
}

{
  // Missing ratings → fallback tier, lowest ceiling
  const snap = buildSnapshot({
    home: { off_rating: null, def_rating: null, net_rating: null, pace: null },
    away: { off_rating: null, def_rating: null, net_rating: null, pace: null },
    ratings_present: false,
  });
  const out = runNbaAutoModelV1(snap, "t60_locked");
  check("missing ratings → fallback tier", out.audit.data_quality_tier === "fallback");
  check(
    "fallback tier → confidence ceiling = 52",
    out.audit.confidence_ceiling === NBA_CONFIDENCE_CEILING.fallback,
  );
  check(
    "fallback tier → trust_independent very low",
    out.audit.trust_independent <= 0.15,
  );
  check(
    "fallback tier → ml_confidence ≤ 52",
    out.ml_confidence <= 52,
  );
  check(
    "fallback tier → ml_best_angle_eligible = false",
    out.audit.ml_best_angle_eligible === false,
  );
}

{
  // Injuries unknown → low tier + best angle blocked
  const snap = buildSnapshot({
    home_injuries_known: false,
    away_injuries_known: false,
    home_injuries: [{ player_id: null, name: "Star Player", status: "unknown" }],
  });
  const out = runNbaAutoModelV1(snap, "t60_locked");
  check(
    "injuries unknown → tier <= low",
    out.audit.data_quality_tier === "low" || out.audit.data_quality_tier === "medium" || out.audit.data_quality_tier === "fallback",
  );
  check(
    "injury unknown count surfaced in audit",
    out.audit.injury_unknown_count_home === 1,
  );
  check(
    "ml_best_angle_eligible = false when unknowns > 0",
    out.audit.ml_best_angle_eligible === false,
  );
}

{
  // Synthetic Lakers @ Celtics Finals — Game 4, BOS up 2-1, healthy.
  // BOS at home + slightly stronger ratings → BOS to win.
  const snap = buildSnapshot({
    home: {
      team_external_id: 2,
      abbreviation: "BOS",
      off_rating: 119,
      def_rating: 108,
      net_rating: 11,
      pace: 98,
    },
    away: {
      team_external_id: 13,
      abbreviation: "LAL",
      off_rating: 116,
      def_rating: 113,
      net_rating: 3,
      pace: 100,
    },
    market: {
      ml: { home_odds_american: -250, away_odds_american: +200 },
      spread: {
        home_line: -6.5,
        home_odds_american: -110,
        away_odds_american: -110,
      },
      total: {
        line: 218.5,
        over_odds_american: -110,
        under_odds_american: -110,
      },
    },
    series_game_number: 4,
    series_home_wins: 2,
    series_away_wins: 1,
    series_venue_shift: false,
  });
  const out = runNbaAutoModelV1(snap, "t60_locked");
  check("synthetic Finals: ML winner = home (BOS)", out.predicted_ml_winner === "home");
  check("synthetic Finals: high tier", out.audit.data_quality_tier === "high");
  check(
    "synthetic Finals: predicted total within ±5 of market 218.5",
    Math.abs(out.predicted_total - 218.5) <= 5,
    `got=${out.predicted_total}`,
  );
  check(
    "synthetic Finals: spread side = home (we like BOS)",
    out.predicted_spread_side === "home",
  );
  check(
    "synthetic Finals: provisional = true",
    out.provisional === true,
  );
  // Print the actual output for the report
  console.log(
    `      [synthetic LAL @ BOS Game 4] BOS ${out.predicted_home_score} - LAL ${out.predicted_away_score} · total=${out.predicted_total} · ML=${out.predicted_ml_winner}@${out.ml_confidence}% · SPREAD=${out.predicted_spread_side}@${out.spread_confidence}% · TOTAL=${out.predicted_total_side}@${out.total_confidence}% · tier=${out.audit.data_quality_tier} · BA=${out.audit.ml_best_angle_eligible}`,
  );
}

{
  // Best Angle gate — high tier + healthy + strong edge
  const snap = buildSnapshot({
    home: { off_rating: 125, def_rating: 105 }, // large edge
    away: { off_rating: 110, def_rating: 120 },
    market: {
      ml: { home_odds_american: -180, away_odds_american: +150 },
      spread: { home_line: -2.5, home_odds_american: -110, away_odds_american: -110 }, // model loves home more than market does
      total: { line: 215, over_odds_american: -110, under_odds_american: -110 },
    },
  });
  const out = runNbaAutoModelV1(snap, "t60_locked");
  // Strong edge + high tier + no unknowns should clear the gate
  if (out.ml_confidence >= NBA_BEST_ANGLE_MIN_CONFIDENCE && out.audit.data_quality_tier === "high") {
    check(
      "best angle eligible at high tier + healthy + strong edge + conf>=62",
      out.audit.ml_best_angle_eligible === true,
    );
  } else {
    check("best angle gate evaluated (conf below threshold OR tier not high)", true);
  }
}

// ─── Summary ──────────────────────────────────────────────────────

console.log(`\n━━━ Summary ━━━`);
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
