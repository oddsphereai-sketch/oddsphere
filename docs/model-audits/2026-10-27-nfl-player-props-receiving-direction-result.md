# NFL player-props Receiving Yards direction correction result

Date: 2026-10-27

## Release-pure result

Across exact canonical-main-line r32 Receiving Yards outcomes from Weeks 6–7, the independent direction was 190-152 (55.56%) and the target-book-excluded market direction was 196-146 (57.31%). The released residual posterior was 188-154 (54.97%). The candidate corrects only genuine independent/market direction disagreements.

- Week 6 selection: 95-84 incumbent to 102-77 candidate.
- Week 7 confirmation: 93-70 incumbent to 94-69 candidate.
- Combined direction mix: 86 Overs / 256 Unders incumbent to 132 Overs / 210 Unders candidate.
- Brier score: approximately 0.2541 incumbent to 0.2529 candidate.
- A one-percentage-point market-conviction threshold was rejected because it discarded nearly every useful direction correction. The authority gate is fresh target-book-excluded evidence, not a manufactured distance threshold.
- Rushing Yards was rejected: its combined result improved by two net decisions, but Week 7 regressed from 41-36 to 38-39.
- A universal Over/Under balance rule was rejected.

This evidence is not a claim that every Over is preferable. Receiving Yards remains naturally Under-majority after the correction; the improvement comes from changing the specific rows where independent and qualified target-excluded evidence disagree.

## Current unlocked no-write rehearsal

The October 27 Week 8 rehearsal loaded all 14 games, 10,124 observations, 3,788 exact offers, and 310 isolated reference observations (246 NoVig, 64 Pinnacle) without a production write. It stayed within the 44-call collection maximum.

The fresh board has 46 Receiving Yards member rows, changes 17 forecast directions, and moves the canonical direction mix to 6 Overs / 17 Unders. It does not force parity. In the same-input candidate report, Receiving Yards has five promotions and one demotion and the complete canonical action board expands from 12 to 16 rather than flattening. The separate comparison with the previously stored page reports a Receptions promotion caused by newly collected input; it is not counted as a Receiving Yards rule effect.

Every displayed projection is rebuilt from the one calibrated posterior, so the projection, direction, probability, and selected side remain coherent. Missing reference evidence falls back to the preceding posterior. Passing, Receptions, rushing, and touchdown semantics are unchanged.

## Safety and rollback

Existing locked payloads retain byte-for-byte precedence. The candidate reuses the sole writer, shared NFL lease, isolated cached reference lane, existing cadence, and existing provider ceiling. No member copy, label, layout, or public tracking change is included. Roll back only future unlocked rows to the October 26 champion on mixed releases, coverage loss, an unexpected action-board collapse, a lock mutation, or a failed post-deploy writer/reader proof.
