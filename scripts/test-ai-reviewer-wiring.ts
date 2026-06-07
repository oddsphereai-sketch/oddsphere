/**
 * Phase 4.2.C.1.R-16 wiring tests — pure unit tests for
 * `aiReviewerWiring`. No DB / no network. Synthetic fixtures.
 */
import type {
  AutoModelOutput,
  AutoModelSportSpecific,
  AutoFactors,
  AiSanityRecord,
  GameSnapshot,
} from "../lib/automodel/types";
import {
  applyReviewerIfEnabled,
  buildReviewerInput,
  composeReviewedPrediction,
  type ReviewerSlateContext,
} from "../lib/services/aiReviewerWiring";
import {
  reviewGamePrediction,
  type ReviewV1AuditRecord,
} from "../lib/services/aiReviewerV1";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
    failures.push(label);
  }
}

function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

// ─── Fixture builders ─────────────────────────────────────────────────

const defaultAutoFactors: AutoFactors = {
  home_starter_id: 100,
  away_starter_id: 200,
  home_starter_era: 4.0,
  away_starter_era: 4.0,
  home_starter_era_factor: 1.0,
  away_starter_era_factor: 1.0,
  home_lineup_weighted_ops: 0.7,
  away_lineup_weighted_ops: 0.7,
  home_lineup_ops_factor_adjusted: 1.0,
  away_lineup_ops_factor_adjusted: 1.0,
  home_bullpen_factor: 1.0,
  away_bullpen_factor: 1.0,
  park_factor_runs: 1.0,
  weather_total_adjust: 0,
  league_avg_runs_used: 4.4,
  league_avg_era_used: 4.4,
  league_avg_ops_used: 0.72,
  stage_confidence_cap: 68,
  nrfi_expected_runs: 0.56,
  nrfi_used_fallback_era: false,
  nrfi_used_top_of_order_data: true,
  ml_raw_confidence: 60,
  ml_dampening_penalty: 0,
  ml_dampening_reasons: [],
  ou_raw_confidence: 50,
  ou_dampening_penalty: 0,
  ou_dampening_reasons: [],
};

const defaultAiSanity: AiSanityRecord = {
  action: "approve",
  reasoning: "ok",
  applied_confidence_delta: 0,
  applied_score_delta_home: 0,
  applied_score_delta_away: 0,
  warnings: [],
  deterministic_corrections: [],
};

const defaultSportSpecific: AutoModelSportSpecific = {
  model_version: "test",
  stage: "morning_draft",
  starter_confirmed: true,
  lineup_confirmed: true,
  market_line_available: true,
  opposing_deterministic_warning: false,
  listed_line: 9.0,
  held: false,
  hold_reason: null,
  hold_picks: [],
  stale: false,
  stale_reason: null,
  predicted_nrfi: null,
  nrfi_confidence: 52,
  auto_factors: defaultAutoFactors,
  ai_sanity: defaultAiSanity,
};

function rawPrediction(overrides?: Partial<AutoModelOutput>): AutoModelOutput {
  return {
    game_external_id: 5000001,
    prediction_source: "auto_v1_mlb_rules",
    predicted_home_score: 4.5,
    predicted_away_score: 4.5,
    predicted_total: 9.0,
    predicted_ml_winner: "home",
    ml_confidence: 60,
    predicted_ou_side: "under",
    ou_confidence: 50,
    predicted_nrfi: null,
    nrfi_confidence: 52,
    sport_specific: defaultSportSpecific,
    ...(overrides as object),
  };
}

