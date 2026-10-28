# NFL player-props Owls source cutover result

Date: 2026-10-28

## Decision

Qualify Owls Insight as the active current/reference player-prop price source and remove every active Sharp API player-prop request. BALLDONTLIE remains the slate, identity, retail-current, and opening source. This is a source-continuity release, not a claim that a provider change alone improves prediction accuracy.

## Live provider proof

The read-only Week 8 collection completed with 14 games and one Owls request:

- BALLDONTLIE: 6,751 normalized observations across 14 games and six retail books.
- Owls: 1,636 normalized complete price observations across 13 games, six books, 141 named players, and 818 complete two-way buckets.
- Combined: 8,387 current observations; collection complete; zero invalid timestamps.
- Production rehearsal with openings: 15,968 observations, 6,934 exact offers, 382 qualified Owls Pinnacle/NoVig observations, and 191 complete reference pairs (157 NoVig, 34 Pinnacle).
- The live Owls inventory timestamps were minutes old. The collector rejects provider timestamps more than six hours old or more than one minute in the future.
- One bounded Owls league request replaces the old generic and reference Sharp pagination. The declared collection ceiling falls from 63 calls to 46; the incremental cycle ceiling falls from 113 to 96.

Unsupported provider categories remain explicit health telemetry and cannot be silently reinterpreted. Safe exact aliases were added for `rush_rec_yards`, `longest_completion`, and `field_goals_made`. One-sided first-touchdown prices remain outside the two-way model contract.

## Model and board impact

The guaranteed no-write Week 8 rehearsal published nothing and made no database writes.

- Same-input release comparison: 774 matched member rows, zero additions/removals, zero projection changes, zero side changes, zero promotions, zero demotions, and 35 to 35 actionables. This proves the release stamps themselves do not change math.
- Current live-board comparison: 526 matched rows, 248 additions, 177 removals, 64 projection changes, 10 side changes, 3 promotions, zero demotions, and 14 to 35 actionables. The larger board is primarily new/current offer coverage rather than a threshold change. It is an intentional and visible consequence of restoring current data, not evidence of improved settled accuracy.
- The current candidate contains 774 member rows. Core forecast telemetry contains 35 actionable rows; the full internal exact-line board contains 54 actionable tuples before canonical member-line selection.
- Existing locked decisions retain exact stored precedence. New provider semantics apply only to unlocked rows and future locks.

## Active releases

- Provider observation: `nfl_player_props_provider_observation_2026_10_28_r14_owls_reference_prices`
- Portable/runtime/board: `nfl_player_props_runtime_2026_10_28_r22_owls_reference_prices` / `nfl_player_props_runtime_2026_10_28_r40_owls_reference_prices` / `nfl_player_props_board_2026_10_28_r43_owls_reference_prices`
- Model/calibration/decision: `nfl_player_props_distribution_model_2026_10_28_r33_owls_reference_prices` / `nfl_player_props_distribution_calibration_2026_10_28_r35_owls_reference_prices` / `nfl_player_props_decision_2026_10_28_r39_owls_reference_prices`
- Member/lifecycle/writer/tracking: `nfl_player_props_member_2026_10_28_r52_owls_reference_prices` / `nfl_player_props_member_lifecycle_2026_10_28_r34_owls_reference_prices` / `nfl_player_props_writer_2026_10_28_r66_owls_reference_prices` / `nfl_player_props_tracking_2026_10_28_r40_owls_reference_prices`
- Reference cache: `nfl_player_props_reference_offer_store_2026_10_28_r4_owls_source`

## Verification and monitoring

Focused tests cover normalization, freshness, exact event reconciliation, one-request bounds, legacy Sharp provenance reads, locked-row precedence, T-60 freeze, market evidence, observer history, snapshots, tracking, and settlement. The production route passes the already-required Owls key into the existing sole writer under `prediction_pipeline:nfl`; no second writer or lease was added.

Accuracy must be evaluated forward by these release identifiers and locked timestamp. Do not blend this release with the superseded Sharp-source release and call the blend current performance.

## Rollback

Rollback is the preceding release family with BALLDONTLIE survivability only. Sharp API is not an operational rollback because the subscription was canceled. The Owls reference cache has a new release, so stored Sharp reference offers cannot be relabeled as Owls or silently reused under the new source contract.
