# NFL relative market innovations, November 1

## Problem and scope

The r102 live reader substituted the current paired sportsbook score coordinate
for the statistical coordinate after an accepted movement. This could remove a
substantial independent edge even for a small actual movement, concentrating
probabilities near the price and flattening grades. The initial 13-game/39-market
same-input private comparison had 26 No Plays. Simply changing the No Play label
or lowering numerical grade thresholds would not repair that forecast defect.

This candidate changes NFL ML, Spread and Total final-law construction and the
qualified Total grade gate, under the existing forward writer and
`prediction_pipeline:nfl` lease. It adds no writer, recurring shadow, provider
request, timer, stake policy or member copy. Starting base:
`27bd94d5b39cfa0617bc5caaec06bcdf5887bf5f`. New production base PR911 changes only
Kalshi display files, disjoint from this patch; its exact merge is preserved.

## Final law and evidence

An explicitly market-free statistical distribution receives actual same-book
paired ML log-odds innovations and Spread/Total number-plus-juice economic
innovations. One physical source owns the joint ML/Spread constraints; another
may independently identify Total. Qualified moves can strengthen, weaken or
reverse the winner; their full magnitude is applied once, with no fixed small
nudge, sportsbook-level replacement, market/model average or source-count vote.
Pure vig and exact number/juice compensation leave the corresponding law intact.
Incompatible joint constraints preserve that axis without cancelling another
valid axis. Repeated refreshes rebuild from the original independent law.

Earlier checksum-verified capture **current** quotes extend actual same-book
history across SharpAPI/Owl providers, preserving canonical event, actual provider,
nullable original upstream ID and original per-market source clock. Compact opening
landmarks do not retain separate provider identity, so they are not relabeled.
Raw Owl observations still require their real upstream event identity. Conflicting
IDs within a provider, conflicting simultaneous pairs, bad holds, wrong games,
future/post-start quotes and stale current endpoints cannot identify an episode.
Unknown overlap with statistical news is explicit; a fetch time never becomes an
invented knowledge boundary.

The existing complete evidence ledger still interprets source/retail flow,
concentration, resistance, key numbers, buybacks, availability and current levels.
Qualified flow with an actual subsequent same-book economic change can identify a
reacting source against an older opposed episode. That observation order is not
proof of causation or bookmaker intent. The actual post-flow pairs are re-read
with the same economic transport, not the raw number-first categorical direction.
Flow percentages cannot invent extra score points or force their own side; price
movement against flow can prevail. Held prices, one post-flow observation or a
late flow report do not invent a reaction. Unresolved opposing named episodes
remain explicit rather than additive votes.

## Grading and immutable locks

The final qualified joint Total law may pass the existing grade evaluator even
when an obsolete market-direction field is absent. Probability, EV, edge, cushion,
price, exact-line comparator, freshness and target-exclusion gates are unchanged.
A weak/negative-EV or insufficiently corroborated Total cannot earn promotion.
Unresolved adverse named-price conflict can temper Best Angle to actionable Lean;
already-incorporated adverse moves and static favorite disagreement cannot.
New T-60 grades receive the same posture before their first persistence. Existing
locks always win, even if a caller incorrectly marks them as new.

All nine prepublication T-60 IDs/hashes are retained at
`/private/tmp/nfl-r103-prepublish-locks.json`. r58/r66/r51/r54 legacy member snapshots
retain their exact payload, score, side, probabilities, grade, quote, stake and
evidence. No lock is delayed or revised to fit this release.

## Same-input board report and reasoning checks

The final live no-write comparison at approximately 17:14 UTC covers the five
remaining open games, **15 markets**. Earlier games were already locked and are
not counted as the candidate era. All 15 market contracts pass; zero game holds,
coherence findings or unstable target tuples. Local Playbook uses original-time
stored fallback observations because that local credential is absent.

| Grade | Incumbent r51 | Candidate r52 |
| --- | ---: | ---: |
| Best Angle | 2 | 7 |
| Lean | 1 | 1 |
| Watchlist | 4 | 3 |
| No Play | 8 | 4 |

Five actionable promotions, zero actionable demotions; the conflict posture makes
zero additional changes on this live sample. Functional promotion/demotion tests
separately show three actionables stay three while two unresolved Best Angles
become Leans, paired with a legitimate strong Total Watchlist-to-Best-Angle rule.
This report describes behavior, not established predictive improvement.

- PHI–WSH: full retained chronology overturns the small independent PHI winner;
  final WSH win probability is approximately 53.3%, correctly No Play at its steep
  price. PHI plus the handicap can separately qualify as Best Angle. A projected
  WSH win and PHI cover are coherent, not a contradictory forced winner switch.
- KC–DEN: named paired moves strengthen DEN relative to the independent law;
  ML/Spread/Total use one final score around KC17.57–DEN21.42. Static prices are
  retained without replacing that distribution. Three correlated calls are not
  three independent proofs of accuracy.
- LAC–LAR: unresolved opposing named margin episodes preserve the independent
  margin; the separately supported Total changes to approximately47.76 and its
  existing numerical gates permit an Over45.5 Best Angle. ML remains Lean and
  Spread Watchlist; one conflicted axis cannot suppress another supported market.
- NE–MIA and CHI–SEA: an unaffordable ML can remain No Play while a qualified
  Total earns Best Angle and Spread remains Watchlist. Winner certainty and bet
  value are distinct; no automatic promotion of every favorite is introduced.

Artifacts: `/private/tmp/nfl-r103-final-board.json` (same-input incumbent comparison,
source receipts, final grades), `/private/tmp/nfl-r103-continuity-board.json`
(retained-history reasoning), and the lock checksum baseline above.

## Verification, publication and rollback

Required before publication: full `npm run verify:model-change`, focused NFL
production suite including new transport/continuity/controller/posture scenarios,
TypeScript, production build, latest-main integration safety, protected up-to-date
PR and matching remote/local tree. After merge: verify production deployment,
leased sole writer, r52 unlocked payloads, r59 member reader, exact saved locks,
health and grade counts. The pre-existing source assertions are updated to allow
only one statistical baseline grade call and require final publication from the
stabilized semantic tuple, not a bypass of target exclusion.

Rollback only through a fresh protected PR to prior r102 runtime for future
unlocked rows, retaining both release eras and every existing lock. No accuracy
guarantee, universal scenario completeness or historically validated win rate is
claimed. Forward outcomes must be evaluated by release and actual locked time.