function snap(overrides?: Partial<GameSnapshot>): GameSnapshot {
  return {
    game_external_id: 5000001,
    slate_date: "2026-06-04",
    game_date: "2026-06-04T23:10:00Z",
    home_team: {
      team_external_id: 1,
      abbreviation: "HOM",
      bullpen_era_proxy: 4.0,
      season_runs_per_game: 4.5,
    },
    away_team: {
      team_external_id: 2,
      abbreviation: "AWY",
      bullpen_era_proxy: 4.0,
      season_runs_per_game: 4.5,
    },
    home_starter: {
      player_external_id: 100,
      player_name: "Home Ace",
      throws: "R",
      season_era: 4.0,
      season_whip: 1.25,
      season_k_per_9: 8.5,
      last30_era: null,
      pitch_quality_score: null,
      is_confirmed: true,
      is_scratched: false,
      first_inning_era: null,
      first_inning_starts: null,
      first_inning_whip: null,
      season_games_started: 12,
      season_games_pitched: 12,
      season_innings_pitched: 75,
    },
    away_starter: {
      player_external_id: 200,
      player_name: "Away Ace",
      throws: "L",
      season_era: 4.0,
      season_whip: 1.25,
      season_k_per_9: 8.5,
      last30_era: null,
      pitch_quality_score: null,
      is_confirmed: true,
      is_scratched: false,
      first_inning_era: null,
      first_inning_starts: null,
      first_inning_whip: null,
      season_games_started: 12,
      season_games_pitched: 12,
      season_innings_pitched: 75,
    },
    home_lineup_top8: [],
    away_lineup_top8: [],
    ballpark: { park_factor_runs: 100, is_dome: false },
    weather: null,
    market: {
      listed_total: 9.0,
      home_ml_odds_american: -130,
      away_ml_odds_american: +110,
      over_odds_american: null, under_odds_american: null, has_pinnacle_total: true,
    },
    sharp: null,
    active_injuries: {
      home_starter_out: false,
      away_starter_out: false,
      home_top3_hitters_injured_count: 0,
      away_top3_hitters_injured_count: 0,
    },
    data_quality: {
      starter_confirmed: true,
      lineup_confirmed: true,
      weather_available: false,
      season_stats_present: true,
    },
    ...(overrides as object),
  };
}

function ctxFor(externalId: number, novigPick: number | null, novigOpp: number | null): ReviewerSlateContext {
  const m = new Map<number, { home_novig: number | null; away_novig: number | null; source_book: string | null }>();
  m.set(externalId, {
    home_novig: novigPick,
    away_novig: novigOpp,
    source_book: novigPick !== null ? "test" : null,
  });
  return { noVigByExternalId: m };
}

