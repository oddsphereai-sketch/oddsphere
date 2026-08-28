# CFB ambiguous canonical event scope r32 audit

## Production trigger

The untouched 2026-08-28 18:24 ET writer reached SharpAPI's deeper canonical-event pages after r31, then correctly aborted before append because provider game `458636` (UNH at UAlbany) matched two exact canonical event IDs. That provider ambiguity was isolated to one FCS game, but the old global exception prevented all 38 games from receiving the new release.

## Correction

- Multiple exact canonical IDs for one scheduled game are now a market-evidence availability state for that game. Neither ID is queried for odds, no ID/line/price/EV is synthesized, and the writer records `sharpapi_canonical_event_ambiguous`.
- Every other uniquely matched game continues through real named-book collection and the sole all-game append.
- Reuse of one canonical event ID across different scheduled games, malformed pagination, repeated/non-advancing pages, and request-cap exhaustion remain fatal.
- Distant games refresh every six hours, games inside 24 hours refresh hourly, and T-60 is a separate event-triggered capture/lock. The 15-minute schedule is only a no-op eligibility heartbeat between due captures.
- The football-only PMF, public predictions, calibration, thresholds, grade policy, tracking boundaries, and reader presentation are unchanged.

## Release impact

Provider/decision/tuple/collector/member/writer/fixture advance to r10/r15/r9/r17/r19/r22/r23. Evidence schema stays r10 because the immutable payload shape is unchanged. The complete r31 wave is the first transition fallback, followed by r29, until the first complete r32 wave is available.

## Verification

The focused provider contract covers matched, unpublished, and ambiguous statuses; proves zero odds calls for ambiguous IDs; and retains a fatal cross-game canonical-ID reuse guard. The production contract covers the r31 atomic fallback, uniform hourly cadence, and event-triggered T-60 metadata. Full model verification, build, protected publication, untouched natural-cycle replay, and signed-in QA are recorded in the deployment evidence before release acceptance.
