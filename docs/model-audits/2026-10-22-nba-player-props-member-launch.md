# NBA player props member launch

Date: 2026-10-22  
Status: owner-approved member launch

## Scope

Expose the already qualified NBA player-props private forward snapshot through
the existing Player Props product. The launch adds no prediction, projection,
side, probability, line, price, grade, market-reader, provider, cadence, writer,
tracking, settlement, or lock behavior. It adds only the member read path,
league navigation, and removal of preview-only presentation on the member
surface.

The authoritative source remains the sole NBA private writer inside
`prediction_pipeline:nba`. Member requests read the bounded stored snapshot and
never call BALLDONTLIE, The Odds API, SharpAPI, Playbook, or any other provider.
The source snapshot retains `publicEnabled=false` so it cannot be mistaken for
a second public writer. Publication is controlled separately by
`NBA_PLAYER_PROPS_MEMBER_ENABLED=true` and member surface release
`nba_player_props_member_surface_2026_10_22_r1_public_launch`.

## Pre-launch evidence

- Production writer release:
  `nba_player_props_private_writer_2026_10_22_r6_rebound_grade_recalibration`.
- Stored product/snapshot releases:
  `nba_player_props_product_candidate_2026_10_22_r7_rebound_grade_recalibration` /
  `nba_player_props_member_snapshot_candidate_2026_10_22_r7_rebound_grade_recalibration_disabled`.
- Current production rehearsal: two games, 25 players, 155 canonical decisions,
  zero zero-valued independent/final projections, and zero projection/side
  contradictions.
- Exact current writer read: 27 feature rows, 155 decisions, 788 observations
  added, 3,787 refreshed, zero conflicts, zero findings, and zero The Odds API
  credits.
- Current member board: eight Leans, nine Watchlists, 138 No Plays, six
  sportsbooks, and no locked rows before the slate lock boundary.
- Untouched confirmation: 147 actionables, 93-54 (63.27%), +22.83 units,
  +15.53% ROI. Confirmation board count is unchanged from the frozen baseline;
  all eight markets retain actionables across the three chronological windows.

## Safety and rollback

The member page reads the current Eastern-date snapshot with the shared bounded
member-data deadline. A transient missing read produces an empty product shell;
it cannot trigger a provider call or replace the stored last-known-good
snapshot. Preview-only copy remains available only in the development preview.
The member page renders every stored decision exactly and performs no grade or
forecast recalculation.

Rollback is the single production environment gate
`NBA_PLAYER_PROPS_MEMBER_ENABLED=false`. It removes only member navigation and
route access. It must not delete or rewrite the private snapshot, market
history, tracking history, settlement history, or any locked payload.
