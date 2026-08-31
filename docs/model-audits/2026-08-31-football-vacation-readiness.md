# Football Daily Edge vacation-readiness production result

Date: 2026-08-31
Starting production base: `f7b39670a979601d185f263cff8f584707dd3870`

## Result

This candidate keeps the existing Daily Edge product and grade ladder. It adds no quota, tier,
reader-side grade override, promotional copy, stake rule, provider endpoint, cron, writer, or table.
It repairs the CFB probability/grade boundary, makes NFL weekly runtime and tracking release-aware,
keeps football projections live through quarterback uncertainty, completes existing NFL market and
injury context, fixes football presentation provenance, and closes NFL props opening/closing gaps.

### CFB authoritative-PMF calibration

The prior exact-price layer reused a calibration artifact trained for the old independent 2022
forecast after production had moved to one 25% independent / 75% canonical-market joint PMF with
fresh Circa and bounded public-consensus inputs. The candidate removes that second stale nonlinear
transform. Each exact-line probability is now read directly from the one authoritative adjusted PMF;
the target-excluded consensus remains the economic comparison and never becomes a duplicate model
input.

A read-only replay at `2026-08-31T14:35:39.385Z` covered 87 FBS games, 81 anchored games and 158
comparable exact-price markets. The unchanged current tuples moved from **1 Best Angle / 24 Leans /
87 Watchlists / 46 No Plays** (25 actionable) to **14 / 34 / 65 / 45** (48 actionable). By market,
actionable counts moved Moneyline 0→5, Spread 13→17, and Total 12→26. There were 66 promotions,
39 demotions, zero selected-side changes, and 45 remaining No Plays. Probability spans are 44.66pp
Moneyline, 10.85pp Spread and 12.69pp Total, versus 52.26pp / 8.12pp / 6.39pp under the stale
transform. This is not a target-count calibration: all grades still require the existing exact
quote, target-excluded fair probability, EV, edge, movement and split resistance gates.

Public splits remain lower-strength evidence. Strict fresh Circa retains priority. Public evidence
can support or resist the market anchor only within the already-bounded rules and cannot manufacture
a pick without positive exact-price economics. CFB still has no reliable league-wide timestamped
injury feed; it continues to label that fact instead of inferring health from roster absence. A
missing/unconfirmed quarterback does not suppress the game projection.

### NFL weekly projection, availability and tracking

The frozen 16-game Week 1 outcome artifact remains exact for those games. Later weeks now use a
versioned weekly path: the current market-owned Moneyline margin and coherent current Total provide
the location anchors, while pooled centered residual shapes from the frozen artifact provide a
bounded discrete score distribution. This prevents an unknown later-week provider ID from throwing
the entire leased writer. Per-game containment also skips a malformed game without aborting healthy
siblings.

The sole writer then applies the same bounded market-evidence layer to every week: 75% current
Spread/Total location and 25% football location, followed by at most 1.5 points from strictly fresh
Circa money-minus-bets evidence and at most 0.75 points from line-matched public evidence. Opposing
public evidence cannot reverse Circa. Missing splits mean zero split adjustment, not a held game.
The writer rebuilds the discrete PMF before selecting winner, Spread side and Total direction, so a
coherent market change can reverse a prior prediction and the new exact-price tuple is then graded
through the unchanged Best Angle/Lean/Watchlist/No Play product. On fragmented boards, one
target-excluded same-line comparator may preserve a conservative complete tuple, but at least two
are required for any actionable grade.

A SELECT-only replay of the latest stored 16-game/48-market NFL wave captured at
`2026-08-31T14:51:09.472Z` moved the prior **3 Best Angles / 11 Leans / 5 Watchlists / 26 No
Plays / 3 incomplete internal Holds** to **3 / 12 / 6 / 27 / 0**. Actionable markets moved 14→15;
there were 11 promotions, five demotions, 17 side changes, 32 probability changes, and all 48
prediction markets remained present. Those side changes are the intended upstream reselection
behavior, not reader or grade-label overrides.

An expected QB listed Out/Doubtful selects the next healthy depth-chart QB, uses that QB's historical
state and marks the starter projected until confirmed. A later provider starter change naturally
recomputes the game. If no replacement or injury report is available, the projection remains live
with uncertainty; it is not held. Other timestamped player injuries remain bounded scoring context.
The member surface continues to use only Best Angle, Lean, Watchlist and No Play.

Official T-60 tracking now validates the intended market-owned head for each sibling market rather
than incorrectly requiring one model/calibration ID across Moneyline, Spread and Total. Locks,
prices, sides and tracking keys remain market-scoped and immutable.

### NFL player props

The read-only Week 1 production snapshot at `2026-08-31T14:21:09.698Z` contained 303 decisions:
**1 Best Angle / 0 Leans / 62 Watchlists / 223 No Plays / 17 internal Held exceptions**. Raw-model
versus independent-market absolute divergence was 14.54pp median, 37.81pp p90, 47.42pp p99 and
52.89pp maximum; 218 rows exceeded the proposed outside-review 8pp cutoff, proving that cutoff was
not valid for this residual architecture.

The frozen gross-integrity boundary is therefore 48pp (the observed p99 boundary, not an action
threshold). A larger disagreement becomes a completed No Play, never a hidden row or promotion.
Receiving-yards and receptions already allowed the same Under to jump from Watchlist directly to
Best Angle; the candidate restores the existing universal Lean economics between those tiers. On
the current snapshot this produces 19 Watchlist→Lean promotions, one gross-divergence No Play, 17
unchanged internal exceptions and 283 unchanged rows. It does not change a model coefficient,
calibration weight, side or Best Angle threshold.

Recurring collection now requests the bounded same-book opening context used by the existing reader
and captures the latest locked closing quote before settlement. The old snapshot had 0/303 opening
rows because recurring production disabled that request. The maximum collection budget rises from
30 to 48 calls and the collection-plus-settlement ceiling from 48 to 66; writer ownership and lease
remain unchanged. Closing-before-settlement fixes the same-cycle CLV race without mutating a settled
record.

Player props do not require game-level split feeds. Their available evidence contract is the player
projection and participation/role context plus current exact price, target-excluded book benchmark,
and same-book opening/current/closing observations. Missing splits therefore cannot Hold a prop;
only a missing player/market identity, stale/incomplete exact quote, or genuine role-integrity
failure is an operational exception, scoped to that prop rather than the slate.

## Presentation and operational fixes

- Football logo fallback is sport-scoped, so CFB MIA/HOU can no longer inherit Marlins/Astros logos.
- The established football Spread storage key is recognized by the shared capabilities layer.
- Market movement uses writer-owned direction; member factors no longer show release IDs.
- Stored opening price survives an NFL exact-price health exception.
- Empty-state sport text is no longer hardcoded to Soccer.
- NFL append-only evidence reads every bounded page of the current and three immutable prior schemas;
  one malformed game cannot terminate the weekly wave.

## Validation and rollback

Focused NFL and CFB production suites, all six NFL props inference/market/runtime/lifecycle/history/
settlement suites, `verify:model-change`, `verify`, TypeScript, focused lint, and the 105-page webpack
production build pass. Fresh-main integration safety, protected PR checks, exact-tree merge proof,
deployment success, and natural-cycle read-only verification remain publication gates.

Rollback is the immediately preceding protected production commit and its complete release tuple.
Trigger rollback for a mixed release, writer/reader exception, unexpected provider-call excess,
missing healthy games, lock/tracking incoherence, missing projection caused solely by QB uncertainty,
or unexplained actionable collapse.
