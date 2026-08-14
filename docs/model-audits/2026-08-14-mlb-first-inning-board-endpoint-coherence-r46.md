# MLB r46 first-inning board endpoint coherence

Date: 2026-08-14

Decision release: `mlb_daily_edge_decision_2026_08_14_r46`

Rule bundle: `mlb_daily_edge_rule_bundle_v45_2026_08_14`

Grade policy: `mlb_public_grade_policy_v36_first_inning_board_endpoint_coherence_2026_08_14`

## Live verification finding

The r45 rendered guard required both exact price endpoints and exact canonical
line-number fields. First-inning Market Read can omit those redundant line
fields while `fiMarketBoard` independently verifies the required 0.5-run
NRFI/YRFI market. MIL-LAD therefore still rejected the canonical direction even
though its selected-side prices exactly matched the visible Bally Bet trail.

## Change

For a directional NRFI/YRFI pick with a verified two-sided FI board, exact
selected-side first/current price equality is sufficient to consume the
canonical direction. Other markets continue to require both price and point-
line equality. Missing boards, Toss-Ups, and mismatched endpoints fail closed.

## Impact and validation

This is presentation-only: zero promotions, zero demotions, and no changes to
odds, prediction inputs, sides, probabilities, projections, grades, stakes,
writers, crons, leases, or movement thresholds. Validation includes the
rendered-experience suite, full model-change suite, production build, live
release coherence, data health, and live MIL-LAD/KC-LAA reader inspection.

Rollback is r45; historical locked rows remain immutable.
