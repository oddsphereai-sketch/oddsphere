/**
 * Soccer grading helpers — pure deterministic functions for the three
 * launch markets: 3-way match result, total goals, and BTTS.
 *
 * Soccer-native conventions encoded here (binding):
 *
 *   1. REGULATION ONLY. All three markets resolve on the 90-minute
 *      full-time score. Extra time and penalties are NEVER counted
 *      toward match_result, total, or btts. Knockout matches that go
 *      to ET/penalties: match_result is whichever team is ahead at
 *      90'; if tied, match_result is "draw" (and "winner advances"
 *      is irrelevant — that's a different market we do not track).
 *
 *   2. TOTAL pushes. When the line is a whole number (e.g., 2.5 is
 *      not a whole number; 2 is), and the actual total equals the
 *      line, the result is push. With half-line totals (.5) there is
 *      never a push.
 *
 *   3. BTTS Yes/No. Yes wins iff both teams score >= 1. No wins iff
 *      at least one team scores 0. Always 90-minute regulation.
 *
 *   4. SPORT-SPECIFIC INPUT. Caller passes regulation/full-time score
 *      explicitly (`home_goals_ft`, `away_goals_ft`). If the score
 *      pair is null/undefined, every grader returns "pending" — the
 *      grader NEVER guesses or interpolates.
 *
 * NO DB IMPORT. NO PROVIDER IMPORT. This file is a pure module used
 * by predictionGrader (WC-5 integration) and by the synthetic test
 * suite. Lives outside lib/services/predictionGrader.ts because soccer
 * needs its own 3-way + push semantics; merging into the legacy
 * grader would have widened it past what its other call-sites expect.
 *
 * Contract: every public function returns a `SoccerGradeResult` whose
 * `result` is one of "win" | "loss" | "push" | "void" | "pending".
 * The same result enum used by predictionGrader.GradeResult so
 * downstream consumers don't need a translation step.
 */

export type SoccerGradeResult = {
  /** Resolved outcome — same enum as predictionGrader.GradeResult. */
  result: "win" | "loss" | "push" | "void" | "pending";
  /** Numeric value graded against (e.g., total goals when scoring totals). */
  actual_value: number | null;
  /** Human-readable note used for audit trails. Always non-empty. */
  notes: string;
};

/** 90-minute regulation score. Either both values present, or both null (pending). */
export type FullTimeScore = {
  home_goals_ft: number | null;
  away_goals_ft: number | null;
};

/** Convention applied to a soccer market resolution. Stored in snapshot for audit. */
export type SoccerMarketConvention = {
  /** Always "regulation_90" at WC-1 launch. */
  resolution_window: "regulation_90";
  /** Whether the original event went to extra time / penalties (informational). */
  extra_time_occurred: boolean | null;
  /** Whether the original event went to a penalty shootout (informational). */
  penalty_shootout_occurred: boolean | null;
};

// ─── 1. Match result (3-way) ─────────────────────────────────────────
// Selections: "home" | "draw" | "away" (no two-way moneyline).
// Resolution: based on the 90-minute regulation score ONLY.
// Tied @ 90' → resolves "draw" — even in knockouts that go to
// extra time/penalties. The eventual ET/penalty winner does NOT
// influence match_result.

export type MatchResultPick = "home" | "draw" | "away";

export function gradeMatchResult(
  pick: MatchResultPick,
  ft: FullTimeScore,
): SoccerGradeResult {
  const { home_goals_ft, away_goals_ft } = ft;
  if (home_goals_ft === null || away_goals_ft === null) {
    return {
      result: "pending",
      actual_value: null,
      notes: "full-time regulation score unavailable",
    };
  }
  const actual: MatchResultPick =
    home_goals_ft > away_goals_ft
      ? "home"
      : home_goals_ft < away_goals_ft
        ? "away"
        : "draw";
  return {
    result: pick === actual ? "win" : "loss",
    actual_value: null,
    notes: `regulation FT ${home_goals_ft}-${away_goals_ft}; actual=${actual}; pick=${pick}`,
  };
}

// ─── 2. Total goals (Over / Under, with push handling) ────────────────
// At launch we expect line = 2.5 (canonical). Push semantics are
// implemented anyway so we never produce a "win" when the total
// exactly equals a whole-number line.

export type TotalGoalsPick = "over" | "under";

