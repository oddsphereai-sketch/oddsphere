/**
 * Phase 4.1.3 — unit tests for pickBreakdownGenerator.
 *
 * Run: npx tsx scripts/test-pick-breakdown-generator.ts
 * Pure fixtures; no DB; no env reads.
 */
import {
  generatePickBreakdown,
  BREAKDOWN_VERSION,
  MEMBER_TEXT_CAP,
  KNOWN_MLB_REASON_CODES,
  __TEST__,
  type BreakdownContext,
} from "../lib/services/pickBreakdownGenerator";
import type { AutoModelOutput } from "../lib/automodel/types";

const { MEMBER_FRAGMENTS, MEMBER_HIDDEN, OPERATOR_FRAGMENTS, parseExpectedRunsCode, capMemberText } = __TEST__;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`✓ ${label}`);
  } else {
    fail++;
    console.log(`✗ ${label}`);
  }
}

// Fixture builders ──────────────────────────────────────────────────

function ctx(overrides: Partial<BreakdownContext> = {}): BreakdownContext {
  return {
    sport: "mlb",
    home_pitcher_name: "Home Pitcher",
    away_pitcher_name: "Away Pitcher",
    home_team_abbr: "HOM",
    away_team_abbr: "AWY",
    home_first_inning_starts: 10,
    away_first_inning_starts: 10,
    home_first_inning_era: 4.0,
    away_first_inning_era: 4.0,
    home_season_era: 4.0,
    away_season_era: 4.0,
    ...overrides,
  };
}

function output(overrides: Partial<AutoModelOutput> = {}): AutoModelOutput {
  return {
    game_external_id: 1,
    prediction_source: "auto_v1_mlb_rules",
    predicted_home_score: 4.5,
    predicted_away_score: 4.5,
    predicted_total: 9.0,
    predicted_ml_winner: "home",
    ml_confidence: 56,
    predicted_ou_side: "over",
    ou_confidence: 58,
    predicted_nrfi: null,
    nrfi_confidence: 52,
    sport_specific: {
      nrfi_decision_kind: "toss_up",
      nrfi_threshold_zone: "toss_up",
      nrfi_hold_reason: null,
      nrfi_reason_codes: ["first_inning_data_used"],
      auto_factors: {
        nrfi_expected_runs: 1.0,
        park_mod: 1.0,
        weather_mult: 1.0,
        market_mod: 1.0,
        home_pitch_factor: 1.0,
        away_pitch_factor: 1.0,
        home_offense_factor: 1.0,
        away_offense_factor: 1.0,
      },
      held: false,
      hold_picks: [],
      model_version: "test",
      stage: "morning_draft",
      ai_sanity: {
        action: "approve",
        deterministic_corrections: [],
        ai_review: null,
      },
    } as unknown as AutoModelOutput["sport_specific"],
    ...overrides,
  };
}

