# MLB r45 rendered first-inning Market Read coherence

Date: 2026-08-14

Decision release: `mlb_daily_edge_decision_2026_08_14_r45`

Rule bundle: `mlb_daily_edge_rule_bundle_v44_2026_08_14`

Grade policy: `mlb_public_grade_policy_v35_first_inning_rendered_market_read_coherence_2026_08_14`

## Live verification finding

R44 correctly aligned the canonical first-inning Market Read to the visible
selected-side board. The live MIL-LAD reader then exposed a second presentation
path: the redesigned pulse independently treated implied-probability movement
below 1.25 points as flat. That produced contradictory copy for the verified
Bally Bet NRFI trail from -118 to -113: the canonical read said Slight Market
Resistance while the local presentation sentence said effectively flat.

## Change

When the canonical Market Read's first/current prices and line numbers exactly
match the rendered same-book trail, the pulse consumes that canonical support
or resistance direction. It retains its local fail-closed behavior when the
trail is missing or endpoints do not match. No authoritative movement
threshold, prediction input, side, probability, projection, grade, stake,
writer, cron, or lease changes.

## Board impact and rollback

Paired board impact is zero promotions and zero demotions. Only contradictory
rendered movement copy changes. Rollback is r44; all historical locked rows
remain immutable.

## Validation

- Daily Edge experience coherence suite
- Daily Edge API and Edge Stack focused suites
- `npm run verify:model-change`
- TypeScript and production build
- Live release, cron, data-health, and rendered MIL-LAD/KC-LAA verification
