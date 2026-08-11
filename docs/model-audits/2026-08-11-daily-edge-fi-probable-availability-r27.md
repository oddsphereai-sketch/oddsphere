# MLB Daily Edge FI probable availability — r27

Date: 2026-08-11  
Previous decision release: `mlb_daily_edge_decision_2026_08_10_r26`  
Candidate decision release: `mlb_daily_edge_decision_2026_08_11_r27`  
Candidate rule bundle: `mlb_daily_edge_rule_bundle_v26_2026_08_11`

## Scope and contract

This release affects MLB first-inning availability only. The projection core, moneyline and total
probability heads, public calibration, grade policy, prices, stakes, and all locked predictions are
unchanged. `predictionRecordService` remains the only member-facing writer, and scheduled MLB
writes remain under the sport-scoped `prediction_pipeline` lease.

MLB Stats remains authoritative for confirmed/probable starters. When MLB Stats and BDL omit a
side, the existing starter refresh may use an ESPN-published probable only after the strict active
pitcher/team mapping succeeds. The next MLB Stats refresh supersedes that fallback automatically.
The shared ESPN reader now makes one bounded retry against ESPN's equivalent official site API
host when the primary response is empty or unavailable.

FI classification now distinguishes an unknown starter from sparse history for a named probable.
With both named probables, a complete two-sided half-run market, and publishable offense context,
missing verified starter history produces an explicit non-actionable Toss-Up. A genuinely unknown
starter, missing/two-sided-invalid market, or unavailable offense context remains Held.

## Pre-change live finding

The 2026-08-11 slate contained 15 games and 45 records. Moneyline had 15/15 complete prices and
model probabilities with 10 actionable records. Totals had 15/15 complete prices and model
probabilities with 7 actionable records. First inning had 15 rows, 8 actionable records, 12 model
probabilities, and three erroneous holds:

- CHC at WSH: ESPN published Jake Irvin, but the production ESPN primary host returned an empty
  slate; complete FI market, posterior YRFI 50.59%.
- TEX at LAA: Cody Bradford and Ryan Johnson were both named; complete FI market, posterior YRFI
  56.15%, but sparse verified starter history was treated as an unknown-starter hold.
- HOU at SF: ESPN published Carson Whisenhunt, but the production ESPN primary host returned an
  empty slate; complete FI market, posterior NRFI 51.74%.

All three rows had complete displayed FI prices. The missing market-consensus/sharp fields were
not blockers because each row had a valid two-sided sportsbook market baseline.

## Paired board-impact requirement

The intended paired replay holds the same 15 games, prices, and pregame timestamp constant.
Expected availability delta before production refresh: Held -3, Toss-Up +3, directional/actionable
promotions 0, actionable demotions 0, net actionable change 0. The post-deploy live section must be
updated with the exact stored release counts before this release is declared complete.

The read-only candidate shadow against the pre-refresh database changed TEX at LAA from Held to
Toss-Up and left all other FI decisions unchanged: 8 directional, 5 Toss-Up, and 2 Held. The
authoritative starter-refresh dry run then resolved both remaining empty sides (Jake Irvin and
Carson Whisenhunt), moving starter coverage from 13/15 to a planned 15/15 with zero unresolved
candidates. Moneyline and total behavior is outside the changed code path; their 10 and 7
actionable records respectively remain the paired baseline for post-deploy comparison.

## Verification and rollback

Required before live declaration: shared ESPN service tests, FI V2 focused tests, prediction-record
tests, `npm run verify:model-change`, TypeScript/build, exact-commit deployment, authoritative
starter refresh, production prediction refresh under the shared lease, release-coherence audit,
data-health audit, and member-reader verification. Roll back to r26 if the slate mixes release IDs,
prices disappear, any unknown-starter row is mislabeled as an ordinary No Play, or the actionable
board changes outside the paired replay without an explicit reviewed explanation.
