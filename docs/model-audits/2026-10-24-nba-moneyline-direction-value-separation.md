# NBA Moneyline direction/value separation

## Owner direction

On 2026-10-24 Daniel Mengel reported that San Antonio and Phoenix were shown as
NBA Moneyline Cautions, questioned the absence of genuine San Antonio market
resistance, and asked whether the product still flips qualified picks. He
directed Oddsphere to fix the behavior.

## Root cause

The professional NBA reader and the existing validated Spread-authored flip
path were both present. The defect was downstream in the legacy grade adapter:

- `model probability - target-excluded no-vig probability <= -10pp` was stored
  in the compatibility `strong_conflict` band;
- the grade function returned Caution from that band before checking the exact
  selected-price expected value; and
- the member adapter translated the same compatibility band to
  `market_resistance` without consulting the qualified directional result that
  had already been resolved inside the prediction pipeline.

That confused two different questions. A sportsbook pricing the selected team
more strongly than the model can make the wager poor value while agreeing on
the winner. It does not imply that the market moved toward the opponent.

## Candidate contract

- Model / prediction record:
  `nba_professional_unified_2026_10_24_r19_moneyline_direction_value_separation`
- Market marriage:
  `nba_market_marriage_2026_10_24_r20_moneyline_direction_value_separation`
- Grade policy:
  `nba_grade_policy_2026_10_24_r12_moneyline_direction_value_separation`
- Refresh:
  `nba_daily_refresh_schedule_2026_10_24_r16_moneyline_direction_value_separation`
- Member lock publication:
  `nba_member_lock_publication_2026_10_24_r5_moneyline_direction_value_separation`
- Locked member snapshot:
  `nba_locked_member_snapshot_2026_10_24_r3_moneyline_direction_value_separation`

For future unlocked rows, a negative same-side Moneyline value gap reaches the
existing positive exact-price-EV gate and becomes Watchlist when the selected
price is not playable. Direction is resolved separately, in this precedence:

1. validated Spread-authored final winner;
2. qualified direct Moneyline movement;
3. qualified Spread observation when the direct read is unavailable; and
4. neutral when no qualified directional evidence exists.

Public splits remain context-only. No continuous market weight, split-only
flip, automatic favorite/underdog rule, score nudge, confidence cap, or new
provider call is introduced. The already-validated two-point Spread correction
remains the only market-reader path that can rebuild the score and cross the
Moneyline winner.

## Exact current-board result

Read-only production-input audit at `2026-10-24T13:48:03.595Z` for the
2026-10-24 slate:

- games: 8;
- legacy Moneyline grades: 4 Best Angle, 1 Lean, 1 Watchlist, 2 Caution;
- candidate Moneyline grades: 4 Best Angle, 1 Lean, 3 Watchlist, 0 Caution;
- Moneyline actionables: 5 to 5;
- actionable promotions: 0;
- actionable demotions: 0;
- score changes: 0;
- side changes: 0;
- probability changes: 0;
- selected-price changes: 0; and
- corrected displayed direction states: 6.

Specific incident rows:

- San Antonio at Dallas remains San Antonio Moneyline with the unchanged
  117.24-113.81 projection. The -506 selected quote is negative model value,
  so the grade is Watchlist. The qualified same-side Spread observation makes
  its directional state market-confirmed, not resistant.
- Golden State at Phoenix remains Phoenix Moneyline with the unchanged
  110.79-106.56 projection. The observed -305 selected quote is negative model
  value, so the grade is Watchlist. Neither its direct Moneyline nor Spread
  evidence cleared qualification, so direction is neutral rather than falsely
  resistant.

The seven signal corrections include removal of false confirmation where a
positive model-versus-price edge existed without qualified directional movement.
This is intentional: value and directional evidence are now separate axes.

## Locked-record boundary

The new resolved-direction field is written only into future unlocked output.
Older locked snapshots do not contain it; the adapter falls back to their exact
legacy compatibility behavior. The prediction writer continues to skip locked
rows, and the locked-member reader retains stored-payload precedence.

## Verification and rollback

Required verification:

- `scripts/test-nba-moneyline-direction-value-separation.ts`;
- `scripts/test-nba-market-specific-grades.ts`;
- `scripts/test-nba-professional-candidate.ts`;
- `scripts/test-nba-market-reader-display-separation.ts`;
- `scripts/test-nba-locked-member-snapshot.ts`;
- `scripts/test-nba-published-lock-metadata.ts`;
- `scripts/test-nba-t60-lock-lifecycle.ts`;
- TypeScript;
- `npm run verify:model-change`;
- latest-main integration safety; and
- protected pull-request checks.

Rollback the r19/r20/r12/r16/r5/r3 family together for future unlocked rows if
the live release differs from this audit, any actionable count changes, a score
or side changes, a qualified direction is inverted, or any locked payload is
rewritten or reinterpreted. Never rewrite a locked r18 or earlier record.
