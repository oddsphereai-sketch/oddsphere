# NFL player props discrete market arbitration predeclaration

Date: 2026-10-07  
Starting production base: `4f4c1db4a2990d5c38c98e58a57a70b1092f873d`

## Scope

This release is limited to the NFL player-props ordinary receiving-yards and
receptions forecast arbitration inside the existing sole production writer.
The portable independent models, quarterback passing workload model, all other
prop markets, exact-price selection, grade thresholds, stakes, provider calls,
schedule, writer ownership, `prediction_pipeline:nfl` lease, lock and settlement
rules, member copy, labels, and layout are unchanged.

The current champion family is:

- runtime `nfl_player_props_runtime_2026_09_29_r20_injury_feed_continuity`
- board `nfl_player_props_board_2026_09_29_r23_injury_feed_continuity`
- decision `nfl_player_props_decision_2026_09_29_r19_injury_feed_continuity`
- model `nfl_player_props_distribution_model_2026_09_29_r15_injury_feed_continuity`
- calibration `nfl_player_props_distribution_calibration_2026_09_29_r16_injury_feed_continuity`
- member `nfl_player_props_member_2026_09_29_r30_injury_feed_continuity`
- lifecycle `nfl_player_props_member_lifecycle_2026_09_29_r13_injury_feed_continuity`
- writer `nfl_player_props_writer_2026_09_29_r35_injury_feed_continuity`
- tracking `nfl_player_props_tracking_2026_09_29_r18_injury_feed_continuity`

## Fixed candidate before production editing

The independent probability remains authoritative by default. Target-book-
excluded market evidence may replace it only under these market-specific rules:

1. Receiving yards: when the independent and target-excluded market directions
   disagree and at least one independent same-line book exists, use the market
   probability as the final forecast probability.
2. Receptions: apply the same full flip only when the target-excluded market is
   additionally at least five percentage points from 50%.
3. Every other market retains the incumbent behavior exactly.

This is discrete arbitration, not a cross-sport rule, an Over quota, or a
continuous generic market weight. The displayed point projection remains the
inverse of the same final empirical posterior that supplies the displayed side
and probability. Exact evaluated price remains downstream grade economics.

## Chronological evidence used to select the rule

The release-pure Week 4 export contains 641 canonical game/player/market main
lines. It was split chronologically before candidate selection.

- Receiving yards selection: direction `55.67% -> 57.73%`; Brier
  `0.2484 -> 0.2428`; 22 forecast flips.
- Receiving yards confirmation: direction `55.21% -> 59.38%`; Brier
  `0.2686 -> 0.2567`; 20 forecast flips.
- Receptions selection: direction stays `57.14%`; Brier
  `0.2696 -> 0.2588`.
- Receptions confirmation: direction `52.08% -> 54.17%`; Brier
  `0.2695 -> 0.2609`.

Passing-yards market flips worsened the confirmation segment. Rushing-attempts
evidence was too small and did not improve confirmation direction. Those and all
other broad market-arbitration candidates are rejected for this release.

## Mandatory gates before publication

- Recompute the exact current unlocked board and report every forecast-side
  change, promotion, demotion, actionable count, and market mix.
- Reject the candidate if it unexpectedly flattens the board or removes an
  entire actionable market without a validated symmetric promotion path.
- Prove unchanged markets are byte-equivalent apart from release identifiers.
- Run focused runtime, contract, writer/snapshot, and tracking tests plus
  `npm run verify:model-change`.
- Integrate the latest remote `main`, rerun affected verification, pass
  integration safety, publish through a protected pull request, and verify the
  deployed release and next natural writer cycle.
- Existing locked decisions remain immutable and release-separated.