export function gradeTotalGoals(
  pick: TotalGoalsPick,
  line: number,
  ft: FullTimeScore,
): SoccerGradeResult {
  const { home_goals_ft, away_goals_ft } = ft;
  if (home_goals_ft === null || away_goals_ft === null) {
    return {
      result: "pending",
      actual_value: null,
      notes: "full-time regulation score unavailable",
    };
  }
  const total = home_goals_ft + away_goals_ft;
  if (total === line) {
    return {
      result: "push",
      actual_value: total,
      notes: `total=${total} equals line=${line} — push`,
    };
  }
  const won = pick === "over" ? total > line : total < line;
  return {
    result: won ? "win" : "loss",
    actual_value: total,
    notes: `regulation total=${total} vs line=${line}; pick=${pick}; ${won ? "win" : "loss"}`,
  };
}

// ─── 3. BTTS (Both Teams To Score) ────────────────────────────────────
// Yes wins iff both teams have >= 1 regulation goal.
// No wins iff at least one team has 0 regulation goals.

export type BttsPick = "yes" | "no";

export function gradeBtts(pick: BttsPick, ft: FullTimeScore): SoccerGradeResult {
  const { home_goals_ft, away_goals_ft } = ft;
  if (home_goals_ft === null || away_goals_ft === null) {
    return {
      result: "pending",
      actual_value: null,
      notes: "full-time regulation score unavailable",
    };
  }
  const bothScored = home_goals_ft >= 1 && away_goals_ft >= 1;
  const actualBtts: BttsPick = bothScored ? "yes" : "no";
  return {
    result: pick === actualBtts ? "win" : "loss",
    actual_value: null,
    notes: `regulation FT ${home_goals_ft}-${away_goals_ft}; both scored=${bothScored}; pick=${pick}`,
  };
}

// ─── 4. Double Chance ────────────────────────────────────────────────
// Selections: "home_or_draw" (1X) | "away_or_draw" (X2) | "home_or_away" (12).
// Resolution: based on the 90-minute regulation score ONLY. Knockouts
// going to ET/penalties resolve double_chance on the 90' score — the
// eventual ET/penalty winner does NOT influence the outcome.
//
// Double chance never pushes: every regulation outcome (home win,
// draw, away win) is included in exactly two of the three selections,
// so each selection is always either a win or a loss.

export type DoubleChancePick = "home_or_draw" | "away_or_draw" | "home_or_away";

export function gradeDoubleChance(
  pick: DoubleChancePick,
  ft: FullTimeScore,
): SoccerGradeResult {
  const { home_goals_ft, away_goals_ft } = ft;
  if (home_goals_ft === null || away_goals_ft === null) {
    return {
      result: "pending",
      actual_value: null,
      notes: "full-time regulation score unavailable",
    };
  }
  const actual: MatchResultPick =
    home_goals_ft > away_goals_ft
      ? "home"
      : home_goals_ft < away_goals_ft
        ? "away"
        : "draw";
  const won = (() => {
    switch (pick) {
      case "home_or_draw": return actual === "home" || actual === "draw";
      case "away_or_draw": return actual === "away" || actual === "draw";
      case "home_or_away": return actual === "home" || actual === "away";
    }
  })();
  return {
    result: won ? "win" : "loss",
    actual_value: null,
    notes: `regulation FT ${home_goals_ft}-${away_goals_ft}; actual=${actual}; pick=${pick}; ${won ? "win" : "loss"}`,
  };
}

// ─── 5. Convention helper ────────────────────────────────────────────
// Returned in the snapshot so auditors and operators can confirm
// the resolution window matches the locked contract.

export function defaultSoccerMarketConvention(
  observed_overtime: boolean | null,
  observed_penalty: boolean | null,
): SoccerMarketConvention {
  return {
    resolution_window: "regulation_90",
    extra_time_occurred: observed_overtime,
    penalty_shootout_occurred: observed_penalty,
  };
}

// ─── 6. Confidence caps (soccer-tuned) ───────────────────────────────
// Soccer is lower-scoring and higher-variance than NBA/MLB. Per the
// product spec, confidence is capped conservatively at launch. These
// caps are READ by the model writer (WC-3); the grader does not use
// them, but they live here as the single source of truth for the
// soccer market caps so model + UI + auditor agree.

export const SOCCER_CONFIDENCE_CAPS = {
  /** 90-minute result: cap ~68 unless a massive mismatch. */
  match_result_default: 68,
  /** Draw picks are conservative — require model + market support. */
  match_result_draw: 60,
  /** Total goals: cap ~66. */
  total_default: 66,
  /** BTTS: cap ~65 unless model/lineups/market strongly align. */
  btts_default: 65,
  /**
   * Double Chance covers two of three outcomes, so implied probability
   * is structurally higher. Cap slightly above match_result_default,
   * but stay conservative — DC payouts are short and over-confident
   * displays mislead more easily.
   */
  double_chance_default: 72,
} as const;

export type SoccerConfidenceCapKey = keyof typeof SOCCER_CONFIDENCE_CAPS;
