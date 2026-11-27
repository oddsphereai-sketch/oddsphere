# NBA expected-rotation replacement: implementation contract

Base: 1c928498556b0d02b1b8a169a877114a73cacfb5. Research only, November20.
Implements the next data/feature stage declared in PR874's October29 player-state
ledger contract. It does not revive the failed Spread tree or activate Total R2.
No production import, forecast, grade, threshold, stake, writer or timer changes.

Freeze before implementation: require evidence received, published and effective
by T-60, immutable receipt identifiers/hashes and native-ID crosswalks (no name
joins). Filter future/target-game stats before feature construction. A legacy
season cache's existence never establishes original availability. Incomplete
roster, identity, availability, final-stat or player-impact coverage is unknown.

Use the last10 available team games for reference membership and participation;
use last10 played games for conditional minutes, minute-weighted estimated net
and PIE, with up to10 previous-season appearances as fixed shrinkage. No market
or target-game participants, starters, minutes, result, usage or DNP is accepted.
Expected minutes are participation times conditional minutes, normalized to240
with48/player maximum. Only verified OUT becomes zero. Freed minutes go only
to explicitly available players; questionable/probable players retain their
baseline, with no invented return probability. Fail if240 cannot be allocated.
Keep original and replacement allocations and all selected evidence receipts.

Compute minute-weighted net/PIE shock versus the same-cutoff prior rotation and
rotation overlap loss, then exactly six paired home-minus-away/home-plus-away
features. No-shock same roster/status inputs must have exact zero shock.

No fitting before zero future/target/ambiguous identities, cutoff mutation
invariance, all complete teams240minutes, frozen schema/ledger hashes, >=1000
complete2023-24 selection games and >=300 genuinely verified availability or
roster changes. Implement the gate, never a bypass. Reuse the original fixed
zero-intercept alpha1000 experiment only after all gates pass. Opened November
outcomes cannot choose features/windows/thresholds. Current forward forecasts
may be saved privately before outcomes; no retrospective missing wins or prices.

Acceptance remains the original independent A/B/C chronological comparison,
>=0.10 team-score MAE improvement, season/week-block uncertainty, per-season
Total/Spread probability and direction, exact-price full-grader replay and
paired promotion/demotion counts. Require new forward locked confirmation.
