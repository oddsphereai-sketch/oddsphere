# NBA player props active-role integrity repair

Date: 2026-10-22  
Status: private forward release only; member/public output remains disabled

## Scope and diagnosis

This repair is limited to NBA player-prop point-in-time role inputs, frozen
runtime coherence, private product assembly, and the sole private writer. It
does not add a writer, timer, provider request, member route, label, or copy.
The existing `prediction_pipeline:nba` lease and immutable lock lifecycle
remain authoritative.

The stored October 22 private slate exposed three distinct integrity defects:

1. Zero-minute box rows were treated as played minutes. Kentavious
   Caldwell-Pope therefore showed a 2.6-minute last-ten average even though his
   actual active appearances represented a normal rotation role.
2. First-game rest was extrapolated as roughly 190 linear daily increments
   through a model trained on in-season rest. This collapsed multiple opening-
   night projections to zero.
3. An equal-distance market flip could reflect a positive counting projection
   below zero and clamp it to zero. A specialized rebound model could also
   extrapolate to its zero clamp while the separately validated ridge model
   retained a plausible positive forecast.

## Accepted repair

- Conditional minutes and per-minute production use active appearances when
  the recent window is DNP-dominated, crosses an offseason-length layoff, or
  contains early-season DNP contamination. DNP rows remain available as
  participation evidence; they are not reclassified as appearances.
- Participation starts with the player's current-team tenure and records its
  actual sample size. A prior team's games cannot become current-team
  participation evidence.
- Player rest saturates at seven days. The raw chronology remains intact; only
  the model input stops extrapolating hundreds of days outside its supported
  range.
- If the qualified robust rebound model alone clamps to zero for an offered
  standard prop, the already frozen ridge model supplies the forecast. No new
  coefficient is fitted at runtime.
- If equal-distance reflection would cross below zero, the selected Under is
  represented conservatively 0.05 below the offered line rather than as a
  fabricated zero. This prevents the impossible value from creating false
  confidence.
- The sole writer preserves the previous coherent private snapshot if any
  offered standard prop still produces a non-finite or non-positive
  independent/final forecast.

## Current-slate proof

The read-only October 22 reconstruction used two games, 25 players, and 155
decisions from the stored private price and state bundles. Before the repair it
contained 57 zero independent projections and 41 zero final projections at the
initial reproduction; after the complete repair it contains zero of either.

Caldwell-Pope's active last-ten minutes are 23.1 rather than 2.6. His points
independent projection is 14.313. Because target-excluded prices select the
Under 6.5, the final conflict representation is 6.45 and No Play—not zero.
Isaiah Hartenstein's rebound clamp is replaced by the positive 7.085 ridge
forecast. No public row changes because NBA props remain member-disabled.

## Historical comparison

The comparison reuses the immutable 360-game / 360,522-opening-observation
archive with zero provider calls. Both versions are scored by the same active
frozen artifact, exact-price reader, and grade policies on 17,258 common
settled rows.

| Measure | Prior inputs | Corrected inputs |
|---|---:|---:|
| Overall record | 9,134-8,124 | 9,169-8,089 |
| Overall accuracy | 52.93% | 53.13% |
| Overall units | -507.03 | -429.66 |
| Overall ROI | -2.94% | -2.49% |
| Actionable record | 556-434 | 528-433 |
| Actionable accuracy | 56.16% | 54.94% |
| Actionable units | +33.24 | +7.64 |
| Actionable ROI | +3.36% | +0.79% |
| Actionable count | 990 | 961 |

There are 143 grade-rank promotions and 163 demotions; the actionable board
decreases by 29 (2.9%). The corrected inputs improve broad direction and ROI,
but the old grade calibration does not fully transfer. Therefore this release
repairs the active private inputs/runtime and remains publicly disabled. It is
not evidence to activate member grades. Public activation requires a separate
chronological recalibration and untouched confirmation release.

## Releases and rollback

- Features:
  `nba_player_props_point_in_time_features_2026_10_22_r6_active_role_integrity`
- Independent research:
  `nba_player_props_independent_research_2026_10_22_r4_active_role_integrity`
- Frozen runtime:
  `nba_player_props_frozen_runtime_artifact_2026_10_22_r5_active_role_integrity`
- Model behavior:
  `nba_player_props_model_tournament_2026_10_22_r13_active_role_integrity`
- Private calibration behavior:
  `nba_player_props_exact_price_grade_2026_10_22_r12_active_role_integrity_private_only`
- Decision:
  `nba_player_props_forward_decision_2026_10_22_r5_active_role_integrity_disabled`
- Product/snapshot:
  `nba_player_props_product_candidate_2026_10_22_r6_active_role_integrity` /
  `nba_player_props_member_snapshot_candidate_2026_10_22_r6_active_role_integrity_disabled`
- Sole private writer:
  `nba_player_props_private_writer_2026_10_22_r5_active_role_integrity`

Rollback restores the r4 artifact/decision, r5 product/snapshot, r4 writer,
and r5 feature behavior for future unlocked private rows only. Existing locked
records are never rewritten by release or rollback.
