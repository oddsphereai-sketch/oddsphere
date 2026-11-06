/** Owner-selected wager eligibility. Predictions, prices and legacy locks are untouched.
 * Apply only inside a current decision writer, after evidence-based qualification. */
export const MONEYLINE_PRICE_POLICY_RELEASE = "moneyline_price_policy_2026_11_06_r1_owner_boundaries" as const;
export const MONEYLINE_BEST_MINIMUM_PRICE = -200;
export const MONEYLINE_LEAN_MINIMUM_PRICE = -500;
export const MONEYLINE_PRICE_NO_PLAY_REASON = "moneyline_price_below_owner_actionable_limit" as const;
export const MONEYLINE_PRICE_NO_PLAY_EXPLANATION = "The moneyline is more expensive than -500; the winner prediction remains visible, but this wager is No Play.";
export type MoneylinePriceGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play" | "Held";
export function qualifyMoneylinePrice<T extends MoneylinePriceGrade>(market:string,price:number|null,grade:T):T|"Lean"|"No Play" {
 if(market!=="moneyline"||grade==="Held"||price===null||!Number.isFinite(price))return grade;
 if(price<MONEYLINE_LEAN_MINIMUM_PRICE)return "No Play";
 if(grade==="Best Angle"&&price<MONEYLINE_BEST_MINIMUM_PRICE)return "Lean";
 return grade;
}
