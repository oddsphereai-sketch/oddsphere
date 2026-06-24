export type PublicMarketGrade = "Best Angle" | "Lean" | "Watchlist" | "Caution";

export type PublicMarketSignal = {
  public_betting_pct: number | null;
  public_money_pct: number | null;
};

export type PublicMarketContext = {
  pickedBetsPct: number | null;
  pickedMoneyPct: number | null;
  oppositeBetsPct: number | null;
  oppositeMoneyPct: number | null;
  support: "none" | "money_support" | "public_consensus";
  conflict: "none" | "public_smoke" | "opposing_money";
  gradeBefore: PublicMarketGrade;
  gradeAfter: PublicMarketGrade;
  reason: string | null;
};

const GRADE_ORDER: Record<PublicMarketGrade, number> = {
  Caution: 0,
  Watchlist: 1,
  Lean: 2,
  "Best Angle": 3,
};

const ORDER_TO_GRADE: PublicMarketGrade[] = ["Caution", "Watchlist", "Lean", "Best Angle"];

function clampGrade(grade: PublicMarketGrade, min: PublicMarketGrade, max: PublicMarketGrade): PublicMarketGrade {
  const n = Math.max(GRADE_ORDER[min], Math.min(GRADE_ORDER[max], GRADE_ORDER[grade]));
  return ORDER_TO_GRADE[n]!;
}

function raiseOne(grade: PublicMarketGrade): PublicMarketGrade {
  return ORDER_TO_GRADE[Math.min(3, GRADE_ORDER[grade] + 1)]!;
}

/**
 * Bounded public-split model context.
 *
 * This intentionally adjusts grade/actionability only. Public split data never
 * creates +EV/RLM/steam/CLV and never changes raw projected scores.
 */
export function applyPublicMarketContext(opts: {
  grade: PublicMarketGrade;
  picked: PublicMarketSignal | null;
  opposite: PublicMarketSignal | null;
  minGradeForBoost?: PublicMarketGrade;
  maxBoostGrade?: PublicMarketGrade;
}): PublicMarketContext {
  const pickedBets = opts.picked?.public_betting_pct ?? null;
  const pickedMoney = opts.picked?.public_money_pct ?? null;
  const oppBets = opts.opposite?.public_betting_pct ?? null;
  const oppMoney = opts.opposite?.public_money_pct ?? null;
  const minGradeForBoost = opts.minGradeForBoost ?? "Watchlist";
  const maxBoostGrade = opts.maxBoostGrade ?? "Lean";

  let support: PublicMarketContext["support"] = "none";
  let conflict: PublicMarketContext["conflict"] = "none";
  let grade = opts.grade;
  let reason: string | null = null;

  if (oppMoney !== null && oppBets !== null && oppMoney >= 60 && oppMoney - oppBets >= 8) {
    conflict = "opposing_money";
    grade = clampGrade(grade, "Caution", "Lean");
    reason = `Opposing money split (${oppMoney}% money vs ${oppBets}% bets) caps actionability.`;
  } else if (pickedBets !== null && pickedMoney !== null && pickedBets >= 70 && pickedMoney - pickedBets <= 5) {
    conflict = "public_smoke";
    grade = clampGrade(grade, "Caution", "Lean");
    reason = `Heavy public side (${pickedBets}% bets) without clear money premium caps actionability.`;
  } else if (pickedMoney !== null && pickedBets !== null && pickedMoney >= 58 && pickedMoney - pickedBets >= 6) {
    support = "money_support";
    if (GRADE_ORDER[grade] >= GRADE_ORDER[minGradeForBoost]) {
      grade = clampGrade(raiseOne(grade), "Caution", maxBoostGrade);
      reason = `Money split supports model side (${pickedMoney}% money vs ${pickedBets}% bets).`;
    }
  } else if (pickedMoney !== null && pickedBets !== null && pickedMoney >= 60 && pickedBets >= 55 && Math.abs(pickedMoney - pickedBets) <= 8) {
    support = "public_consensus";
    reason = `Public and money both lean model side (${pickedMoney}% money, ${pickedBets}% bets).`;
  }

  return {
    pickedBetsPct: pickedBets,
    pickedMoneyPct: pickedMoney,
    oppositeBetsPct: oppBets,
    oppositeMoneyPct: oppMoney,
    support,
    conflict,
    gradeBefore: opts.grade,
    gradeAfter: grade,
    reason,
  };
}
