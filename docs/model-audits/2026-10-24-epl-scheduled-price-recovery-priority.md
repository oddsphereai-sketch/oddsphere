# EPL scheduled-fixture price-recovery priority

Date: 2026-10-24

## Predeclared scope

This correction is limited to the bounded recovery order used when the primary
SharpAPI EPL fixture read returns an incomplete four-market board. The shared
soccer preview currently permits at most four EPL recovery fixture loads. It
selects those fixtures in slate order, so already-started or final matches can
consume the complete recovery allowance before a scheduled fixture whose prices
are required by the publication gate.

The candidate retains the four-fixture ceiling and the existing one-load-per-
fixture behavior, but ranks incomplete `scheduled` fixtures before incomplete
non-scheduled fixtures. Original slate order remains stable inside each group.
If fewer than four scheduled fixtures are incomplete, the remaining allowance
may still recover non-scheduled fixtures. UCL explicitly allows every incomplete
fixture one recovery load, so the ordering change does not alter its request
count or eligibility.

## Release and authority boundary

- Sport / competition: EPL only.
- Markets: Match Result, Double Chance, Total 2.5, and BTTS price availability.
- Current model: `epl_goals_coherent_2026_10_13_r20_coherent_total_margin_matchup`.
- Current grade policy: `epl_grade_policy_2026_10_10_v25_exact_match_result_price_tiering`.
- Current publication lifecycle: `epl_member_snapshot_lifecycle_2026_10_17_r5_scheduled_fixture_price_gate`.
- Candidate publication lifecycle: `epl_member_snapshot_lifecycle_2026_10_24_r6_scheduled_price_recovery_priority`.
- Authoritative writer: `app/api/cron/epl-daily-refresh/route.ts`.
- Shared lease: `prediction_pipeline:soccer`.
- Targeted T-60 writer: `app/api/cron/epl-pregame-lock/route.ts`, under the same lease.

The candidate changes no forecast equation, model input, probability, selected
side, market-reader rule, grade threshold, stake, provider endpoint, provider
call ceiling, cadence, writer ownership, publication completeness threshold,
lock rule, settlement rule, member copy, label, or layout. Existing locked
payloads retain exact stored precedence and are never reconstructed from the
new recovery response.

## Pre-change production evidence

The protected 2026-10-24 EPL refresh run
`443f9a90-611b-47d3-bf5e-c44b3ee83890` wrote 271 records and 219 line-history
rows but failed publication closed with 30/32 selected current prices and 75/80
outcome rows across eight active scheduled fixtures. The run preserved eight
locked rows and the complete verified locked provider IDs
`3818264, 3818259, 3818258, 3818261`. A separate zero-write provider rehearsal
returned all 32/32 selected prices, establishing that the missing scheduled
prices are intermittently recoverable rather than structurally unavailable.

## Acceptance gates

Before publication:

1. A deterministic regression must prove that four earlier incomplete non-
   scheduled fixtures cannot starve a later incomplete scheduled fixture.
2. The recovery ceiling must remain four and no fixture may receive more than
   one recovery load.
3. A same-input complete-board comparison must report side, grade, promotion,
   demotion, and actionable-count impact. Complete identical input must produce
   zero changes.
4. Focused EPL model, publication, lock, and evidence tests, TypeScript, lint,
   and `npm run verify:model-change` must pass.
5. The candidate must be based on latest `origin/main`, pass integration safety
   and protected pull-request checks, and publish only after merge.
6. Post-deploy proof must show the r6 lifecycle, complete scheduled-fixture
   coverage, one EPL writer under `prediction_pipeline:soccer`, and unchanged
   existing locked payloads.

Rollback only the future unlocked r6 lifecycle/recovery ordering if request
bounds grow, a scheduled fixture is still starved by a non-scheduled fixture,
the board contracts unexpectedly, publication admits incomplete scheduled
prices, writer/lease ownership changes, or any locked field changes.

## Result

The deterministic regression supplies six incomplete fixtures in slate order:
four non-scheduled fixtures followed by two scheduled fixtures. With the
unchanged four-load ceiling, the candidate recovery order is `[4, 5, 0, 1]`.
The two scheduled fixtures therefore receive recovery before the earlier
non-scheduled fixtures, original order remains stable inside both groups, no
fixture appears twice, and a zero allowance yields zero retries. A complete
first-pass fixture set yields zero recovery loads.

The credential-backed zero-write production-candidate rehearsal covered the
current ten-fixture round, including eight scheduled fixtures and eight
preserved locked market records. It produced:

- 32/32 selected current prices and 32/32 openings;
- 80/80 scheduled-fixture outcome rows, all 80 with trails;
- 816 complete all-book rows across 19 books and all four EPL markets;
- complete current club-stat and recent-xG team coverage;
- 5 Leans, 11 Watchlists, and 16 No Plays across 32 scheduled-fixture market
  records; and
- zero seed, writer, coverage, or coherence errors.

Because the candidate changes only which incomplete fixture receives an
already-authorized recovery load, identical complete input changes zero scores,
sides, probabilities, grades, promotions, demotions, or actionables. The
current complete-input impact is therefore 0 promotions, 0 demotions, 0 side
changes, and 0 actionable-count change. The rehearsal used `apply=false`, so it
performed no production write and could not mutate the eight existing locks.

The operator report was also aligned with the production publication contract:
its all-outcome completeness denominator now includes scheduled fixtures only.
It no longer reports withdrawn final/live prices as a false current-board
failure; this diagnostic correction changes no runtime prediction or member
payload.
