# CFB official-availability per-game cadence correction

Date: 2026-10-15  
Status: owner-approved implementation candidate; publication still requires the normal clean-PR gates

## Problem

The CFB writer correctly retained the newest verified exact-game injury report, but its refresh
cadence was tracked globally while each provider response was parsed only against the games in
that run's capture subset. A successful four-conference request for one small subset suppressed
another request for six hours even when the next subset contained games that had never received
an official-report attempt. Unmatched reports from the first response were not persisted.

This made the continuity mechanism look healthy while starving most of the slate before continuity
could begin. It did not mutate prior evidence or locked predictions; it failed to collect available
future evidence.

## Evidence before the correction

The field-projected, SELECT-only production audit at `2026-10-15T12:25:02.485Z` found:

- 97 games in the October 13-19 board;
- 1 stored verified conference report and 96 unavailable reports;
- 7 games with any stored official-availability attempt evidence, but only 1 latest game row
  retained a nonzero attempt marker;
- 95/97 games with current odds and 60/97 with a qualified canonical market anchor;
- all 37 market-anchor holds were FCS-only; all 60 FBS-involved games had an anchor;
- 97/97 games had active-quarterback coverage and no current rich-team-profile hold.

The old full-payload launch audit is not a safe coverage diagnostic: transporting the complete
season payload can truncate a multi-megabyte response before JSON parsing. The new operator audit
projects only bounded provenance and coverage fields.

## Live zero-write provider replay

`scripts/operator/audit-current-cfb-official-availability-candidate.ts` read the production identity
and quarterback fields, made the four bounded official-conference requests, and performed zero
writes. The public SEC, ACC, Big Ten, and Big 12 feeds returned 26 uniquely matched current-board
reports with no provider failures:

- stored verified reports: 1;
- live exact-game reports: 26;
- reports recovered by the candidate: 25;
- candidate verified-report coverage: 26;
- exact expected-quarterback matches: 7, including four `out` designations.

The quarterback matches are audit evidence only in this release. Conference reports remain outside
prediction, probability, grade, and stake authority until a release-pure historical replay validates
both corrections and harms. The existing call site continues to pass only qualified Playbook reports
to `reportedCfbQuarterbackAvailability`.

ESPN's league injury endpoint was rejected as a fallback because its nominal 2026 response contained
only three records dated 2020 or 2022. BALLDONTLIE's tested NCAAF player-injury route and Playbook's
documented CFB injury route both returned HTTP 404. Missing reports for conferences without a verified
official source remain explicitly unavailable; an absent report is never interpreted as a healthy team.

## Correction

`shouldFetchCfbOfficialConferenceAvailability` now records cadence per planned provider game. A recent
attempt for one game cannot suppress another planned game with no recent attempt. When every planned
game has a recent attempt, the same six-hour ordinary and one-hour final-pregame bounds still prevent
hot-loop polling. The sole writer, four-request ceiling, exact event/team/date matching, last-known
report precedence, and append-only evidence path are unchanged.

Release identifiers:

- collector: `cfb_forward_evidence_collector_2026_10_15_r58_per_game_official_availability_cadence`;
- sole writer: `cfb_forward_evidence_writer_2026_10_15_r123_bounded_lifecycle_metadata`;
- shared publication coherence:
  `football_cross_market_coherence_2026_10_15_r13_pmf_near_tie_representative_score`.

## Production capacity repair discovered during coordination

Cross-task production review found that every scheduled CFB evidence run from at least 11:45 through
12:40 UTC failed before collection with `CFB forward evidence metadata read exceeded its bounded
50000-row season limit`. The latest evidence had therefore stopped advancing at 01:55 UTC. Production
contained 47,085 repeated unlocked rows, compared with 2,319 opening rows and 600 T-60 rows.

The r123 reader keeps the complete opening/T-60 lifecycle trail for game identity, prior-result
planning, immutable lock precedence, and tracking recovery. It separately reads only the preceding
48 hours of high-volume unlocked continuity. The movement projection keeps every visible opening and
the preceding 72 hours of observations. Stored evidence remains append-only: no row is deleted,
updated, reconstructed, or assigned new semantics. A malformed selected payload is quarantined by ID
while valid sibling payloads continue; its lightweight identity metadata remains available to the
prior-result planner.

A production-backed zero-write rehearsal at `2026-10-15T12:46:14.989Z` proved that the reader clears
the old limit and that the full writer reaches collection and publication planning:

- provider slate: 99 games;
- refreshed captures proposed: 95 unlocked, zero inserted;
- conference reports in proposed payloads: 26, versus one before;
- model-covered FBS games with evaluated markets: 57 in that provider response;
- Playbook was deliberately exercised with an unavailable local credential and failed in its isolated
  provider lane without blocking the writer.

The rehearsal isolated one otherwise healthy game (`457361`) because an exact-even PMF accumulated a
home-win probability of `0.5000000000000003` while its discrete representative score was home by one.
Coherence r13 extends the already-approved PMF-verified CFB 0.5-point near-zero mean/median tolerance
to the representative-score direction check. Exact-even floating-point noise no longer drops that
game; non-PMF mismatches and every mismatch outside the narrow expected-margin band remain fatal.
This is a publication-continuity correction, not a prediction or grading change. The combined second
rehearsal completed with zero game-level capture failures.

The evidence schema, member release, forecast, PMF, reader, calibration, grade, decision, exact-price,
stake, tracking, compact-snapshot, lease, and lock releases remain unchanged. The new verified reports
can change only future unlocked injury-panel coverage and availability copy in this release.

## Verification and publication gates

Before publication:

1. focused official-availability continuity tests pass, including the cross-subset starvation regression;
2. the field-projected production audit remains readable and reports FBS/FCS anchor scope separately;
3. `npm run verify:model-change` and affected CFB tests pass;
4. latest `origin/main` is an ancestor of the candidate and integration safety passes;
5. publication occurs through a protected pull request after explicit owner approval.

After deployment, the next due unlocked cycle must prove the r58/r123 tuple, one shared
`prediction_pipeline:cfb` lease, 26 current exact-game reports (or a source-explained newer count),
no mixed member release, unchanged locked payloads, and no prediction/grade/stake change caused by
the report-only correction. Roll back the collector/writer/coherence constants to r57/r121/r12 if request cadence
loops, reports cross game identity, the board contracts, or any locked field changes.
