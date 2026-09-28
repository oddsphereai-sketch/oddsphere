# NFL Paid Score and Provider Opening Shadow Result

## Decision

Ship the provider-opening parser repair and paid weekly score source as internal forward evidence
only. Keep the active pressure-direction prediction, grade, member, tracking, and lock releases
unchanged. Do not promote the same-sample score/market combination into member predictions.

## Release-pure diagnostic

BALLDONTLIE's dated weekly projection endpoint supplied complete pre-kickoff Week 1-3 snapshots for
48 scheduled games; 47 were settled in the frozen evaluation. The direct opponent D/ST
`points_allowed` fields are used as team-score projections. The touchdown/kicking reconstruction is
retained only as a health cross-check.

Against the same 47-game cohort, the direct score produced 31/47 winner direction, 21/44 Spread
direction excluding pushes, and 26/47 Total direction. Team-score / Margin / Total MAE were
8.2301 / 10.6887 / 11.5406. The original 50/50 reconstruction/direct average produced 31/47,
21/44, and 23/47 with MAE 8.2266 / 10.6953 / 11.5966. The existing R95 independent diagnostic
produced 27/47, 17/44, and 21/47 with MAE 8.4826 / 11.1221 / 12.0518.

Only Week 3 retained both provider openings and immutable pregame current evidence. Median strict
same-book opening-to-pregame Spread movement pointed to the eventual cover in 9/13 non-zero moves;
the paid score went 6/13 on those games. Adding the one-for-one consensus market move to the direct
independent margin, while leaving the direct Total untouched, yielded the combined diagnostic:

- winner direction: 31/47 (65.96%);
- Spread direction: 22/44 (50.00%);
- Total direction: 26/47 (55.32%);
- team-score / Margin / Total MAE: 8.1556 / 10.5402 / 11.5406.

This is the strongest coherent score candidate found on the exact current-season cohort. The
Spread combination has only 15 games of recoverable path evidence and is not a holdout, so it is a
forward candidate rather than production authority.

## Data defect and boundary

The provider `/odds/opening` rows use `opened_at`; the adapter previously required `updated_at` and
dropped every valid opener. The repaired adapter retains `opened_at` only for opening responses and
continues requiring `updated_at` for current responses. Coverage became 16/16 games in each of
Weeks 1-3. Exact same-book provider opening and immutable pregame pairs were recovered for all 16
Week 3 games, with at least six pairs per settled game.

The repaired provider opening enters target-ineligible context capture only. Active operational
opening selection deliberately continues the existing first-observed behavior. The read-only live
board replay covered 16/16 provider openings, 15 current games, and the sole unlocked game; it
produced zero score, probability, side, grade, promotion, demotion, actionable-count, or lock
changes. Existing T-60 evidence and official tracking remain immutable.

## Load and rollback

Paid weekly projections are fetched once per slate in bounded 100-row pages, capped at ten pages,
and reused for six hours. Observed full slates required five requests, so the normal maximum is 20
requests per day rather than a per-game loop. Failure silently retains the latest complete shadow
and cannot block Daily Edge publication. Only aggregate per-game scores are stored.

Rollback is the September 27 collector/writer plus the September 26 context release. Removing the
optional shadow payload and restoring the prior adapter release changes no member schema.
