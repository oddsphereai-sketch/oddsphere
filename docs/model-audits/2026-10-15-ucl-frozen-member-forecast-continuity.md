# UCL frozen member forecast continuity — 2026-10-15

## Owner direction and scope

Daniel Mengel explicitly approved correcting the incomplete October 14 UCL tracking result and preventing the same defect on future slates. This release changes only UCL prediction tracking continuity. It does not change a forecast, probability, projected score, displayed pick, play grade, stake, card, copy, label, provider cadence, or locked member snapshot.

## Root cause

The member cards displayed one forecast for all four supported UCL categories, but the prediction writer treated an unavailable exact sportsbook price as if the forecast side were unavailable. It therefore locked a held manifest row with `pick=null` and `side=null` even though `snapshot_json.member_market_at_capture` had already frozen the exact displayed prediction. Tracking correctly excluded those null-side rows, producing unequal category denominators.

This affected three categories on four fixtures across the October 13–14 slate:

- Slavia Prague at Sabah FK
- Manchester United at Atletico Madrid
- PSV Eindhoven at RB Leipzig
- FC Porto at Real Betis

Match Result had 18 settled predictions. Total, BTTS, and Double Chance each had only 14.

## Approved historical recovery

The twelve locked database rows remain unchanged. The grader and aggregate reader may recover a historical side only when all of the following are true:

- the record is UCL and locked;
- it is held specifically for `missing_coherent_current_price`;
- stored pick, side, odds, and market probability are null;
- the immutable `member_market_at_capture` is itself held with null current price and null market probability; and
- that frozen payload contains a valid sport-specific displayed side.

No final score, post-lock model output, later price, or reconstructed prediction can choose the side. Null-price recovered predictions remain excluded from exact-price ROI.

The exact frozen sides and official outcomes add one Total win and three losses, one BTTS win and three losses, and four Double Chance wins. The corrected two-day category record is:

- Match Result: 14–4 (18)
- Total: 13–5 (18)
- BTTS: 11–7 (18)
- Double Chance: 15–3 (18)
- Combined: 53–19 (72)

The prior incomplete aggregate was 47–13 (60).

## Future invariant

Release `ucl_tracking_forecast_continuity_2026_10_15_r1_frozen_member_pick` makes the UCL writer persist the displayed forecast side even when the exact price is missing. The row remains held for price-dependent actionability and ROI. The four-market lock verifier authenticates that side against the same immutable member payload used to render the locked card.

An unavailable price can therefore remove a wager evaluation, but it cannot erase a prediction that members actually saw. A held row without an exact frozen displayed side remains void and excluded.

## Model-change accounting

- Prediction-side changes: 0
- Projected-score changes: 0
- Probability changes: 0
- Best Angle promotions/demotions: 0/0
- Lean promotions/demotions: 0/0
- Member board-count change: 0
- Locked-row mutations: 0
- Historical prediction-accuracy rows restored: 12
- Historical ROI rows restored: 0

Settlement release advances to `ucl_regulation_settlement_2026_10_15_r4_frozen_member_forecast_continuity`. Tracking aggregate contract advances to `tracking_aggregate_v16_ucl_projected_forecast_continuity_2026_10_15`; cache and stored-snapshot namespaces advance with it. The aggregate's bounded PostgREST projection includes `member_market_at_capture`; this is required so a cold read can apply the same immutable recovery without loading full historical snapshot blobs.

## Validation and rollback

Publication requires the focused UCL production and database-contract suites, prediction-grader and tracking-aggregate suites, full model-change verification, latest-main integration safety, protected pull-request checks, and post-deploy proof that:

- all four categories contain 18 October 14 results;
- the combined record is 53–19 across 72 predictions;
- the twelve source rows retain their original immutable database values;
- null-price rows remain absent from ROI; and
- a future missing-price lock stores the frozen forecast side without becoming actionable.

Rollback removes the read-only recovery and future forecast-side persistence together, restores settlement r3 and tracking aggregate v14, and restores the prior cache namespaces. Existing locked rows remain untouched under either version.
