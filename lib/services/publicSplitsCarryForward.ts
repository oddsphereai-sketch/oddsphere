/**
 * Pure carry-forward + independence helper for the public splits write path.
 *
 * P1B 2026-06-12 — extracted from linesService into its own module so the
 * contract has unit-test coverage without pulling in the supabase client
 * (linesService binds to env at import time).
 *
 * Contract:
 *  • betting and money are MERGED INDEPENDENTLY — a null on one side never
 *    suppresses the other;
 *  • a non-null new value always wins (fresh poll → fresh value);
 *  • a null new value falls back to the prior persisted value if available
 *    (carry-forward — last known good wins over silent vendor gaps);
 *  • when both new and prior are null on a side, that side stays null
 *    (NEVER fabricated — the persisted column is honest about absence).
 *
 * `carried` is true iff at least one side flipped from null → prior value.
 *
 * Pure. No I/O. No side effects.
 */
export function mergePublicSplitsCarryForward(
  newBetting: number | null,
  newMoney: number | null,
  prior: { public_betting_pct: number | null; public_money_pct: number | null } | undefined,
): { betting: number | null; money: number | null; carried: boolean } {
  let betting = newBetting;
  let money = newMoney;
  let carried = false;
  if (prior !== undefined) {
    if (betting === null && prior.public_betting_pct !== null) {
      betting = prior.public_betting_pct;
      carried = true;
    }
    if (money === null && prior.public_money_pct !== null) {
      money = prior.public_money_pct;
      carried = true;
    }
  }
  return { betting, money, carried };
}