// ─── Tests ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  section("Default OFF — env flag missing → no-op");
  {
    delete process.env.REVIEWER_V1_ENABLED;
    const raw = rawPrediction();
    const out = applyReviewerIfEnabled(snap(), raw, "morning_draft", ctxFor(5000001, 0.5, 0.5));
    check("[wiring] env unset returns rawPrediction unchanged", out === raw);
  }

  section("ENABLED — reviewer fires");
  {
    process.env.REVIEWER_V1_ENABLED = "true";
    try {
      const raw = rawPrediction({
        predicted_home_score: 9.2,
        predicted_away_score: 3.3,
        predicted_total: 12.5,
        predicted_ml_winner: "home",
        ml_confidence: 68,
        predicted_ou_side: "over", // total 12.5 vs line 8.5 → over (consistency)
        ou_confidence: 63.8,
        sport_specific: {
          ...defaultSportSpecific,
          listed_line: 8.5,
          auto_factors: {
            ...defaultAutoFactors,
            ml_raw_confidence: 206.6,
            home_starter_era: 2.57,
            away_starter_era: 10.38,
          },
        },
      });
      const reviewer_snap = snap({
        market: {
          listed_total: 8.5,
          home_ml_odds_american: -110,
          away_ml_odds_american: -112,
          over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
        },
        away_starter: {
          ...(snap().away_starter ?? {} as any),
          season_era: 10.38,
          season_games_started: 1,
          season_innings_pitched: 4.3,
        },
      });
      const out = applyReviewerIfEnabled(
        reviewer_snap,
        raw,
        "morning_draft",
        ctxFor(5000001, 0.498, 0.502)
      );
      check(
        "[wiring] PIT@HOU-style: reviewer caps ml_confidence to 52 (R-16 wiring cap)",
        out.ml_confidence === 52
      );
      check(
        "[wiring] PIT@HOU-style: scores adjusted toward market",
        out.predicted_home_score !== null &&
          out.predicted_away_score !== null &&
          Math.abs(out.predicted_home_score - out.predicted_away_score) <
            Math.abs(9.2 - 3.3)
      );
      check(
        "[wiring] PIT@HOU-style: ml_winner preserved (V1 deterministic does not flip)",
        out.predicted_ml_winner === "home"
      );
      const sp = out.sport_specific as AutoModelSportSpecific & { review_v1?: unknown };
      check(
        "[wiring] sport_specific.review_v1 audit record populated",
        sp.review_v1 !== undefined && sp.review_v1 !== null
      );
      const audit = sp.review_v1 as ReviewV1AuditRecord;
      check(
        "[wiring] audit.raw.ml_confidence preserves the raw 68",
        audit.raw.ml_confidence === 68
      );
      check(
        "[wiring] audit.reviewed.ml_confidence reflects the cap 52",
        audit.reviewed.ml_confidence === 52
      );
      check(
        "[wiring] audit.actions.ml == cap_confidence",
        audit.actions.ml === "cap_confidence"
      );
      check(
        "[wiring] audit.logic_audit_passed",
        audit.logic_audit_passed === true
      );
    } finally {
      delete process.env.REVIEWER_V1_ENABLED;
    }
  }

  section("ENABLED — aligned game produces no intervention");
  {
    process.env.REVIEWER_V1_ENABLED = "true";
    try {
      const raw = rawPrediction();
      const out = applyReviewerIfEnabled(
        snap(),
        raw,
        "morning_draft",
        ctxFor(5000001, 0.5, 0.5)
      );
      check(
        "[wiring] aligned game ml_confidence unchanged",
        out.ml_confidence === raw.ml_confidence
      );
      check(
        "[wiring] aligned game scores unchanged",
        out.predicted_home_score === raw.predicted_home_score &&
          out.predicted_away_score === raw.predicted_away_score
      );
      const sp = out.sport_specific as AutoModelSportSpecific & { review_v1?: unknown };
      const audit = sp.review_v1 as ReviewV1AuditRecord;
      check(
        "[wiring] aligned game ml_action == keep",
        audit.actions.ml === "keep"
      );
    } finally {
      delete process.env.REVIEWER_V1_ENABLED;
    }
  }

  section("ENABLED — missing starter holds ML");
  {
    process.env.REVIEWER_V1_ENABLED = "true";
    try {
      const raw = rawPrediction();
      const out = applyReviewerIfEnabled(
        snap({ away_starter: null }),
        raw,
        "morning_draft",
        ctxFor(5000001, 0.5, 0.5)
      );
      check(
        "[wiring] missing starter → ml_winner null",
        out.predicted_ml_winner === null
      );
      check(
        "[wiring] missing starter → ml_confidence null",
        out.ml_confidence === null
      );
      const audit = (out.sport_specific as any).review_v1 as ReviewV1AuditRecord;
      check(
        "[wiring] missing starter → audit.actions.ml == hold",
        audit.actions.ml === "hold"
      );
    } finally {
      delete process.env.REVIEWER_V1_ENABLED;
    }
  }

  section("ENABLED — missing market line holds OU");
  {
    process.env.REVIEWER_V1_ENABLED = "true";
    try {
      const raw = rawPrediction({
        predicted_ou_side: null,
        ou_confidence: null,
        sport_specific: {
          ...defaultSportSpecific,
          listed_line: null,
          market_line_available: false,
        },
      });
      const out = applyReviewerIfEnabled(
        snap({
          market: {
            listed_total: null,
            home_ml_odds_american: null,
            away_ml_odds_american: null,
            over_odds_american: null, under_odds_american: null, has_pinnacle_total: false,
          },
        }),
        raw,
        "morning_draft",
        ctxFor(5000001, null, null)
      );
      const audit = (out.sport_specific as any).review_v1 as ReviewV1AuditRecord;
      check(
        "[wiring] missing market line → audit.actions.ou == hold",
        audit.actions.ou === "hold"
      );
    } finally {
      delete process.env.REVIEWER_V1_ENABLED;
    }
  }

  section("Logic audit failure → fail-closed hold-all-markets");
  {
    // Force an inconsistency: model says home but scores favor away.
    process.env.REVIEWER_V1_ENABLED = "true";
    try {
      const raw = rawPrediction({
        predicted_home_score: 3.0,
        predicted_away_score: 5.0,
        predicted_total: 8.0,
        predicted_ml_winner: "home", // INCONSISTENT
      });
      const out = applyReviewerIfEnabled(
        snap(),
        raw,
        "morning_draft",
        ctxFor(5000001, 0.5, 0.5)
      );
      const sp = out.sport_specific as AutoModelSportSpecific;
      check(
        "[wiring] logic audit failure → held=true",
        sp.held === true
      );
      check(
        "[wiring] logic audit failure → hold_reason=reviewer_logic_audit_failed",
        sp.hold_reason === "reviewer_logic_audit_failed"
      );
      check(
        "[wiring] logic audit failure → hold_picks all three",
        sp.hold_picks.length === 3
      );
      check(
        "[wiring] logic audit failure → ml_winner null",
        out.predicted_ml_winner === null
      );
      check(
        "[wiring] logic audit failure → ou_side null",
        out.predicted_ou_side === null
      );
      const audit = (sp as any).review_v1 as ReviewV1AuditRecord;
      check(
        "[wiring] logic audit failure → audit captures failure",
        audit.logic_audit_passed === false
      );
    } finally {
      delete process.env.REVIEWER_V1_ENABLED;
    }
  }

  section("buildReviewerInput — public_smoke detection from sharp snapshot");
  {
    const raw = rawPrediction({ predicted_ml_winner: "home" });
    const ctx = ctxFor(5000001, 0.6, 0.4);
    const input = buildReviewerInput(
      snap({
        sharp: {
          pinnacle_ml_fair_prob_home: null,
          pinnacle_ml_fair_prob_away: null,
          pinnacle_total_ev_pct: null,
          pinnacle_ml_ev_pct: null,
          public_betting_pct_home: 82,
          public_money_pct_home: 80,
          public_betting_pct_over: null,
          public_money_pct_over: null,
          ml_plus_ev_side: null,
          total_plus_ev_side: null,
        } as any,
      }),
      raw,
      "morning_draft",
      ctx
    );
    check(
      "[wiring] public_smoke_aligned_with_pick computed from sharp snapshot",
      input.market.public_smoke_aligned_with_pick === true
    );
  }

  section("buildReviewerInput — away-pick splits derive from home complement");
  {
    const raw = rawPrediction({ predicted_ml_winner: "away" });
    const input = buildReviewerInput(
      snap({
        sharp: {
          pinnacle_ml_fair_prob_home: null,
          pinnacle_ml_fair_prob_away: null,
          pinnacle_total_ev_pct: null,
          pinnacle_ml_ev_pct: null,
          public_betting_pct_home: 18,
          public_money_pct_home: 20,
          public_betting_pct_over: null,
          public_money_pct_over: null,
          ml_plus_ev_side: null,
          total_plus_ev_side: null,
        } as any,
      }),
      raw,
      "morning_draft",
      ctxFor(5000001, 0.5, 0.5)
    );
    check(
      "[wiring] away pick → public_bets_pick_pct == 100 - home_bets",
      input.market.public_bets_pick_pct === 82
    );
  }

  section("composeReviewedPrediction — NRFI passes through unchanged");
  {
    const raw = rawPrediction({
      predicted_nrfi: false,
      nrfi_confidence: 59.9,
    });
    const reviewedInput = buildReviewerInput(
      snap(),
      raw,
      "morning_draft",
      ctxFor(5000001, 0.5, 0.5)
    );
    const reviewed = reviewGamePrediction(reviewedInput);
    const out = composeReviewedPrediction(raw, reviewedInput, reviewed);
    check(
      "[wiring] NRFI passthrough — predicted_nrfi preserved",
      out.predicted_nrfi === false
    );
    check(
      "[wiring] NRFI passthrough — nrfi_confidence preserved",
      out.nrfi_confidence === 59.9
    );
  }

  section("Audit record — JSON size remains compact through wiring");
  {
    process.env.REVIEWER_V1_ENABLED = "true";
    try {
      const raw = rawPrediction({
        predicted_home_score: 9.2,
        predicted_away_score: 3.3,
        predicted_total: 12.5,
        ml_confidence: 68,
        sport_specific: {
          ...defaultSportSpecific,
          auto_factors: {
            ...defaultAutoFactors,
            ml_raw_confidence: 206.6,
          },
        },
      });
      const out = applyReviewerIfEnabled(
        snap(),
        raw,
        "morning_draft",
        ctxFor(5000001, 0.498, 0.502)
      );
      const audit = (out.sport_specific as any).review_v1;
      check(
        "[wiring] audit JSON < 1000 bytes through wiring",
        JSON.stringify(audit).length < 1000
      );
    } finally {
      delete process.env.REVIEWER_V1_ENABLED;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:\n${failures.map((m) => `  ✗ ${m}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\n✅ All R-16 wiring tests passed.`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
