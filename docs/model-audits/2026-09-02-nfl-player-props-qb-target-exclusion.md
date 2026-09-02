# NFL player-props QB target-exclusion candidate

Date: 2026-09-02  
Candidate: `nfl_player_props_runtime_2026_09_02_r9_qb_target_exclusion`  
Publication base: `8f27adf0307999a0c36048037c510fc618f02a24`
Status: qualified protected-production candidate; publication pending

## Bounded behavior

For each evaluated passing-yards offer, the expected-starter point projection now excludes that
sportsbook before forming the existing median market-implied center. One or more alternatives
retain the incumbent 90% market / 10% recent-role head without a new singleton coefficient. With
zero alternatives, the projection is the existing recent-role median and the probability path
uses that independent distribution rather than the evaluated quote. The evaluated offer remains
the exact EV/grade price, and the independent same-line action gate is unchanged.

The ordinary target-excluded cross-line residual, universal 80/20 residual formula, thresholds,
movement handling, starter/availability handling, action eligibility, stake, lock, writer, lease,
provider, collection, settlement, and member presentation are unchanged. Non-passing markets do
not enter the new branch.

## Release separation

- QB point head: `nfl_player_props_qb_passing_projection_2026_09_02_r2_target_excluded_consensus`
- model/calibration: `nfl_player_props_distribution_model_2026_09_02_r6_qb_target_exclusion` /
  `nfl_player_props_distribution_calibration_2026_09_02_r6_qb_target_exclusion`
- decision/runtime/board: `nfl_player_props_decision_2026_09_02_r9_qb_target_exclusion` /
  `nfl_player_props_runtime_2026_09_02_r9_qb_target_exclusion` /
  `nfl_player_props_board_2026_09_02_r12_qb_target_exclusion`
- member/writer/tracking: `nfl_player_props_member_2026_09_02_r15_qb_target_exclusion` /
  `nfl_player_props_writer_2026_09_02_r17_qb_target_exclusion` /
  `nfl_player_props_tracking_2026_09_02_r9_qb_target_exclusion`

The portable artifact r4, market residual r7, probability-inverse projection r1, exact market
board, provider, settlement, and capture releases remain unchanged. The shared release registry
is updated with the production candidate after source review.

## Frozen full-board replay

The SELECT-only replay read the natural Week 1 snapshot generated at
`2026-09-02T21:06:09.346Z`. It made one database SELECT, zero provider calls, and zero writes.
The snapshot is release-pure: member r14, board r11, and all 1,116 unlocked rows use decision r8.

| Scope | Rows | Projection changes | Raw probability changes | Market probability changes | Final probability changes | Side changes | Grade changes | Action promotions / demotions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Full board | 1,116 | 112 | 112 | 2 | 112 | 0 | 2 | 0 / 0 |
| Passing yards | 128 | 112 | 112 | 2 | 112 | 0 | 2 | 0 / 0 |
| Every non-passing category | 988 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 |

The maximum absolute point-projection change is 42.5406186605658 yards and the maximum absolute
final-probability change is 0.12275316518813784. These large zero-alternative changes are the
direct removal of the evaluated quote, not a new confidence weight. Candidate board counts are
6 Best Angles / 34 Leans / 98 Watchlists / 916 No Plays / 62 Held versus incumbent
6 / 34 / 96 / 918 / 62. Actionable rows remain 40.

All 128 Passing Yards rows have zero evaluated-offer references in QB consensus: 2 use the
existing independent role projection because no alternative exists, 108 have one target-excluded
alternative, and 18 have two or more. The evaluated quote remains grade economics only.

The two grade changes are genuine passing-yards No Play to Watchlist transitions, not version
mismatch effects: Caleb Williams Over 224.5 at FanDuel moves to +0.1000pp
target-excluded edge with +2.7676% EV; Malik Willis Under 184.5 at FanDuel moves from -0.1597pp to
+0.3404pp edge with +0.4058% EV. Both retain the existing separate-book Watchlist bridge and are
non-actionable. There are no actionable demotions, so no compensating action promotion is needed;
the unchanged promotion path remains available to any row meeting the incumbent exact-economics
and independent-book gates.

All eight supported categories are reported, including zero current rows for passing attempts,
passing completions, and rushing attempts. Anytime TD (266), receiving yards (316), receptions
(198), and rushing yards (208) are value-identical. Their combined incumbent and candidate
behavior hashes are both
`18c8983b8a276dfc199bff2888f64785d8a565b3ee14b9c7c5cbca33c64779be`.

The frozen snapshot has zero locked rows. The production-contract regression separately proves
that a locked tuple keeps its stored probability, projection, side, grade, price, stake evidence,
and original releases across a candidate refresh. Tracking remains release-stamp/compatibility
only, and the candidate adds no tracking write path.

The audit fails closed on an incumbent release mismatch, any non-passing or locked-row change,
an actionable zero-alternative passing row, an actionable demotion without an exercised promotion
path, or flattening a previously actionable category. This replay has no violations: evaluation-only
passing rows remain non-actionable and no category is flattened.

## Reproduction and disposition

```bash
npx tsx --env-file=.env.local \
  scripts/operator/audit-nfl-player-props-qb-target-exclusion.ts \
  --season=2026 --week=1
```

The operator emits a delta record for every changed row and summaries for all 1,116 rows. This
candidate is a structural leakage correction, not evidence that the 90/10 head or universal
80/20 residual is calibrated optimally. Broader contextual reliability remains separate until
release-separated forward outcomes settle.

## Authoritative operation and telemetry

There is no shadow board or evidence activation gate. Once accepted and published, the existing
leased NFL forward-evidence cycle calls the props writer once and r17 becomes the normal canonical
writer. Each evaluated Passing Yards quote automatically excludes its sportsbook from both the QB
point consensus and cross-line residual. When no alternative exists, the same live branch uses the
existing independent role projection and the existing action gate keeps that row non-actionable;
the evaluated quote remains exact-price economics only.

The natural cron response includes structured forecast telemetry: board/member release identities,
target-excluded point-consensus rows, passing rows without a target-excluded point consensus,
target-excluded residual rows, unlocked Passing Yards release mismatches, locked rows, and actions.
The writer writes only after the complete collection/context/build/reconciliation cycle. A failure
before that write retains the same-key last-known-good snapshot; locked legacy rows keep their exact
stored payload and original releases. This adds no provider call, query, table, writer, cron, lease,
or snapshot duplication.
