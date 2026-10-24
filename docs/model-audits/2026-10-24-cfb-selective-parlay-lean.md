# CFB selective Parlay Lean classification

Date: 2026-10-24

Status: qualified for conservative future unlocked publication; exact historical coverage is limited
Scope: CFB Moneyline presentation only; official Bet grades, stakes, and tracking are unchanged

## Decision

Add a separate `Parlay Lean` profile for high-confidence CFB Moneyline favorites that remain
Watchlist because the exact price is not a qualified straight-bet value. Do not promote those rows
to the official Lean grade. This preserves the distinction between “likely to win” and “worth
betting alone at this price.”

The profile requires all of the following: official grade Watchlist; probability grade Best Angle;
model probability at least 75%; price from -200 through -400; supportive same-book movement; no
verified sharp or public resistance; a verified injury report; and zero health holds. It applies
only to Moneylines. More expensive favorites, resistance, incomplete injuries, or a lower win
probability fail closed.

## Evidence

The read-only settled-lock audit found 430 graded CFB Moneylines. Three matched the price,
probability, movement, and resistance screen and went 3-0. None had verified injury coverage stored
at lock, so the complete rule has zero historically eligible rows and must not be described as a
3-0 backtest. The three signal-only rows were East Carolina -360, Miami (OH) -220, and Mercer -232,
with 78.70% average model probability, +1.1634 units, and 38.78% ROI. Extending the signal-only price
screen to -450 introduced the first loss; requiring 78% or 80% at -400 left only one row.

This is a small selected signal sample, not a guarantee, untouched holdout, or full-rule replay.
Because verified injury evidence is a fail-closed eligibility gate rather than a direction-setting
adjustment, it cannot turn an otherwise ineligible historical row into support. The limited evidence
is sufficient only for a conservative secondary label with zero current board promotions. It does
not justify a new official wager grade or stake.

The October 24 board rehearsal excludes Miami -1600, SMU -1100, and Texas State around -530 on
price alone; Troy, Boise State, and Alabama also fail verified resistance or support requirements.
The lane may be empty when no practical favorite clears every gate. Official actionable promotions
are zero, official actionable demotions are zero, and all existing Bet-grade counts remain unchanged.

## Product and lock contract

- The card and reader show `Parlay Lean` beside the official Watchlist badge, never in its place.
- The CFB board gains a dedicated Parlay Lean filter.
- `Parlay Lean` is stored in the versioned decision before a future T-60 lock.
- Existing r52 and earlier locked payloads contain no profile and remain visually and mathematically
  unchanged. The transition reader preserves them while new r53 unlocked rows populate.
- The profile cannot change a winner, score, probability, price, grade, stake, expected value, or
  official result record.

## Releases and rollback

Decision release advances from r52 to r53 and the decision tuple schema advances from r39 to r40.
The secondary classifier is `cfb_selective_parlay_lean_profile_2026_10_24_r1`. Rollback stops
writing the profile for future unlocked rows and removes its board filter; it cannot rewrite a
stored lock.

## Reproduction and publication gates

Run `scripts/operator/audit-cfb-selective-parlay-lean.ts` with the normal read-only operator
credentials. Publication requires the focused CFB contract, TypeScript except for documented
repository-external dependency failures, `npm run verify:model-change`, clean latest-main
integration safety, protected PR checks, and post-deploy proof of r53 plus the live profile.
