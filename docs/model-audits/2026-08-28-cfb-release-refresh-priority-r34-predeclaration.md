# CFB release-refresh priority r34 predeclaration

## Trigger

The first untouched r32 cycle at 2026-08-28 18:54 ET cleared canonical-event ambiguity, but ordinary T-60 work took priority over the incomplete release refresh. It appended only the already-late UNH at UAlbany T-60 row and returned `partial` / `t60_capture_late`, leaving the complete 38-game r32 member wave unavailable.

## Frozen change

- When any pre-T60 upcoming game still lacks the current schema/member/decision release, the current-release refresh takes priority over an ordinary cadence or T-60 reason for planning that run.
- The existing planner still assigns T-60 to any due game and unlocked refreshes to the remaining upcoming games, and the writer still performs one append after all payload/coherence checks.
- Keep the already-written immutable r32 UNH row. After its kickoff, refresh only the remaining 37 upcoming games under the same r32 member/decision release; the member reader remains on its complete prior wave until all 38 r32 rows exist, then switches atomically.
- Do not write post-kickoff evidence, synthesize odds, manually invoke the writer, or change prediction, probability, calibration, grade, stake, T-60 eligibility, settlement, provider caps, or the sole `prediction_pipeline:cfb` lease.

Only the writer release advances from r22 to `cfb_forward_evidence_writer_2026_08_28_r23_release_refresh_priority`. The existing r32 payload/member/decision releases remain authoritative because r32 has not yet become a complete public wave.
