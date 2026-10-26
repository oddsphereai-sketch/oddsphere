# NBA player-props component and market-reader repair result

Date: 2026-10-26  
Status: qualified production candidate for future-unlocked rows

## Result

The broad first candidate was rejected. Moving Points to the generic two-point
target-excluded reader lost three net decisions in the exact runtime replay and
worsened its projection MAE. Threes was direction-neutral. Neither change is in
the production candidate.

The qualified candidate changes only Rebounds and Rebounds + Assists:

- retain each market's active independent model and frozen coefficients;
- permit categorical correction at a two-percentage-point target-book-excluded
  consensus distance;
- do not require a movement veto, because the release-pure lock replay showed
  that the active four-point plus `not_opposed` gate discarded more correct
  corrections than it protected;
- retain every other market, grade policy, price selector, cadence, and member
  surface unchanged.

## Exact stored-lock replay

The actual frozen runtime was replayed over October 22-25 from 2,646 resolved
rows, 170,425 pre-lock observations, stored lock times, point-in-time features,
and official box scores.

| Scope | Active | Candidate | Net | Active MAE | Candidate MAE |
|---|---:|---:|---:|---:|---:|
| All markets | 1,464-1,182 (55.33%) | 1,473-1,173 (55.67%) | +9 | 4.596 | 4.588 |
| Rebounds | 176-191 (47.96%) | 183-184 (49.86%) | +7 | 3.085 | 3.039 |
| Rebounds + Assists | 145-131 (52.54%) | 147-129 (53.26%) | +2 | 3.438 | 3.426 |

There are 19 side changes: 14 corrections and five harms. Every unchanged
market is byte-identical in direction, projection, and grade. The candidate has
zero side/projection contradictions.

## Grade and board impact

Across the exact replay, grade counts remain identical:

- Best Angle: 8 -> 8
- Lean: 41 -> 41
- Watchlist: 44 -> 44
- No Play: 2,553 -> 2,553
- actionable promotions: 0
- actionable demotions: 0

The October 26 unlocked board contains 744 decisions. The candidate changes 26
rebound-family sides, keeps 41 Leans and eight Best Angles, and produces zero
invalid/nonpositive forecasts and zero side/projection contradictions. It does
not flatten or flood the board.

## Component interpretation

The evidence supports a rebound-specific reader repair, not a generic rule for
every market. Points + Rebounds remains 56.27% in the exact runtime replay and
PRA remains 56.58%; neither inherits the rebound correction. This avoids using
one weak standalone component to overwrite stronger direct combination heads.

The deeper shared-latent-component redesign remains separate research. It must
produce one minutes/role state and coherent P/R/A centers while preserving the
historically stronger direct combination results. This release does not claim
that larger architecture is complete.

## Releases and rollback

- artifact: `nba_player_props_frozen_runtime_artifact_2026_10_26_r8_component_market_reader`
- decision: `nba_player_props_forward_decision_2026_10_26_r9_component_market_reader`

The checked-in artifact checksum covers the unchanged frozen models plus the
two versioned arbitration changes. The sole writer and shared
`prediction_pipeline:nba` lease remain authoritative. Existing locked rows keep
their exact stored projection, probability, side, grade, price, and evidence.
Rollback applies only to future-unlocked generation.
