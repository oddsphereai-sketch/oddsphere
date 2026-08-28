# CFB release-refresh priority r34 audit

## Observed failure

The untouched 18:54 ET r32 cycle returned `partial`, wrote one UNH at UAlbany T-60 row, made seven bounded provider calls, and reported `t60_capture_late`. The earlier duplicate-event exception was gone. The remaining defect was deterministic writer scheduling: an ordinary due T-60 reason was selected before the incomplete current-release refresh.

## Repair

Writer r23 selects an incomplete current-release refresh before ordinary cadence/T-60 collection. The existing planner still assigns market stages, excludes already-started games, performs bounded provider collection, checks all payloads, and calls the append function once. The immutable UNH r32 row remains; the next natural refresh can append the other 37 upcoming games under the same r32 schema/member/decision identifiers. The member fixture stays on a complete prior wave until 38 current-release identities exist, so no partial or mixed-release board becomes public.

No forecast, PMF, probability, calibration, exact-price tuple, grade, threshold, stake, tracking, T-60 eligibility, settlement, provider identity, request cap, or reader hierarchy changed.
