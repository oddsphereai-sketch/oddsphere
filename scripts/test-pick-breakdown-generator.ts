/**
 * Phase 4.1.8.A — unit tests for pickBreakdownGenerator + verdictDerivation
 * + sharpReadSelector.
 *
 * Run: npx tsx scripts/test-pick-breakdown-generator.ts
 * Pure fixtures; no DB; no env reads.
 *
 * Test groups:
 *   1. Completeness — every known reason code has fragment or hidden,
 *                     every code has operator fragment
 *   2. Sport guard — non-MLB returns empty
 *   3. Verdict derivation — all 7 grades + null, plus floor + invariants
 *   4. Sharp Read selector — all 6 templates + branch coverage
 *   5. Model breakdown composition — held / toss-up / decisive paths
 *   6. Copy guardrails — forbidden phrases, char cap, sentence count, no tail
 *   7. Operator detail — preserved + diverges from member text
 *   8. Metadata + back-compat — version v2.0, member_summary alias
 *   9. Helpers — capModelBreakdown, parseExpectedRunsCode, dictionary sizes
 */
import {
  generatePickBreakdown,
  BREAKDOWN_VERSION,
  MODEL_BREAKDOWN_CAP,
  MEMBER_TEXT_CAP,
  KNOWN_MLB_REASON_CODES,
  __TEST__,
  type BreakdownContext,
} from "../lib/services/pickBreakdownGenerator";
import {
  deriveVerdict,
  PLAYABLE_CONFIDENCE_FLOOR,
  VERDICT_LABEL,
  type Verdict,
} from "../lib/services/verdictDerivation";
import {
  selectSharpReadKey,
  selectSharpRead,
  SHARP_READ_SENTENCES,
  SHARP_READ_CAP,
  type SharpReadInput,
  type SharpReadKey,
} from "../lib/services/sharpReadSelector";
import type { AutoModelOutput } from "../lib/automodel/types";
import type { Grade } from "../lib/types/domain/Grade";

const {
  MEMBER_FRAGMENTS,
  MEMBER_HIDDEN,
  OPERATOR_FRAGMENTS,
  parseExpectedRunsCode,
  capModelBreakdown,
  FORBIDDEN_MEMBER_PATTERNS,
} = __TEST__;

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
      },
      held: false,
      hold_picks: [],
      model_version: "test",
      stage: "morning_draft",
      ai_sanity: {
        action: "approve",
        deterministic_corrections: [],
      },
    } as unknown as AutoModelOutput["sport_specific"],
    ...overrides,
  };
}

