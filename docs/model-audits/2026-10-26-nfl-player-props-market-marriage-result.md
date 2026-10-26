# NFL Player Props market-marriage result

Date: 2026-10-26

## Result

The candidate qualifies for future unlocked NFL Player Props. It keeps every independent point
head intact and makes three bounded downstream repairs:

1. Target-book-excluded passing evidence at a nearby main line can now affect the transported
   passing posterior. The exact-price grade still requires its existing exact confirmation, so the
   repair cannot manufacture an actionable wager.
2. Passing Yards uses the qualified 0.2 independent-residual coefficient instead of the fully
   independent 1.0 posterior. In this formula, 0 is market-only and 1 is independent-only.
3. Receptions and Receiving Yards may promote a positive-economics, participation-qualified,
   non-adverse Watchlist to Lean. Best Angle thresholds are unchanged.

## Release-pure evidence

The exact stored-lock replay uses one canonical game/player/market/main-line decision and official
box-score outcomes. Weeks 5-6 are the inspected selection block; Week 7 is the later confirmation
block. This is current-season evidence, not represented as a pristine multi-season holdout.

- Passing Yards across Weeks 5-7 improves direction from 31-27 (53.4%) to 34-24 (58.6%), MAE from
  56.9 to 49.6 yards, and Brier score from 0.284 to 0.253. Every week improves MAE, and Weeks 6 and
  7 each improve direction.
- Target-excluded Passing Attempts improves combined Weeks 5-7 direction from 30-28 (51.7%) to
  32-26 (55.2%). It receives no new actionable lane from this release.
- Receiver-lane promotions are 18-7 in Weeks 5-6 and 7-4 in Week 7. Including incumbent actions,
  Receptions plus Receiving Yards move from 7-7 to 32-18 across the complete replay.
- Passing Yards exact-price actions contract from four to one under the corrected forecast. The
  paired receiver lane adds 36 tested actions, so the affected-market board moves from 18 actions
  to 51 rather than flattening. Their combined actionable record moves from 8-10 to 32-19.
- No quota, forced Over/Under balance, target-book self-confirmation, outcome leakage, new provider
  call, or cross-market generic rule is introduced.

## Same-input live-board rehearsal

The current Week 7 member snapshot was replayed read-only with the incumbent and candidate from the
same stored inputs. Only the remaining unlocked DAL-PHI game was eligible; all earlier locks stayed
outside the replay and were not reconstructed or mutated.

- 59 canonical decisions matched between control and candidate; none were added or dropped.
- Two projections/probabilities changed and no forecast side changed.
- Actionable decisions moved from 4 to 6: two Receiving Yards Watchlists promoted to Lean, with zero
  actionable demotions.
- One nonactionable Passing Yards row moved from Watchlist to No Play after the corrected posterior;
  every unrelated market was unchanged.

## Production releases

- Portable artifact: `nfl_player_props_runtime_2026_10_26_r16_market_marriage`
- Model: `nfl_player_props_distribution_model_2026_10_26_r27_market_marriage`
- Calibration: `nfl_player_props_distribution_calibration_2026_10_26_r29_market_marriage`
- Decision: `nfl_player_props_decision_2026_10_26_r33_market_marriage`
- Runtime / board: `nfl_player_props_runtime_2026_10_26_r34_market_marriage` /
  `nfl_player_props_board_2026_10_26_r37_market_marriage`
- Member / lifecycle: `nfl_player_props_member_2026_10_26_r46_market_marriage` /
  `nfl_player_props_member_lifecycle_2026_10_26_r28_market_marriage`
- Writer / tracking: `nfl_player_props_writer_2026_10_26_r60_market_marriage` /
  `nfl_player_props_tracking_2026_10_26_r34_market_marriage`
- Passing market / coherent projection / source-aware reader:
  `nfl_player_props_market_residual_calibration_2026_10_26_r9_target_excluded_marriage` /
  `nfl_player_props_market_coherent_projection_2026_10_26_r3_target_excluded_marriage` /
  `nfl_player_props_market_reading_2026_10_26_r4_market_specific_actionability`

## Safety and rollback

Existing locked decisions are never relabeled, rescored, regraded, or rewritten. During a partial
provider cycle, only unchanged Anytime Touchdown rows from the immediately preceding decision
release may bridge; ordinary rows must be recomputed under the complete new release family. Roll
back future unlocked evaluation to the champion identifiers above if release identities mix,
market evidence self-confirms, the actionable board unexpectedly contracts, or live projections,
sides, grades, and stored reader evidence cease to agree.
