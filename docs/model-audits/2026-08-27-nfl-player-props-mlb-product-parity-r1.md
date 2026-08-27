# NFL Player Props MLB product-parity release

Date: 2026-08-27

## Scope and invariant

This is a presentation and member-payload release for NFL Player Props. It does not change the active distribution model, probability calibration, exact-price decision policy, promotion thresholds, grade, stake, provider plan, shared NFL writer lease, T-60 lifecycle, tracking, CLV, or settlement behavior.

The active scoring tuple remains:

- model `nfl_player_props_distribution_model_2026_08_25_r2_shared_context`
- calibration `nfl_player_props_distribution_calibration_2026_08_25_r2_shared_context`
- decision `nfl_player_props_decision_2026_08_25_r2_exact_price_shared_context`
- runtime `nfl_player_props_runtime_2026_08_25_r2_shared_context`

Only the board DTO, member snapshot, and sole writer payload identifiers advance to `nfl_player_props_board_2026_08_27_r5_research_trends`, `nfl_player_props_member_2026_08_27_r7_research_trends`, and `nfl_player_props_writer_2026_08_27_r8_research_trends`.

## Shared product contract

MLB and NFL now consume the same Player Props hero, metric, section-heading, filter, radar-card, league-navigation, and reader-shell primitives. NFL follows MLB's container width, slate summary, matchup navigation, Today's Radar, research workspace, responsive paired-market board, and centered desktop/full-screen mobile reader hierarchy.

NFL keeps sport-specific evidence in those locations: projection and empirical 80% range, participation, target/carry/pass opportunity, snap and share trends, opponent allowance, expected quarterback, team scoring environment, injury/availability status, exact sportsbook prices, and genuine same-book opening/current movement.

## Model-input lineage

The portable artifact already scores timestamped prior-game features for last game, L3 average, L5 average, and exponentially weighted history. The prior member payload published only selected EWM summaries. This release packages compact trend windows from the exact feature row already used by the scorer:

- market production (yards, receptions, attempts, completions, carries, or touchdown rate);
- relevant role/opportunity inputs (targets, carries, pass attempts, team volume, target/rush/pass share, snap share, red-zone and goal-line opportunity);
- opponent allowance where the corresponding lag/average features exist.

Every trend point is stamped `modelInput: true` and sourced as `timestamped_model_feature`. Packaging reads the already-built in-memory feature row and makes zero provider calls. The scorer receives the identical feature map before and after this release.

## Truthful gaps

The current production payload does not retain dated game-log rows, authentic player-versus-opponent history, routes run, weather, headshots, or a canonical home/away label for each prop decision. The member reader does not fabricate them. It labels the four available trend windows as actual model inputs and explicitly states that dated history is unavailable. Older stored snapshots remain readable and show an availability panel until the next normal writer refresh supplies the new payload.

## Acceptance

- Zero projection, probability, side, price, grade, promotion, demotion, actionability, or tracking changes.
- One existing `prediction_pipeline:nfl` leased writer; no new cron or provider call.
- Matchup selector groups exact `gameId` rows and uses neutral team/opponent wording where home/away is not available.
- Paired board never invents a missing opposite side.
- Price movement renders only when a genuine same-sportsbook opening tuple exists.
- Reader preserves URL addressing, browser history, focus return, focus trap, body scroll lock, Escape, backdrop close, centered desktop width, and full-screen mobile behavior through the shared dialog.
