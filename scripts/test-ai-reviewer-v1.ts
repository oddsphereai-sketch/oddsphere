/**
 * Phase 4.2.C.1.R-16 — pure tests for `aiReviewerV1`.
 * No DB. No network. Synthetic fixtures only.
 */
import {
  reviewGamePrediction,
  buildAuditRecord,
  type ReviewerInput,
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

function baseline(overrides?: Partial<ReviewerInput>): ReviewerInput {
  const top: Omit<
    ReviewerInput,
    "raw" | "starters" | "bullpen" | "market" | "data_quality"
  > = {
    game_external_id: overrides?.game_external_id ?? 9999,
    stage: overrides?.stage ?? "morning_draft",
  };
  return {
    ...top,
    raw: { ...baseline_raw_default(), ...(overrides?.raw ?? {}) },
    starters: { ...baseline_starters_default(), ...(overrides?.starters ?? {}) },
    bullpen: { ...baseline_bullpen_default(), ...(overrides?.bullpen ?? {}) },
    market: { ...baseline_market_default(), ...(overrides?.market ?? {}) },
    data_quality: { ...baseline_dq_default(), ...(overrides?.data_quality ?? {}) },
  };
}

function baseline_raw_default() {
  return {
    predicted_home_score: 4.5,
    predicted_away_score: 4.5,
    predicted_total: 9.0,
    listed_total: 9.0,
    predicted_ml_winner: "home" as const,
    ml_confidence: 60,
    ml_raw_confidence: 60,
    predicted_ou_side: "under" as const,
    ou_confidence: 50,
    ou_raw_confidence: 50,
    predicted_nrfi: null,
    nrfi_decision_kind: "toss_up" as const,
    nrfi_confidence: 52,
    nrfi_expected_runs: 0.56,
  };
}
function baseline_starters_default() {
  return {
    home_starter_id: 100,
    home_starter_era: 4.0,
    home_starter_gs: 12,
    home_starter_ip: 75,
    away_starter_id: 200,
    away_starter_era: 4.0,
    away_starter_gs: 12,
    away_starter_ip: 75,
  };
}
function baseline_bullpen_default() {
  return { home_bullpen_era_proxy: 4.0, away_bullpen_era_proxy: 4.0 };
}
function baseline_market_default() {
  return {
    ml_novig_pick_prob: 0.5,
    ml_novig_opposite_prob: 0.5,
    public_bets_pick_pct: 50,
    public_money_pick_pct: 50,
    ml_plus_ev_side: null,
    total_plus_ev_side: null,
    public_smoke_aligned_with_pick: false,
  };
}
function baseline_dq_default() {
  return {
    starter_confirmed: true,
    lineup_confirmed: true,
    market_line_available: true,
    bullpen_fallback: false,
  };
}

async function main() {
  section("Baseline — no action when model/market/data aligned");
  {
    const out = reviewGamePrediction(baseline());
    check("[R-16] baseline ml_action == keep", out.ml_action === "keep");
    check("[R-16] baseline ou_action == keep", out.ou_action === "keep");
    check("[R-16] baseline review_flags empty", out.review_flags.length === 0);
    check("[R-16] baseline review_reasons empty", out.review_reasons.length === 0);
    check("[R-16] baseline logic_audit_passed", out.logic_audit_passed === true);
    check("[R-16] baseline ml_confidence preserved", out.ml_confidence === 60);
  }

  section("PIT @ HOU-style: extreme model-market disagreement");
  {
    const out = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 9.2,
          predicted_away_score: 3.3,
          predicted_total: 12.5,
          listed_total: 8.5,
          predicted_ml_winner: "home",
          ml_confidence: 68,
          ml_raw_confidence: 206.6,
          predicted_ou_side: "over",
          ou_confidence: 63.8,
          ou_raw_confidence: 85.2,
          predicted_nrfi: null,
          nrfi_decision_kind: "toss_up",
          nrfi_confidence: 52,
          nrfi_expected_runs: 0.55,
        },
        starters: {
          home_starter_id: 100,
          home_starter_era: 2.57,
          home_starter_gs: 12,
          home_starter_ip: 75,
          away_starter_id: 200,
          away_starter_era: 10.38,
          away_starter_gs: 1,
          away_starter_ip: 4.3,
        },
        market: {
          ml_novig_pick_prob: 0.498,
          ml_novig_opposite_prob: 0.502,
          public_bets_pick_pct: 57,
          public_money_pick_pct: 71,
          ml_plus_ev_side: null,
          total_plus_ev_side: "over",
          public_smoke_aligned_with_pick: false,
        },
      })
    );
    check(
      "[R-16] PIT@HOU — extreme_run_diff_with_coinflip_market flag fires",
      out.review_flags.includes("extreme_run_diff_with_coinflip_market")
    );
    check(
      "[R-16] PIT@HOU — small_sample_starter_driver flag fires",
      out.review_flags.includes("small_sample_starter_driver")
    );
    check(
      "[R-16] PIT@HOU — raw_conf_extreme_fragile flag fires",
      out.review_flags.includes("raw_conf_extreme_fragile")
    );
    check(
      "[R-16] PIT@HOU — huge_model_market_gap flag fires",
      out.review_flags.includes("huge_model_market_gap")
    );
    check(
      "[R-16] PIT@HOU — ml_action becomes cap_confidence",
      out.ml_action === "cap_confidence"
    );
    check(
      "[R-16] PIT@HOU — ml_confidence capped at 52",
      out.ml_confidence === 52
    );
    check(
      "[R-16] PIT@HOU — review_recommends_caution flag added",
      out.review_flags.includes("review_recommends_caution")
    );
    check(
      "[R-16] PIT@HOU — pick side preserved (V1 deterministic does not flip; reserved for R-16B)",
      out.predicted_ml_winner === "home"
    );
    check(
      "[R-16] PIT@HOU — scores adjusted toward market (halved differential)",
      out.predicted_home_score !== null &&
        out.predicted_away_score !== null &&
        Math.abs(out.predicted_home_score - out.predicted_away_score) <
          Math.abs(9.2 - 3.3)
    );
    check(
      "[R-16] PIT@HOU — adjusted total stays consistent with adjusted scores",
      out.predicted_total !== null &&
        out.predicted_home_score !== null &&
        out.predicted_away_score !== null &&
        Math.abs(
          out.predicted_total -
            (out.predicted_home_score + out.predicted_away_score)
        ) <= 0.05
    );
    check(
      "[R-16] PIT@HOU — logic audit still passes after adjustment",
      out.logic_audit_passed === true
    );
  }

  section("Small-sample starter overreaction (single fragility)");
  {
    // Single flag only — should NOT trigger the cap (requires 2+).
    const out = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 6.5,
          predicted_away_score: 4.0,
          predicted_total: 10.5,
          listed_total: 9.5,
          predicted_ml_winner: "home",
          ml_confidence: 64,
          ml_raw_confidence: 80,
          predicted_ou_side: "over",
          ou_confidence: 54,
          ou_raw_confidence: 54,
          predicted_nrfi: null,
          nrfi_decision_kind: "toss_up",
          nrfi_confidence: 52,
          nrfi_expected_runs: 0.55,
        },
        starters: {
          home_starter_id: 100,
          home_starter_era: 3.5,
          home_starter_gs: 12,
          home_starter_ip: 75,
          away_starter_id: 200,
          away_starter_era: 6.0,
          away_starter_gs: 2,
          away_starter_ip: 8,
        },
        market: {
          ml_novig_pick_prob: 0.58,
          ml_novig_opposite_prob: 0.42,
          public_bets_pick_pct: 50,
          public_money_pick_pct: 50,
          ml_plus_ev_side: null,
          total_plus_ev_side: null,
          public_smoke_aligned_with_pick: false,
        },
      })
    );
    check(
      "[R-16] single-fragility small-sample fires the flag",
      out.review_flags.includes("small_sample_starter_driver")
    );
    check(
      "[R-16] single fragility — ml_action stays keep (no cap)",
      out.ml_action === "keep"
    );
    check(
      "[R-16] single fragility — ml_confidence preserved",
      out.ml_confidence === 64
    );
  }

  section("OU sharp conflict");
  {
    const out = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 6.0,
          predicted_away_score: 5.0,
          predicted_total: 11.0,
          listed_total: 9.5,
          predicted_ml_winner: "home",
          ml_confidence: 60,
          ml_raw_confidence: 60,
          predicted_ou_side: "over",
          ou_confidence: 62,
          ou_raw_confidence: 62,
          predicted_nrfi: null,
          nrfi_decision_kind: "toss_up",
          nrfi_confidence: 52,
          nrfi_expected_runs: 0.55,
        },
        market: {
          ml_novig_pick_prob: 0.58,
          ml_novig_opposite_prob: 0.42,
          public_bets_pick_pct: 50,
          public_money_pick_pct: 50,
          ml_plus_ev_side: null,
          total_plus_ev_side: "under",
          public_smoke_aligned_with_pick: false,
        },
      })
    );
    check(
      "[R-16] ou_sharp_conflict flag fires",
      out.review_flags.includes("ou_sharp_conflict")
    );
    check(
      "[R-16] ou_action stays keep (R-14B already dampened; flag only)",
      out.ou_action === "keep"
    );
  }

  section("Missing starter — ML held");
  {
    const out = reviewGamePrediction(
      baseline({
        starters: {
          home_starter_id: 100,
          home_starter_era: 4.0,
          home_starter_gs: 12,
          home_starter_ip: 75,
          away_starter_id: null,
          away_starter_era: null,
          away_starter_gs: null,
          away_starter_ip: null,
        },
      })
    );
    check(
      "[R-16] missing_starter flag fires",
      out.review_flags.includes("missing_starter")
    );
    check("[R-16] missing starter ml_action == hold", out.ml_action === "hold");
    check(
      "[R-16] missing starter ml_winner nulled",
      out.predicted_ml_winner === null
    );
    check(
      "[R-16] missing starter ml_confidence nulled",
      out.ml_confidence === null
    );
  }

  section("Starter stats fallback — usable proxy, ML NOT held (P1A 2026-06-12)");
  {
    // MIA/PIT-style case: home starter player-row link missing
    // (starter_id null) but the model has usable starter ERA via a
    // fallback/proxy (e.g., team-season aggregate). The reviewer should
    // NOT emit `missing_starter` and should NOT null the ML pick;
    // instead it emits the non-blocking `starter_stats_fallback` marker.
    const out = reviewGamePrediction(
      baseline({
        starters: {
          home_starter_id: 100,
          home_starter_era: 4.0,
          home_starter_gs: 12,
          home_starter_ip: 75,
          away_starter_id: null,
          away_starter_era: 3.28, // fallback / proxy populated
          away_starter_gs: null,
          away_starter_ip: null,
        },
      })
    );
    check(
      "[P1A] starter_stats_fallback flag fires",
      out.review_flags.includes("starter_stats_fallback")
    );
    check(
      "[P1A] missing_starter flag does NOT fire when fallback stats available",
      !out.review_flags.includes("missing_starter")
    );
    check(
      "[P1A] ml_action stays keep (no hold)",
      out.ml_action !== "hold"
    );
    check(
      "[P1A] predicted_ml_winner preserved (NOT nulled)",
      out.predicted_ml_winner !== null
    );
    check(
      "[P1A] ml_confidence preserved (NOT nulled)",
      out.ml_confidence !== null
    );
  }

  section("Both sides starter stats fallback — single flag, ML still proceeds");
  {
    const out = reviewGamePrediction(
      baseline({
        starters: {
          home_starter_id: null,
          home_starter_era: 3.5,
          home_starter_gs: null,
          home_starter_ip: null,
          away_starter_id: null,
          away_starter_era: 4.1,
          away_starter_gs: null,
          away_starter_ip: null,
        },
      })
    );
    check(
      "[P1A] starter_stats_fallback fires when both sides use proxy",
      out.review_flags.includes("starter_stats_fallback")
    );
    check(
      "[P1A] no missing_starter even with both sides id-null",
      !out.review_flags.includes("missing_starter")
    );
    check(
      "[P1A] both-sides fallback does not hold ML",
      out.ml_action !== "hold" && out.predicted_ml_winner !== null
    );
  }

  section("Truly missing starter — both id AND era null → still holds ML");
  {
    // Confirm the original missing_starter behavior is unchanged when
    // there is no usable signal at all (no id-link AND no fallback ERA).
    const out = reviewGamePrediction(
      baseline({
        starters: {
          home_starter_id: 100,
          home_starter_era: 4.0,
          home_starter_gs: 12,
          home_starter_ip: 75,
          away_starter_id: null,
          away_starter_era: null,
          away_starter_gs: null,
          away_starter_ip: null,
        },
      })
    );
    check(
      "[P1A] missing_starter still fires when neither id nor era available",
      out.review_flags.includes("missing_starter")
    );
    check(
      "[P1A] starter_stats_fallback NOT emitted in truly-missing case",
      !out.review_flags.includes("starter_stats_fallback")
    );
    check(
      "[P1A] truly-missing case still holds ML",
      out.ml_action === "hold" && out.predicted_ml_winner === null
    );
  }

  section("Missing market line — OU held");
  {
    const out = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 4.5,
          predicted_away_score: 4.5,
          predicted_total: 9.0,
          listed_total: null,
          predicted_ml_winner: "home",
          ml_confidence: 60,
          ml_raw_confidence: 60,
          predicted_ou_side: null,
          ou_confidence: null,
          ou_raw_confidence: null,
          predicted_nrfi: null,
          nrfi_decision_kind: "toss_up",
          nrfi_confidence: 52,
          nrfi_expected_runs: 0.56,
        },
        data_quality: {
          starter_confirmed: true,
          lineup_confirmed: true,
          market_line_available: false,
          bullpen_fallback: false,
        },
      })
    );
    check(
      "[R-16] missing_market_line flag fires",
      out.review_flags.includes("missing_market_line")
    );
    check(
      "[R-16] missing line ou_action == hold",
      out.ou_action === "hold"
    );
    check(
      "[R-16] missing line ou_side nulled",
      out.predicted_ou_side === null
    );
  }

  section("Score ↔ ML consistency audit");
  {
    // Manually rig a score/ML inconsistency (model says home but home < away).
    const out = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 3.0,
          predicted_away_score: 5.0,
          predicted_total: 8.0,
          listed_total: 8.0,
          predicted_ml_winner: "home", // INCONSISTENT
          ml_confidence: 60,
          ml_raw_confidence: 60,
          predicted_ou_side: "under",
          ou_confidence: 50,
          ou_raw_confidence: 50,
          predicted_nrfi: null,
          nrfi_decision_kind: "toss_up",
          nrfi_confidence: 52,
          nrfi_expected_runs: 0.55,
        },
      })
    );
    check(
      "[R-16] score_ml_inconsistency flag fires",
      out.review_flags.includes("score_ml_inconsistency")
    );
    check(
      "[R-16] logic audit fails",
      out.logic_audit_passed === false &&
        out.logic_audit_errors.length >= 1
    );
  }

  section("OU ↔ predicted_total consistency audit");
  {
    // Projected total > listed but OU pick is under.
    const out = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 6.0,
          predicted_away_score: 5.0,
          predicted_total: 11.0,
          listed_total: 9.0,
          predicted_ml_winner: "home",
          ml_confidence: 60,
          ml_raw_confidence: 60,
          predicted_ou_side: "under", // INCONSISTENT
          ou_confidence: 60,
          ou_raw_confidence: 60,
          predicted_nrfi: null,
          nrfi_decision_kind: "toss_up",
          nrfi_confidence: 52,
          nrfi_expected_runs: 0.55,
        },
      })
    );
    check(
      "[R-16] total_ou_inconsistency flag fires",
      out.review_flags.includes("total_ou_inconsistency")
    );
    check(
      "[R-16] logic audit fails",
      out.logic_audit_passed === false
    );
  }

  section("FI zone consistency — toss_up is the data-quality safety net");
  {
    // Toss-Up with low expected_runs is LEGITIMATE — the 5-zone scheme
    // downgrades a lean to toss_up when data-quality caps push confidence
    // below floor. Reviewer must NOT flag this.
    const tossUpLow = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 4.5,
          predicted_away_score: 4.5,
          predicted_total: 9.0,
          listed_total: 9.0,
          predicted_ml_winner: "home",
          ml_confidence: 60,
          ml_raw_confidence: 60,
          predicted_ou_side: "under",
          ou_confidence: 50,
          ou_raw_confidence: 50,
          predicted_nrfi: null,
          nrfi_decision_kind: "toss_up",
          nrfi_confidence: 52,
          nrfi_expected_runs: 0.3, // looks NRFI but downgraded to toss_up — VALID
        },
      })
    );
    check(
      "[R-16] toss_up with low expected_runs is allowed (no flag)",
      !tossUpLow.review_flags.includes("fi_zone_inconsistency")
    );
    check(
      "[R-16] toss_up logic audit passes (downgrade safety net respected)",
      tossUpLow.logic_audit_passed === true
    );

    // Real inconsistency: explicit NRFI call when expected runs are in YRFI zone.
    const nrfiInYrfiZone = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 4.5,
          predicted_away_score: 4.5,
          predicted_total: 9.0,
          listed_total: 9.0,
          predicted_ml_winner: "home",
          ml_confidence: 60,
          ml_raw_confidence: 60,
          predicted_ou_side: "under",
          ou_confidence: 50,
          ou_raw_confidence: 50,
          predicted_nrfi: true,
          nrfi_decision_kind: "nrfi",
          nrfi_confidence: 55,
          nrfi_expected_runs: 0.75, // YRFI zone — contradicts NRFI call
        },
      })
    );
    check(
      "[R-16] fi_zone_inconsistency fires for NRFI call in YRFI zone",
      nrfiInYrfiZone.review_flags.includes("fi_zone_inconsistency")
    );
    check(
      "[R-16] logic audit fails on NRFI/YRFI mismatch",
      nrfiInYrfiZone.logic_audit_passed === false
    );
  }

  section("FI Toss-Up — does not appear on ML/OU side of the audit");
  {
    const out = reviewGamePrediction(baseline());
    // FI Toss-Up is allowed; reviewer should NOT have flipped/dampened ML/OU because of FI Toss-Up.
    check(
      "[R-16] FI=toss_up does not trigger ML/OU intervention",
      out.ml_action === "keep" && out.ou_action === "keep"
    );
    check(
      "[R-16] NRFI passes through unchanged in V1",
      out.predicted_nrfi === null &&
        out.nrfi_decision_kind === "toss_up" &&
        out.nrfi_confidence === 52
    );
  }

  section("Public-smoke alignment flag");
  {
    const out = reviewGamePrediction(
      baseline({
        market: {
          ml_novig_pick_prob: 0.6,
          ml_novig_opposite_prob: 0.4,
          public_bets_pick_pct: 85,
          public_money_pick_pct: 82,
          ml_plus_ev_side: null,
          total_plus_ev_side: null,
          public_smoke_aligned_with_pick: true,
        },
      })
    );
    check(
      "[R-16] public_smoke_aligned_with_pick flag fires",
      out.review_flags.includes("public_smoke_aligned_with_pick")
    );
    check(
      "[R-16] public-smoke alone does not cap (R-14B already dampened)",
      out.ml_action === "keep"
    );
  }

  section("Bullpen fallback flag");
  {
    const out = reviewGamePrediction(
      baseline({
        bullpen: {
          home_bullpen_era_proxy: null,
          away_bullpen_era_proxy: 4.0,
        },
        data_quality: {
          starter_confirmed: true,
          lineup_confirmed: true,
          market_line_available: true,
          bullpen_fallback: true,
        },
      })
    );
    check(
      "[R-16] bullpen_fallback flag fires when flag set",
      out.review_flags.includes("bullpen_fallback")
    );
  }

  section("V1 deterministic mode — no ML flip yet (reserved for R-16B)");
  {
    const out = reviewGamePrediction(
      baseline({
        raw: {
          predicted_home_score: 9.2,
          predicted_away_score: 3.3,
          predicted_total: 12.5,
          listed_total: 8.5,
          predicted_ml_winner: "home",
          ml_confidence: 68,
          ml_raw_confidence: 206.6,
          predicted_ou_side: "over",
          ou_confidence: 63.8,
          ou_raw_confidence: 85.2,
          predicted_nrfi: null,
          nrfi_decision_kind: "toss_up",
          nrfi_confidence: 52,
          nrfi_expected_runs: 0.55,
        },
        starters: {
          home_starter_id: 100,
          home_starter_era: 2.57,
          home_starter_gs: 12,
          home_starter_ip: 75,
          away_starter_id: 200,
          away_starter_era: 10.38,
          away_starter_gs: 1,
          away_starter_ip: 4.3,
        },
        market: {
          ml_novig_pick_prob: 0.498,
          ml_novig_opposite_prob: 0.502,
          public_bets_pick_pct: 57,
          public_money_pick_pct: 71,
          ml_plus_ev_side: null,
          total_plus_ev_side: "over",
          public_smoke_aligned_with_pick: false,
        },
      })
    );
    check(
      "[R-16] V1 deterministic does not emit flip_side action",
      out.ml_action !== "flip_side"
    );
    check(
      "[R-16] V1 deterministic preserves raw ml_winner even at strongest intervention",
      out.predicted_ml_winner === "home"
    );
  }

  section("Audit record — compact + deterministic");
  {
    const inp = baseline({
      raw: {
        predicted_home_score: 9.2,
        predicted_away_score: 3.3,
        predicted_total: 12.5,
        listed_total: 8.5,
        predicted_ml_winner: "home",
        ml_confidence: 68,
        ml_raw_confidence: 206.6,
        predicted_ou_side: "over",
        ou_confidence: 63.8,
        ou_raw_confidence: 85.2,
        predicted_nrfi: null,
        nrfi_decision_kind: "toss_up",
        nrfi_confidence: 52,
        nrfi_expected_runs: 0.55,
      },
      starters: {
        home_starter_id: 100,
        home_starter_era: 2.57,
        home_starter_gs: 12,
        home_starter_ip: 75,
        away_starter_id: 200,
        away_starter_era: 10.38,
        away_starter_gs: 1,
        away_starter_ip: 4.3,
      },
      market: {
        ml_novig_pick_prob: 0.498,
        ml_novig_opposite_prob: 0.502,
        public_bets_pick_pct: 57,
        public_money_pick_pct: 71,
        ml_plus_ev_side: null,
        total_plus_ev_side: "over",
        public_smoke_aligned_with_pick: false,
      },
    });
    const reviewed = reviewGamePrediction(inp);
    const audit = buildAuditRecord(inp, reviewed);
    const json = JSON.stringify(audit);
    check(
      "[R-16] audit record JSON size < 1000 bytes (compact for JSONB)",
      json.length < 1000
    );
    check(
      "[R-16] audit raw snapshot matches input",
      audit.raw.ml_confidence === 68 && audit.raw.ml_winner === "home"
    );
    check(
      "[R-16] audit reviewed snapshot reflects cap",
      audit.reviewed.ml_confidence === 52
    );
    check(
      "[R-16] audit actions populated",
      audit.actions.ml === "cap_confidence" && audit.actions.nrfi === "keep"
    );
    check(
      "[R-16] audit flags array preserved",
      Array.isArray(audit.flags) && audit.flags.length > 0
    );
  }

  // Determinism — same input → same output (excluding `reviewed_at`).
  section("Determinism");
  {
    const inp = baseline();
    const a = reviewGamePrediction(inp);
    const b = reviewGamePrediction(inp);
    // Compare a/b minus reviewed_at
    const sigA = JSON.stringify({ ...a, reviewed_at: "fixed" });
    const sigB = JSON.stringify({ ...b, reviewed_at: "fixed" });
    check(
      "[R-16] same input yields same output (modulo reviewed_at)",
      sigA === sigB
    );
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:\n${failures.map((m) => `  ✗ ${m}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\n✅ All AI Reviewer V1 tests passed.`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
