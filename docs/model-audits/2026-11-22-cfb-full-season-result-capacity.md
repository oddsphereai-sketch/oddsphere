# CFB full-season result capacity

Production base: `1c928498556b0d02b1b8a169a877114a73cacfb5`.
Task branch: `codex/cfb-week-rollover-20261122`. Scope: the existing CFB forward
writer's bounded prior-result planner. Writer advances R156 to
`cfb_forward_evidence_writer_2026_11_22_r157_full_season_result_capacity`.
All model/calibration/market/grade/reader release identifiers stay exact because
their calculations and inputs within the predecessor's supported capacity do
not change. The single `prediction_pipeline:cfb` lease remains required.

## Failure and repair

At November 22 17:11 UTC the member board still held 115 previous-week games;
its last publication was 04:55 UTC. Every recent scheduled writer failed with
`CFB prior-game result coverage exceeds its 1200-ID season budget.` The
payload-free season lifecycle trail contained 4,375 observations / 1,282 unique
games. This was a season-capacity failure before new-window publication.

Increase the finite season identity limit to 2,400. Keep each provider read at
100 exact requested IDs, at most three supported UTC dates, and at most four
pages. Do not truncate results, drop FCS games, replace the model, create another
writer, bypass the lease, or change the Tuesday-through-Monday/Sunday-overlap
selection. Current provider responses still filter to the exact requested IDs.

The zero-write replay preserves all 1,282 identities with no duplication or
omission. Its 1,200-game subcohort plan equals R156 exactly. The original full
cohort reproduces the production failure. The source metadata archive SHA256 is
`e463569593b3fab0b8e7b4374ffabadc5c5e1cc4d1d498df09d15b3e38a590a7`;
the replay uses 24 unchanged bounded read units.

## Behavior and release gates

No score equation, probability, side, market-reader input rule, offered quote,
grade, stake, tracking or locked record changes. Comparable existing-board
impact: zero promotions, zero demotions, zero removals. Next week's previously
unpublished games must receive the existing model's normal evaluations; no play
quota or forced promotion is introduced. Every original locked tuple remains
authoritative under its original release.

Regression coverage crosses 1,200, fills the 2,400 ceiling, rejects overflow,
proves complete identity coverage and bounded requests, excludes target/future
results, retains the latest corrected schedule date and preserves the input
objects. Publication requires the focused CFB suites, full model verification,
affected lint/type checks, clean integration safety, an up-to-date protected PR,
and actual production cron/member-board/lock proof. If the repaired writer fails
later in its pipeline, keep the last coherent member snapshot and resolve that
failure before declaring the slate repaired.

Focused weekly/production tests, the complete CFB production suite, full
`npm run verify:model-change`, affected-source semantic TypeScript and lint
passed. The new season-capacity regression is imported by the existing weekly
engine suite, so ordinary CFB release checks exercise the late-season boundary.
Whole-repository TypeScript exhausted its 4GB heap; that broad check is not
claimed green. The focused semantic check completed successfully with the
project's settings. Main protection was read back as strict/up-to-date with
required `current-main-ancestor` and administrator enforcement enabled.

Rollback: restore writer R156 and its prior-result ceiling as one commit through
the protected PR path; never remove appended evidence or rewrite old locks.
