# NFL player-props provider and Radar coverage repair — result

Date: 2026-09-18

Approved release boundary: provider observation `nfl_player_props_provider_observation_2026_09_18_r9_sharp_alias_coverage`, member `nfl_player_props_member_2026_09_18_r21_actionable_radar_coverage`, member lifecycle `nfl_player_props_member_lifecycle_2026_09_18_r3_actionable_radar_coverage`, and writer `nfl_player_props_writer_2026_09_18_r23_provider_alias_coverage`. Model, calibration, decision, runtime, board, and tracking identifiers remain the active September 16 set.

## Read-only production evidence

The published Week 2 snapshot generated at `2026-09-18T16:06:09.903Z` contains 2,845 member rows across all 16 games and 452 game-player identities. Its internal board has 16 Best Angles, 53 Leans, 300 Watchlists, 2,244 ordinary No Plays, and 232 role/identity exceptions; the member projection converts those exceptions to No Play, for 2,476 member-facing No Plays. There are 69 actionable rows.

A fresh no-write replay after the exact alias repair returned:

- 51,151 normalized current/opening observations;
- 20,069 exact offers;
- 3,122 member rows across the same 16 games;
- 18 Best Angles / 56 Leans / 314 Watchlists / 2,478 ordinary No Plays / 256 internal exceptions;
- 74 actionable rows and 12 tracking-eligible locked rows;
- 46 provider/API calls, below the unchanged 51-call collection ceiling and 93-call incremental ceiling;
- zero current-season state calls or writes and `published: false`.

Because provider prices and availability moved after the published baseline, that temporal comparison is coverage/freshness evidence, not causal board-impact evidence. A second audit therefore scored one identical raw provider capture twice at `2026-09-18T20:40:03.874Z`: once with all candidate rows and once after removing only the four observations whose provider market strings use the three repaired aliases. Both sides produced exactly 3,147 rows across 16 games, 17 Best Angles / 58 Leans / 311 Watchlists / 2,505 ordinary No Plays / 256 internal exceptions, and 75 actionables. There were zero added, removed, or changed decisions and zero actionable promotions/demotions. Model, calibration, probabilities, projections, grade thresholds, stakes, locks, settlement, ranked full-board predictions, and tracking formulas are unchanged.

## Coverage and distribution interpretation

The live provider inventory is not a small feed: a direct collection contains all 16 games and 16 canonical families. Eight families currently have production models: the seven volume/yardage families plus anytime touchdown. Passing touchdowns, interceptions, combined rushing/receiving yards, generic touchdowns, first touchdown, longest pass/reception/rush, field goals made, and kicking points remain research-only until their own chronological model/calibration evidence exists. Period-specific props and ambiguous provider strings remain rejected. No missing category or prediction is fabricated.

The current 69 actionable volume/yardage rows are 7 Over and 62 Under. Removing the modal-side action gate would still yield 10 Over and 71 Under, so that gate is not the cause of the skew. The strongest existing locked historical lanes are legitimately Under-heavy: receiving-yards Under Best Angle, receptions Under Best Angle, and rushing-attempts Lean all passed the documented 2025 confirmation evidence. The repair therefore does not force an Over quota. A separate recalibration requires a larger release-pure current-season outcome sample; Week 2 currently supplies only a tiny, incomplete result set.

## Radar impact

The current same-capture ranked forecast/member-action comparison found 13 market scopes where a Best Angle or Lean sibling was hidden from Today’s Radar because the ranked display forecast selected a No Play sibling. Radar now starts from actual Best Angle/Lean rows, preserving its existing signal sort, scope dedupe, filters, and six-card limit. This changes zero predictions or grades and makes the actionable surface faithful to the complete board.

## Health and rollback

All requested BALLDONTLIE player identities were present in the candidate replay. Cursor metadata no longer creates a false pagination failure; the exact missing-ID health check remains. SharpAPI remains deliberately bounded to eight pages as optional enrichment, while BALLDONTLIE remains the complete primary catalog. The candidate adds no calls and no site-load path.

Rollback is the preceding provider/member/lifecycle/writer set. Any live game loss, release mismatch, provider-budget breach, member-reader failure, actionable collapse, or locked-row mutation requires rollback while preserving already locked/tracked evidence.
