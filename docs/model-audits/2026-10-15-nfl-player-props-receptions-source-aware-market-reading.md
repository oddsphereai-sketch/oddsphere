# NFL Player Props receptions source-aware market reading

## Scope

This audit evaluates whether target-book-excluded reference prices can improve the existing NFL
Player Props production model without replacing its independent player, role, matchup, team,
opponent, quarterback, availability, and weather inputs. The candidate changes only Receptions.
Passing Attempts, Passing Completions, Passing Yards, Receiving Yards, Rushing Attempts, Rushing
Yards, and Anytime TD retain their exact incumbent behavior because their tested source-aware
candidates did not qualify.

The member surface, copy, labels, one-main-line presentation, writer lease, cadence, settlement,
and stake policy are unchanged. Existing locked records remain byte-for-byte authoritative.

## Defects found

1. Pinnacle and NoVig reference rows existed but were research-only.
2. SharpAPI can identify the Over and Under sides of one player with different provider player IDs
   and slightly different provider observation timestamps. Strict production pairing therefore
   collapsed valid same-fetch pairs to incomplete offers.
3. The writer timestamp was captured before the provider request. Same-cycle reference rows whose
   provider timestamp followed the writer start by seconds were rejected as future observations.
4. Exact-line-only comparison ignored useful independent sharp evidence offered at a nearby line.

The repair pairs reference sides only when normalized player, game, book, market, line, and exact
local fetch cycle agree. It uses the older side timestamp, never combines fetch cycles, and retains
the existing lock cutoff. The evaluation boundary may advance only through a collection timestamp
or a provider timestamp within the existing 60-second clock-skew allowance. Cross-line reference
probabilities are transported to the evaluated line through the market's frozen empirical residual
distribution. The evaluated sportsbook is always excluded.

## Exact current-model replay

The replay reruns the current production model at T-60 using immutable forward evidence, official
box outcomes, and cached historical paired prices. Weeks 1-2 are the earlier selection segment and
Weeks 3-5 are later confirmation. The historical source set is FanDuel, NoVig, and ProphetX; the
current slate also proves live Pinnacle and NoVig coverage. Ten games are unavailable because their
historical game identity does not match the retained forward-evidence identity, so no result is
fabricated for them.

Across 745 player/market scopes and 69 games, the receptions-only candidate changes 12 sides with
nine corrections and three harms. Overall direction moves 389-356 (52.21%) to 395-350 (53.02%),
Brier 0.27427 to 0.27235, and projection MAE 20.12472 to 20.11683. All non-Receptions markets are
identical.

For Receptions alone, 60 scopes move from 33-27 (55.0%) to 39-21 (65.0%). Brier improves 0.26090
to 0.23708 and projection MAE improves 1.72277 to 1.62483. The 13 newly actionable Receptions rows
finish 10-3 (+2.6975 units). Weeks 1-2 and Weeks 3-5 both improve in aggregate. Week 5 direction
regresses by one result, so the evidence is an improvement, not a promise of future performance.

## Current slate rehearsal

The zero-write Week 6 rehearsal receives 1,711 reference observations. It constructs 506 complete
NoVig pairs and 269 complete Pinnacle pairs before grade-eligible and freshness filtering. Across
1,169 matched member rows, only Receptions changes: 208 projections, eight forecast sides, four
actionable promotions, and three demotions. Actionables move 24 to 25, so the board does not flatten.
Every other market has zero projection, side, promotion, or demotion changes.

## Publication and rollback gates

Publication requires an explicit owner activation instruction, new runtime/model/calibration/
decision/board/member/lifecycle/writer/tracking/reference-store releases, focused pairing/runtime/
writer/lock tests, `npm run verify:model-change`, latest-main integration safety, protected PR
checks, and live proof of the complete release tuple and nonempty Pinnacle/NoVig reference coverage.

Rollback future unlocked computation to the October 9 independent Receiving Yards release if the
reference cache empties despite fresh provider rows, a target book contaminates its own benchmark,
another market changes, board coverage collapses, release identifiers mix, or any locked payload is
mutated. Captured research and all existing locked records remain preserved.