async function main(): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════
  // GROUP 1 — Completeness
  // ═══════════════════════════════════════════════════════════════════
  {
    const missing = KNOWN_MLB_REASON_CODES.filter(
      (code) => !MEMBER_FRAGMENTS[code] && !MEMBER_HIDDEN.has(code)
    );
    check(
      `[completeness] every known MLB reason code has fragment OR is hidden (missing: ${missing.join(", ") || "none"})`,
      missing.length === 0
    );
  }
  {
    const missing = KNOWN_MLB_REASON_CODES.filter(
      (code) => !OPERATOR_FRAGMENTS[code]
    );
    check(
      `[completeness] every known MLB reason code has operator fragment (missing: ${missing.join(", ") || "none"})`,
      missing.length === 0
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 2 — Sport guard
  // ═══════════════════════════════════════════════════════════════════
  {
    const r = generatePickBreakdown(output(), ctx({ sport: "nba" }), {
      now: new Date("2026-05-30"),
    });
    check(
      "[sport] non-MLB sport returns empty model_breakdown",
      r.model_breakdown === ""
    );
    check(
      "[sport] non-MLB sport returns empty operator_detail",
      r.operator_detail === ""
    );
    check(
      "[sport] non-MLB sport returns empty member_summary alias",
      r.member_summary === ""
    );
    check(
      "[sport] non-MLB still populates metadata",
      r.breakdown_version === BREAKDOWN_VERSION &&
        r.breakdown_generated_at.length > 0
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 3 — Verdict derivation (deriveVerdict)
  // ═══════════════════════════════════════════════════════════════════
  // 3a — Grade → Verdict baseline mapping (7 grades + null)
  const gradeToVerdict: Array<[Grade | null, Verdict]> = [
    [null, "no_play"],
    ["best_signal", "best_angle"],
    ["sharp_confirmed", "best_angle"],
    ["market_led", "lean"],
    ["model_only", "lean"],
    ["market_watch", "watchlist"],
    ["public_smoke", "watchlist"],
    ["sharp_conflict", "caution"],
  ];
  for (const [grade, expected] of gradeToVerdict) {
    const actual = deriveVerdict({
      headlineGrade: grade,
      perMarketConfidence: { ml: 0.6, total: 0.6, nrfi: 0.6 },
    });
    check(
      `[verdict] grade=${grade === null ? "null" : grade} → ${expected}`,
      actual === expected
    );
  }

  // 3b — sharp_conflict is NEVER no_play (critical anti-regression)
  {
    const actual = deriveVerdict({
      headlineGrade: "sharp_conflict",
      perMarketConfidence: { ml: 0.7, total: 0.7, nrfi: 0.7 },
    });
    check(
      "[verdict-invariant] sharp_conflict with high confidence → caution (NEVER no_play)",
      actual === "caution"
    );
  }
  {
    // Updated philosophy: sharp_conflict ALWAYS → caution, even when
    // every per-market confidence sits below the playable floor. The
    // sharp disagreement is the meaningful product signal; the floor
    // never silences it. This locks the corrected check ordering.
    const actual = deriveVerdict({
      headlineGrade: "sharp_conflict",
      perMarketConfidence: { ml: 0.5, total: 0.5, nrfi: 0.5 },
    });
    check(
      "[verdict-invariant] sharp_conflict + all confidences below floor → caution (sharp_conflict ALWAYS wins over floor)",
      actual === "caution"
    );
  }
  {
    // Belt-and-suspenders: even with EVERY confidence well below floor,
    // sharp_conflict still returns caution.
    const actual = deriveVerdict({
      headlineGrade: "sharp_conflict",
      perMarketConfidence: { ml: 0.01, total: 0.01, nrfi: 0.01 },
    });
    check(
      "[verdict-invariant] sharp_conflict + every confidence at 0.01 → caution (not no_play)",
      actual === "caution"
    );
  }
  {
    // Defensive edge: sharp_conflict + all confidences null still → caution
    // because the grade is the load-bearing signal.
    const actual = deriveVerdict({
      headlineGrade: "sharp_conflict",
      perMarketConfidence: { ml: null, total: null, nrfi: null },
    });
    check(
      "[verdict-invariant] sharp_conflict + all confidences null → caution (grade is load-bearing)",
      actual === "caution"
    );
  }

  // 3c — Confidence floor guardrail
  {
    const actual = deriveVerdict({
      headlineGrade: "best_signal",
      perMarketConfidence: { ml: 0.51, total: 0.5, nrfi: 0.52 },
    });
    check(
      "[verdict-floor] best_signal but ALL confidences below 0.53 → no_play",
      actual === "no_play"
    );
  }
  {
    const actual = deriveVerdict({
      headlineGrade: "sharp_confirmed",
      perMarketConfidence: { ml: 0.51, total: 0.51, nrfi: 0.51 },
    });
    check(
      "[verdict-floor] sharp_confirmed but ALL confidences below floor → no_play",
      actual === "no_play"
    );
  }
  {
    const actual = deriveVerdict({
      headlineGrade: "market_watch",
      perMarketConfidence: { ml: 0.6, total: 0.5, nrfi: 0.5 },
    });
    check(
      "[verdict-floor] market_watch with one confidence ≥ floor → watchlist (floor not triggered)",
      actual === "watchlist"
    );
  }
  {
    const actual = deriveVerdict({
      headlineGrade: "best_signal",
      perMarketConfidence: { ml: 0.53, total: null, nrfi: null },
    });
    check(
      "[verdict-floor] confidence exactly 0.53 is playable (boundary)",
      actual === "best_angle"
    );
  }
  {
    const actual = deriveVerdict({
      headlineGrade: "best_signal",
      perMarketConfidence: { ml: 0.5299, total: null, nrfi: null },
    });
    check(
      "[verdict-floor] confidence 0.5299 just below floor → no_play (boundary)",
      actual === "no_play"
    );
  }
  {
    const actual = deriveVerdict({
      headlineGrade: "best_signal",
      perMarketConfidence: { ml: 0.6, total: null, nrfi: null },
    });
    check(
      "[verdict-floor] mixed null/non-null with one passing → best_angle (nulls excluded)",
      actual === "best_angle"
    );
  }
  {
    const actual = deriveVerdict({
      headlineGrade: "best_signal",
      perMarketConfidence: { ml: null, total: null, nrfi: null },
    });
    check(
      "[verdict-floor] all confidences null with non-null grade → no_play (defensive)",
      actual === "no_play"
    );
  }

  // 3d — VERDICT_LABEL completeness
  {
    const allVerdicts: Verdict[] = ["best_angle", "lean", "watchlist", "caution", "no_play"];
    const missing = allVerdicts.filter((v) => !VERDICT_LABEL[v]);
    check(
      `[verdict-label] all 5 verdicts have display labels (missing: ${missing.join(", ") || "none"})`,
      missing.length === 0
    );
    check(
      "[verdict-label] PLAYABLE_CONFIDENCE_FLOOR = 0.53",
      PLAYABLE_CONFIDENCE_FLOOR === 0.53
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 4 — Sharp Read selector
  // ═══════════════════════════════════════════════════════════════════
  // 4a — All 6 templates present, all under cap
  {
    const keys: SharpReadKey[] = [
      "support",
      "mixed",
      "push_against",
      "not_enough",
      "no_data",
      "light_movement",
    ];
    for (const k of keys) {
      const sentence = SHARP_READ_SENTENCES[k];
      check(
        `[sharp-read-template] '${k}' exists and ≤ ${SHARP_READ_CAP} chars (got ${sentence.length})`,
        sentence.length > 0 && sentence.length <= SHARP_READ_CAP
      );
    }
  }

  // 4b — Branch coverage
  function sharpInput(overrides: Partial<SharpReadInput>): SharpReadInput {
    return {
      headlineGrade: "best_signal",
      headlineMarket: "ml",
      sharpSignals: [],
      ...overrides,
    };
  }
  {
    const k = selectSharpReadKey(
      sharpInput({ headlineGrade: null, headlineMarket: null })
    );
    check(
      "[sharp-read] null grade + null market → no_data",
      k === "no_data"
    );
  }
  {
    const k = selectSharpReadKey(sharpInput({ sharpSignals: [] }));
    check(
      "[sharp-read] empty sharpSignals → no_data",
      k === "no_data"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "sharp_conflict",
        sharpSignals: [{ market: "ml", direction: "negative" }],
      })
    );
    check(
      "[sharp-read] sharp_conflict grade → push_against",
      k === "push_against"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "best_signal",
        sharpSignals: [{ market: "ml", direction: "negative" }],
      })
    );
    check(
      "[sharp-read] negative signal on headline market → push_against (even without sharp_conflict grade)",
      k === "push_against"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "best_signal",
        sharpSignals: [{ market: "ml", direction: "positive" }],
      })
    );
    check(
      "[sharp-read] best_signal grade → support",
      k === "support"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "sharp_confirmed",
        sharpSignals: [{ market: "ml", direction: "positive" }],
      })
    );
    check(
      "[sharp-read] sharp_confirmed grade → support",
      k === "support"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "market_led",
        sharpSignals: [{ market: "ml", direction: "positive" }],
      })
    );
    check(
      "[sharp-read] market_led + positive on headline → support",
      k === "support"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "market_led",
        sharpSignals: [{ market: "ml", direction: "neutral" }],
      })
    );
    check(
      "[sharp-read] market_led + only neutral on headline → mixed",
      k === "mixed"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "model_only",
        sharpSignals: [{ market: "total", direction: "positive" }],
      })
    );
    check(
      "[sharp-read] model_only grade → not_enough (no sharp behind it)",
      k === "not_enough"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "market_watch",
        sharpSignals: [{ market: "ml", direction: "neutral" }],
      })
    );
    check(
      "[sharp-read] market_watch + signal on headline → mixed",
      k === "mixed"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "market_watch",
        sharpSignals: [{ market: "total", direction: "neutral" }],
      })
    );
    check(
      "[sharp-read] market_watch + signal only on OTHER market → light_movement",
      k === "light_movement"
    );
  }
  {
    const k = selectSharpReadKey(
      sharpInput({
        headlineGrade: "public_smoke",
        sharpSignals: [{ market: "ml", direction: "neutral" }],
      })
    );
    check("[sharp-read] public_smoke → mixed", k === "mixed");
  }
  {
    const sentence = selectSharpRead(
      sharpInput({
        headlineGrade: "best_signal",
        sharpSignals: [{ market: "ml", direction: "positive" }],
      })
    );
    check(
      "[sharp-read] selectSharpRead resolves key to literal sentence",
      sentence === "Sharp signals support this pick."
    );
  }
  // Phase 4.1.8.A copy refresh — no_data sentence softened from
  // "No sharp signals available for this matchup tonight." to a
  // member-friendlier framing that doesn't read as "broken / missing
  // feature."
  {
    check(
      "[sharp-read-content] no_data sentence reads 'No clear sharp read on this matchup yet.'",
      SHARP_READ_SENTENCES.no_data === "No clear sharp read on this matchup yet."
    );
    check(
      "[sharp-read-content] no_data sentence does NOT include 'available' (legacy 'unavailable' framing)",
      !/\bavailable\b/i.test(SHARP_READ_SENTENCES.no_data)
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 5 — Model breakdown composition
  // ═══════════════════════════════════════════════════════════════════
  // 5a — NRFI decisive with real FI driver
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
    const r = generatePickBreakdown(
      o,
      ctx({ home_first_inning_era: 1.5, away_first_inning_era: 1.5 })
    );
    check(
      "[model-breakdown] NRFI decisive with real driver mentions pitcher and 'strong in first innings'",
      /[A-Z][a-z]+\s+(Pitcher\s+)?has been strong in first innings/.test(
        r.model_breakdown
      )
    );
    check(
      "[model-breakdown] NRFI decisive does NOT include the v1 actionability lead",
      !/Strong NRFI play/.test(r.model_breakdown)
    );
    check(
      "[model-breakdown] NRFI decisive does NOT include '(60% confidence)' parenthetical",
      !/\d+%\s*confidence/i.test(r.model_breakdown)
    );
    check(
      "[model-breakdown] NRFI decisive does NOT include ML/OU tail",
      !/\bML\s+[A-Z]{2,4}\s+\d+%/.test(r.model_breakdown) &&
        !/\bO\/U\s+(over|under)\s+\d+%/i.test(r.model_breakdown)
    );
  }

  // 5b — YRFI decisive with real FI driver
  {
    const o = output({
      predicted_nrfi: false,
      nrfi_confidence: 56,
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "lean_yrfi",
        nrfi_reason_codes: ["first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(
      o,
      ctx({ home_first_inning_era: 6.0, away_first_inning_era: 6.5 })
    );
    check(
      "[model-breakdown] YRFI decisive with real driver mentions pitcher and 'struggled in early innings'",
      /has struggled in early innings/.test(r.model_breakdown)
    );
    check(
      "[model-breakdown] YRFI decisive does NOT include 'Lean YRFI'",
      !/^Lean YRFI/.test(r.model_breakdown)
    );
  }

  // 5c — Toss-up natural (no guardrail)
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
    check(
      "[model-breakdown] toss-up natural starts with 'Early-inning edge is thin'",
      /^Early-inning edge is thin/.test(r.model_breakdown)
    );
    check(
      "[model-breakdown] toss-up natural does NOT include 'Toss-up' prefix",
      !/^Toss-up/.test(r.model_breakdown)
    );
    check(
      "[model-breakdown] toss-up natural does NOT include legacy 'roughly even early' phrasing",
      !/roughly even early/.test(r.model_breakdown)
    );
  }
  // Verify the top_order fragment reads as a scoring-risk noun phrase
  // (Phase 4.1.8.A copy refresh).
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "toss_up",
        nrfi_threshold_zone: "toss_up",
        nrfi_reason_codes: ["first_inning_data_used", "top_order_power_risk"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check(
      "[model-breakdown] toss-up + top_order_power_risk reads 'Early-inning edge is thin, but the top of the order adds scoring risk.'",
      r.model_breakdown ===
        "Early-inning edge is thin, but the top of the order adds scoring risk."
    );
  }
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "toss_up",
        nrfi_threshold_zone: "toss_up",
        nrfi_reason_codes: ["first_inning_data_used", "top_order_obp_risk"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check(
      "[model-breakdown] toss-up + top_order_obp_risk reads 'Early-inning edge is thin, but the top of the order adds on-base risk.'",
      r.model_breakdown ===
        "Early-inning edge is thin, but the top of the order adds on-base risk."
    );
  }

  // 5d — Toss-up with both-sides fallback guardrail
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "toss_up",
        nrfi_threshold_zone: "toss_up",
        nrfi_reason_codes: [
          "both_starters_fallback_capped_to_toss_up",
          "fallback_first_inning_era",
        ],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(
      o,
      ctx({
        home_first_inning_starts: null,
        away_first_inning_starts: null,
        home_first_inning_era: null,
        away_first_inning_era: null,
      })
    );
    check(
      "[model-breakdown] toss-up guardrail mentions 'Limited first-inning data on both starters'",
      r.model_breakdown.includes(
        "Limited first-inning data on both starters tonight"
      )
    );
    check(
      "[model-breakdown] toss-up guardrail does NOT include 'capped to toss-up' phrase",
      !/capped to toss[- ]up/i.test(r.model_breakdown)
    );
    check(
      "[model-breakdown] toss-up guardrail does NOT double-bill caveat (only one limited-data clause)",
      (r.model_breakdown.match(/limited/gi) ?? []).length === 1
    );
  }

  // 5e — Held path
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
        nrfi_hold_reason: "missing_starter",
        nrfi_reason_codes: ["missing_starter"],
        held: true,
        hold_picks: ["ml", "ou", "nrfi"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check(
      "[model-breakdown] held + missing_starter says 'Probable starters haven't been announced'",
      r.model_breakdown.includes(
        "Probable starters haven't been announced for this matchup yet"
      )
    );
    check(
      "[model-breakdown] held does NOT lead with 'Held — no play' prefix",
      !/^Held/.test(r.model_breakdown)
    );
  }

  // 5f — Held + scratched
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
        nrfi_hold_reason: "starter_scratched",
        nrfi_reason_codes: ["starter_scratched"],
        held: true,
        hold_picks: ["ml", "ou", "nrfi"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check(
      "[model-breakdown] held + starter_scratched mentions 'starter has been scratched'",
      r.model_breakdown.includes("A starter has been scratched")
    );
  }

  // 5g — Caveat: low_sample names the thin-sample pitcher
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
      ctx({
        home_first_inning_era: 6.5,
        away_first_inning_era: 6.5,
        away_first_inning_starts: 2,
      })
    );
    check(
      "[model-breakdown] low_sample caveat names the thin pitcher with 'still thin' phrasing",
      r.model_breakdown.includes("Away Pitcher") &&
        r.model_breakdown.includes("still thin")
    );
  }

  // 5h — Caveat: fallback (1 side) names the missing-data pitcher
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
      ctx({
        home_first_inning_era: 1.5,
        away_first_inning_era: null,
        away_first_inning_starts: null,
      })
    );
    check(
      "[model-breakdown] fallback (1 missing) caveat names the missing-data pitcher",
      r.model_breakdown.includes("Away Pitcher") &&
        r.model_breakdown.includes("limited")
    );
  }

  // 5i — Caveat: fallback (both sides) says 'both starters'
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
      ctx({
        home_first_inning_era: null,
        away_first_inning_era: null,
        home_first_inning_starts: null,
        away_first_inning_starts: null,
      })
    );
    check(
      "[model-breakdown] fallback (both sides) caveat says 'both starters'",
      r.model_breakdown.includes("both starters") &&
        r.model_breakdown.includes("limited")
    );
  }

  // 5j — Caveat suppressed when guardrail handles it
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "toss_up",
        nrfi_threshold_zone: "toss_up",
        nrfi_reason_codes: [
          "both_starters_fallback_capped_to_toss_up",
          "low_first_inning_sample",
          "fallback_first_inning_era",
        ],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(
      o,
      ctx({
        home_first_inning_starts: null,
        away_first_inning_starts: 2,
      })
    );
    check(
      "[model-breakdown] caveat suppressed when guardrail handles it (no 'though early-inning' clause)",
      !r.model_breakdown.includes("though")
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 6 — Copy guardrails
  // ═══════════════════════════════════════════════════════════════════
  // 6a — No fragment contains forbidden phrases
  {
    const allFragmentOutputs: string[] = [];
    const sampleCtx = ctx();
    for (const code of Object.keys(MEMBER_FRAGMENTS)) {
      allFragmentOutputs.push(MEMBER_FRAGMENTS[code](sampleCtx));
    }
    let leaked = false;
    let leakedExample = "";
    for (const text of allFragmentOutputs) {
      for (const re of FORBIDDEN_MEMBER_PATTERNS) {
        if (re.test(text)) {
          leaked = true;
          leakedExample = `${re} in "${text}"`;
          break;
        }
      }
      if (leaked) break;
    }
    check(
      `[forbidden] no member fragment contains forbidden phrase (${leakedExample || "all clean"})`,
      !leaked
    );
  }

  // 6b — Per-forbidden-pattern scan: stress test composed outputs across paths
  {
    // Build a stack-of-codes fixture that exercises many paths.
    const allCodes = [
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
    ];
    const paths: Array<{ label: string; o: AutoModelOutput; c: BreakdownContext }> = [
      {
        label: "NRFI-decisive",
        o: output({
          sport_specific: {
            ...output().sport_specific,
            nrfi_decision_kind: "nrfi",
            nrfi_threshold_zone: "lean_nrfi",
            nrfi_reason_codes: allCodes,
          } as AutoModelOutput["sport_specific"],
        }),
        c: ctx({ home_first_inning_era: 1.5 }),
      },
      {
        label: "YRFI-decisive",
        o: output({
          sport_specific: {
            ...output().sport_specific,
            nrfi_decision_kind: "yrfi",
            nrfi_threshold_zone: "lean_yrfi",
            nrfi_reason_codes: allCodes,
          } as AutoModelOutput["sport_specific"],
        }),
        c: ctx({ home_first_inning_era: 7.0 }),
      },
      {
        label: "toss-up-natural",
        o: output({
          sport_specific: {
            ...output().sport_specific,
            nrfi_decision_kind: "toss_up",
            nrfi_threshold_zone: "toss_up",
            nrfi_reason_codes: allCodes,
          } as AutoModelOutput["sport_specific"],
        }),
        c: ctx(),
      },
      {
        label: "held-missing-starter",
        o: output({
          predicted_ml_winner: null,
          predicted_ou_side: null,
          predicted_nrfi: null,
          ml_confidence: null,
          ou_confidence: null,
          nrfi_confidence: null,
          sport_specific: {
            ...output().sport_specific,
            nrfi_decision_kind: "held",
            nrfi_hold_reason: "missing_starter",
            nrfi_reason_codes: ["missing_starter"],
            held: true,
            hold_picks: ["ml", "ou", "nrfi"],
          } as AutoModelOutput["sport_specific"],
        }),
        c: ctx(),
      },
    ];
    for (const p of paths) {
      const r = generatePickBreakdown(p.o, p.c);
      let leaked = "";
      for (const re of FORBIDDEN_MEMBER_PATTERNS) {
        if (re.test(r.model_breakdown)) {
          leaked = `${re}`;
          break;
        }
      }
      check(
        `[forbidden-composed] ${p.label} model_breakdown contains no forbidden phrase (${leaked || "clean"})`,
        leaked === ""
      );
    }
  }

  // 6c — Char cap stress test
  {
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
    check(
      `[cap] model_breakdown ≤ ${MODEL_BREAKDOWN_CAP} chars (got ${r.model_breakdown.length})`,
      r.model_breakdown.length <= MODEL_BREAKDOWN_CAP
    );
  }

  // 6d — Sentence count: 1 or 2 only
  {
    // Iterate over the same fixture set used in 6b
    const allCodes = [
      "first_inning_data_used",
      "fallback_first_inning_era",
    ];
    const fixtures: AutoModelOutput[] = [
      output({
        sport_specific: {
          ...output().sport_specific,
          nrfi_decision_kind: "nrfi",
          nrfi_threshold_zone: "lean_nrfi",
          nrfi_reason_codes: allCodes,
        } as AutoModelOutput["sport_specific"],
      }),
      output({
        sport_specific: {
          ...output().sport_specific,
          nrfi_decision_kind: "yrfi",
          nrfi_threshold_zone: "lean_yrfi",
          nrfi_reason_codes: allCodes,
        } as AutoModelOutput["sport_specific"],
      }),
      output({
        sport_specific: {
          ...output().sport_specific,
          nrfi_decision_kind: "toss_up",
          nrfi_threshold_zone: "toss_up",
          nrfi_reason_codes: ["first_inning_data_used"],
        } as AutoModelOutput["sport_specific"],
      }),
    ];
    for (const o of fixtures) {
      const r = generatePickBreakdown(
        o,
        ctx({ home_first_inning_era: 2.0, away_first_inning_era: 6.0 })
      );
      // Sentence count: split on period followed by space-or-end, drop empties.
      // Caveat clauses are joined with comma so they count as part of the lead.
      const sentences = r.model_breakdown
        .split(/\.(?=\s|$)/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      check(
        `[sentences] decision_kind=${o.sport_specific.nrfi_decision_kind} composes ≤ 2 sentences (got ${sentences.length})`,
        sentences.length <= 2
      );
    }
  }

  // 6e — Hidden codes never appear in member text
  for (const hidden of MEMBER_HIDDEN) {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_reason_codes: [hidden, "first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check(
      `[hidden] '${hidden}' does NOT appear in model_breakdown`,
      !r.model_breakdown.includes(hidden)
    );
  }

  // 6f — Dynamic expected_first_inning_runs prefix
  {
    check(
      "[dynamic-prefix] parses 'expected_first_inning_runs_1.42' to 1.42",
      parseExpectedRunsCode("expected_first_inning_runs_1.42") === 1.42
    );
    check(
      "[dynamic-prefix] returns null for unrelated code",
      parseExpectedRunsCode("first_inning_data_used") === null
    );
  }
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "strong_yrfi",
        nrfi_reason_codes: [
          "first_inning_data_used",
          "expected_first_inning_runs_1.42",
        ],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx());
    check(
      "[dynamic-prefix] does NOT leak raw code into model_breakdown",
      !r.model_breakdown.includes("expected_first_inning_runs")
    );
    check(
      "[dynamic-prefix] operator detail includes the parsed value",
      r.operator_detail.includes("expected_first_inning_runs = 1.42")
    );
  }

  // 6g — Defensive: null pitcher names don't crash, don't leak "null"
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "lean_yrfi",
        nrfi_reason_codes: ["first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(
      o,
      ctx({
        away_pitcher_name: null,
        home_first_inning_era: 6.5,
        away_first_inning_era: 7.0,
      })
    );
    check(
      "[null-name] model_breakdown doesn't crash with null pitcher name",
      r.model_breakdown.length > 0
    );
    check(
      "[null-name] model_breakdown doesn't literally contain 'null'",
      !r.model_breakdown.includes("null")
    );
    check(
      "[null-name] uses 'Home Pitcher' (the side with a name)",
      r.model_breakdown.includes("Home Pitcher")
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 7 — Operator detail
  // ═══════════════════════════════════════════════════════════════════
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
      if (!r.operator_detail.includes(c)) {
        allPresent = false;
        break;
      }
    }
    check(
      "[operator] operator detail contains every reason code by name",
      allPresent
    );
  }
  {
    const o = output({
      sport_specific: {
        ...output().sport_specific,
        nrfi_decision_kind: "yrfi",
        nrfi_threshold_zone: "strong_yrfi",
        nrfi_reason_codes: ["first_inning_data_used"],
      } as AutoModelOutput["sport_specific"],
    });
    const r = generatePickBreakdown(o, ctx({ home_first_inning_era: 7.0 }));
    check(
      "[operator] model_breakdown differs from operator_detail",
      r.model_breakdown !== r.operator_detail
    );
    check(
      "[operator] operator_detail starts with 'NRFI: kind='",
      r.operator_detail.startsWith("NRFI: kind=")
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 8 — Metadata + back-compat alias
  // ═══════════════════════════════════════════════════════════════════
  {
    const now = new Date("2026-05-30T12:00:00Z");
    const r = generatePickBreakdown(output(), ctx(), { now });
    check(
      `[meta] breakdown_version = "v2.0" (got "${r.breakdown_version}")`,
      r.breakdown_version === "v2.0"
    );
    check(
      "[meta] breakdown_generated_at uses provided now",
      r.breakdown_generated_at === now.toISOString()
    );
  }
  {
    const r = generatePickBreakdown(output(), ctx());
    check(
      "[back-compat] member_summary alias === model_breakdown",
      r.member_summary === r.model_breakdown
    );
    check(
      "[back-compat] MEMBER_TEXT_CAP aliased to MODEL_BREAKDOWN_CAP (both = 180)",
      MEMBER_TEXT_CAP === MODEL_BREAKDOWN_CAP && MODEL_BREAKDOWN_CAP === 180
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 9 — Helpers
  // ═══════════════════════════════════════════════════════════════════
  check(
    "[cap-helper] capModelBreakdown under cap returns unchanged",
    capModelBreakdown("short").length === 5
  );
  {
    const long = "a".repeat(MODEL_BREAKDOWN_CAP + 100);
    const out = capModelBreakdown(long);
    check(
      "[cap-helper] over cap truncates to exactly MODEL_BREAKDOWN_CAP",
      out.length === MODEL_BREAKDOWN_CAP
    );
    check(
      "[cap-helper] truncated text ends with ellipsis",
      out.endsWith("…")
    );
  }

  console.log("\n" + "━".repeat(70));
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log("\n❌ Failures.");
    process.exit(1);
  }
  console.log("\n✅ All Phase 4.1.8.A pickBreakdownGenerator tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