async function main(): Promise<void> {
  // ── Completeness assertion ────────────────────────────────────────
  // Every known mlb reason code must have a member fragment OR be in MEMBER_HIDDEN.
  {
    const missing = KNOWN_MLB_REASON_CODES.filter(
      (code) => !MEMBER_FRAGMENTS[code] && !MEMBER_HIDDEN.has(code)
    );
    check(
      `[completeness] every known MLB reason code has fragment OR is hidden (missing: ${missing.join(", ") || "none"})`,
      missing.length === 0
    );
  }
  // Every known mlb code must have an operator fragment.
  {
    const missing = KNOWN_MLB_REASON_CODES.filter((code) => !OPERATOR_FRAGMENTS[code]);
    check(
      `[completeness] every known MLB reason code has operator fragment (missing: ${missing.join(", ") || "none"})`,
      missing.length === 0
    );
  }

  // ── Sport guard ────────────────────────────────────────────────────
  {
    const r = generatePickBreakdown(output(), ctx({ sport: "nba" }), { now: new Date("2026-05-30") });
    check("[sport] non-MLB sport returns empty member/operator", r.member_summary === "" && r.operator_detail === "");
    check("[sport] non-MLB still populates metadata", r.breakdown_version === BREAKDOWN_VERSION && r.breakdown_generated_at.length > 0);
  }

  // ── NRFI/YRFI lead sentences (actionability-first) ───────────────
  {
    const o = output({
      predicted_nrfi: true,
      nrfi_confidence: 60,
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "nrfi",
        nrfi_threshold_zone: "strong_nrfi",
        nrfi_reason_codes: ["first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx({ home_first_inning_era: 1.5, away_first_inning_era: 1.5 }));
    check(
      "[nrfi] strong nrfi member text leads with 'Strong NRFI play (60% confidence)'",
      r.member_summary.startsWith("Strong NRFI play (60% confidence).")
    );
    check(
      "[nrfi] strong nrfi member text names a pitcher and cites real FI ERA",
      /\b\d+\.\d+ FI ERA in \d+ starts\b/.test(r.member_summary)
    );
  }
  {
    const o = output({
      predicted_nrfi: false,
      nrfi_confidence: 54,
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "lean_yrfi",
        nrfi_reason_codes: ["first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx({ home_first_inning_era: 6.0, away_first_inning_era: 6.0 }));
    check(
      "[yrfi] lean yrfi member text leads with 'Lean YRFI — moderate edge (54% confidence)'",
      r.member_summary.startsWith("Lean YRFI — moderate edge (54% confidence).")
    );
    check(
      "[yrfi] lean yrfi member text says pitcher 'has struggled in first innings'",
      r.member_summary.includes("has struggled in first innings")
    );
  }

  // ── Toss-up natural vs guardrail-capped ───────────────────────────
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "toss_up",
        nrfi_threshold_zone: "toss_up",
        nrfi_reason_codes: ["first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check("[toss_up natural] member text starts with 'Toss-up'", r.member_summary.startsWith("Toss-up"));
    check("[toss_up natural] does NOT mention 'no first-inning data'", !r.member_summary.includes("no first-inning data"));
  }
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "toss_up",
        nrfi_threshold_zone: "toss_up",
        nrfi_reason_codes: ["both_starters_fallback_capped_to_toss_up", "fallback_first_inning_era"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx({ home_first_inning_starts: null, away_first_inning_starts: null, home_first_inning_era: null, away_first_inning_era: null }));
    check(
      "[toss_up guardrail] member text mentions 'lacks real first-inning data for both starters'",
      r.member_summary.includes("lacks real first-inning data for both starters")
    );
    check(
      "[toss_up guardrail] member text mentions 'not forcing a pick'",
      r.member_summary.includes("not forcing a pick")
    );
  }

  // ── Held path ──────────────────────────────────────────────────────
  {
    const o = output({
      predicted_ml_winner: null,
      predicted_ou_side: null,
      predicted_nrfi: null,
      ml_confidence: null,
      ou_confidence: null,
      nrfi_confidence: null,
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "held",
        nrfi_threshold_zone: "below_floor",
        nrfi_hold_reason: "missing_starter_era_nrfi",
        nrfi_reason_codes: ["starter_era_unavailable"],
        held: true,
        hold_picks: ["ml", "ou", "nrfi"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check("[held] member text starts with 'Held — no play.'", r.member_summary.startsWith("Held — no play."));
    check("[held] member text mentions 'Pitcher stats are not yet available'", r.member_summary.includes("Pitcher stats are not yet available"));
  }

  // ── Caveat: low_sample names the thin-sample pitcher ──────────────
  {
    const o = output({
      predicted_nrfi: false,
      nrfi_confidence: 56,
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "lean_yrfi",
        nrfi_reason_codes: ["first_inning_data_used", "low_first_inning_sample"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(
      o,
      ctx({ home_first_inning_era: 6.5, away_first_inning_era: 6.5, away_first_inning_starts: 2 })
    );
    check(
      "[low_sample] caveat names the thin-sample pitcher with 'only 2 FI starts'",
      r.member_summary.includes("Caveat:") &&
        r.member_summary.includes("Away Pitcher") &&
        r.member_summary.includes("only 2 FI starts")
    );
  }
  // ── Caveat: fallback names the missing-data pitcher ───────────────
  {
    const o = output({
      predicted_nrfi: true,
      nrfi_confidence: 55,
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "nrfi",
        nrfi_threshold_zone: "lean_nrfi",
        nrfi_reason_codes: ["first_inning_data_used", "fallback_first_inning_era"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(
      o,
      ctx({ home_first_inning_era: 1.5, away_first_inning_era: null, away_first_inning_starts: null })
    );
    check(
      "[fallback] caveat names the missing-data pitcher",
      r.member_summary.includes("Caveat:") &&
        r.member_summary.includes("Away Pitcher") &&
        r.member_summary.includes("season ERA")
    );
  }

  // ── Forbidden-phrase enforcement (manual eval over all fragments) ─
  {
    const allFragmentOutputs: string[] = [];
    const sampleCtx = ctx();
    for (const code of Object.keys(MEMBER_FRAGMENTS)) {
      allFragmentOutputs.push(MEMBER_FRAGMENTS[code](sampleCtx));
    }
    // None of the fragments should contain forbidden code names.
    let leaked = false;
    let leakedExample = "";
    for (const text of allFragmentOutputs) {
      for (const re of __TEST__.FORBIDDEN_MEMBER_PATTERNS) {
        if (re.test(text)) {
          leaked = true;
          leakedExample = `${re} in "${text}"`;
          break;
        }
      }
      if (leaked) break;
    }
    check(`[forbidden] no member fragment contains forbidden phrase (${leakedExample || "all clean"})`, !leaked);
  }

  // ── Member text 280-char cap ──────────────────────────────────────
  {
    // Force a long synthesis by stacking codes
    const o = output({
      predicted_nrfi: false,
      nrfi_confidence: 56,
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "lean_yrfi",
        nrfi_reason_codes: [
          "first_inning_data_used",
          "platoon_advantage_home",
          "platoon_advantage_away",
          "top_order_power_risk",
          "top_order_obp_risk",
          "pitcher_quality_supports_nrfi",
          "park_boosts_runs",
          "weather_boosts_runs",
          "market_total_high",
          "fallback_first_inning_era",
        ],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx({ home_first_inning_starts: null }));
    check(`[cap] member text ≤ ${MEMBER_TEXT_CAP} chars (got ${r.member_summary.length})`, r.member_summary.length <= MEMBER_TEXT_CAP);
  }

  // ── Hidden codes never appear in member text ──────────────────────
  for (const hidden of MEMBER_HIDDEN) {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_reason_codes: [hidden, "first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check(`[hidden] '${hidden}' does NOT appear in member text`, !r.member_summary.includes(hidden));
  }

  // ── Dynamic expected_first_inning_runs_X.XX prefix ───────────────
  check(
    "[dynamic-prefix] parses 'expected_first_inning_runs_1.42' to 1.42",
    parseExpectedRunsCode("expected_first_inning_runs_1.42") === 1.42
  );
  check(
    "[dynamic-prefix] returns null for unrelated code",
    parseExpectedRunsCode("first_inning_data_used") === null
  );
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "strong_yrfi",
        nrfi_reason_codes: ["first_inning_data_used", "expected_first_inning_runs_1.42"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check("[dynamic-prefix] does NOT leak the raw code to member text", !r.member_summary.includes("expected_first_inning_runs"));
    check("[dynamic-prefix] operator detail includes the parsed value", r.operator_detail.includes("expected_first_inning_runs = 1.42"));
  }

  // ── Operator detail includes all reason codes ─────────────────────
  {
    const codes = ["first_inning_data_used", "park_suppresses_runs", "weather_boosts_runs"];
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "toss_up",
        nrfi_threshold_zone: "toss_up",
        nrfi_reason_codes: codes,
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    let allPresent = true;
    for (const c of codes) {
      if (!r.operator_detail.includes(c)) { allPresent = false; break; }
    }
    check("[operator] operator detail contains every reason code by name", allPresent);
  }

  // ── ML/OU tail (compact, secondary) ───────────────────────────────
  {
    const o = output({ predicted_ml_winner: "away", ml_confidence: 58, predicted_ou_side: "under", ou_confidence: 55 });
    const r = generatePickBreakdown(o, ctx({ away_team_abbr: "ARI" }));
    check("[ml] tail mentions 'ML ARI 58%'", r.member_summary.includes("ML ARI 58%"));
    check("[ou] tail mentions 'O/U under 55%'", r.member_summary.includes("O/U under 55%"));
    check("[ml/ou] tail uses compact separator '·'", r.member_summary.includes("·"));
  }

  // ── ML/OU omitted when null ───────────────────────────────────────
  {
    const o = output({ predicted_ml_winner: null, ml_confidence: null, predicted_ou_side: null, ou_confidence: null });
    const r = generatePickBreakdown(o, ctx());
    check("[ml-null] no ML section when winner is null", !r.member_summary.includes("ML "));
    check("[ou-null] no O/U section when side is null", !r.member_summary.includes("O/U "));
  }

  // ── Member ≠ Operator on the same input ───────────────────────────
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "strong_yrfi",
        nrfi_reason_codes: ["first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check("[diff] member_summary differs from operator_detail", r.member_summary !== r.operator_detail);
  }

  // ── Defensive: null pitcher names don't crash and don't leak "null" ─
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "lean_yrfi",
        nrfi_reason_codes: ["first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    // Away pitcher has null name but valid FI ERA — the YRFI driver
    // logic should pick HOME (the side with a known name) as the
    // primary reason, or fall back to the secondary signal slot.
    const r = generatePickBreakdown(
      o,
      ctx({ away_pitcher_name: null, home_first_inning_era: 6.5, away_first_inning_era: 7.0 })
    );
    check("[null-name] member text doesn't crash with null pitcher name", r.member_summary.length > 0);
    check("[null-name] member text doesn't literally contain 'null'", !r.member_summary.includes("null"));
    check("[null-name] member text uses 'Home Pitcher' (the side with a name)", r.member_summary.includes("Home Pitcher"));
  }

  // ── capMemberText helper ──────────────────────────────────────────
  check("[cap-helper] under cap returns unchanged", capMemberText("short").length === 5);
  {
    const long = "a".repeat(MEMBER_TEXT_CAP + 100);
    const out = capMemberText(long);
    check("[cap-helper] over cap truncates to exactly MEMBER_TEXT_CAP", out.length === MEMBER_TEXT_CAP);
    check("[cap-helper] truncated text ends with ellipsis", out.endsWith("…"));
  }

  // ── Metadata fields ───────────────────────────────────────────────
  {
    const now = new Date("2026-05-30T12:00:00Z");
    const r = generatePickBreakdown(output(), ctx(), { now });
    check("[meta] breakdown_version = v1.0", r.breakdown_version === "v1.0");
    check("[meta] breakdown_generated_at uses provided now", r.breakdown_generated_at === now.toISOString());
  }

  console.log("\n" + "━".repeat(70));
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log("\n❌ Failures.");
    process.exit(1);
  }
  console.log("\n✅ All Phase 4.1.3 pickBreakdownGenerator tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
