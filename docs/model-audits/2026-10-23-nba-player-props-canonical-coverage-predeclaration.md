# NBA player-props canonical coverage predeclaration

Date: 2026-10-23

## Owner direction

The member product must keep exactly one canonical row for each available
game/player/market while avoiding the football failure mode that exposed many
alternate lines for the same prediction. Alternate ladders remain internal
price evidence. An available player must not disappear merely because the
initial canonical-line choice has only one sportsbook.

## Current release and authoritative path

- Sport/model family: NBA player props, all eight supported foundation markets.
- Frozen model/decision: `nba_player_props_frozen_runtime_artifact_2026_10_23_r7_rebound_family_market_reader` / `nba_player_props_forward_decision_2026_10_23_r7_rebound_family_market_reader`.
- Product/writer: `nba_player_props_product_candidate_2026_10_22_r7_rebound_grade_recalibration` / `nba_player_props_private_writer_2026_10_22_r6_rebound_grade_recalibration`.
- Sole writer: `nba-daily-refresh` under the existing `prediction_pipeline:nba` lease.
- Starting production base: `9e42c1aee25dd16b5618d61f15d74a58b5373424`.

## Verified defect

The 11:12 ET member snapshot contains 923 canonical decisions while the same
provider response exposes 1,174 supported player/market scopes. Assists contain
110 of 141 available players. The canonical selector may choose a one-book line
nearest its median anchor even when a different current line has two or more
complete books; the downstream target-excluded requirement then suppresses the
entire player/market. Of the 31 missing assists scopes, 29 selected a one-book
line and two had no corroborating line.

## Candidate behavior

1. Continue emitting exactly one row per game/player/market.
2. When any current complete line has at least two sportsbooks, select only
   among those corroborated lines using the existing anchor/tie-break behavior.
3. When no corroborated line exists, retain the existing canonical line and
   publish an independent-model forecast at the best exact price on its side.
   Such a row remains `No Play`, has null other-book probability, zero confirming
   books, and cannot enter any relative promotion pool.
4. Do not change the independent model, corroborated market arbitration, grade
   policies, provider cadence, member layout/copy, stake, settlement, writer,
   lease, or locked-record precedence.

## Required proof

- Existing corroborated decisions are byte-for-byte forecast/grade equivalent.
- Added rows are unique canonical scopes, use genuine provider lines/prices,
  carry nonzero coherent projections, and remain `No Play` without corroboration.
- Report coverage by market and promotions/demotions on the current unlocked
  slate. No existing actionable may be demoted without a validated paired
  promotion; the intended candidate changes zero existing grades.
- Focused NBA props contracts, TypeScript, `npm run verify:model-change`, latest-
  main integration safety, protected PR checks, authoritative refresh, live
  release/coverage proof, and immutable locked-snapshot hash verification are
  required before declaring the release live.

## Rollback

Roll back the complete release family for future unlocked rows if an existing
corroborated forecast changes unexpectedly, duplicate canonical rows appear,
single-book rows become actionable, current coverage contracts, the board or
writer fails, or any stored locked row changes.
