# UCL licensed-stat source resilience

## Scope and cause

The owner asked to restore normal Champions League updates without a single
website blocking the whole pipeline, using the paid statistics where possible
and preserving forecast quality. The owner confirmed BALLDONTLIE subscriptions
cover only UCL and EPL. Current R22 aborts its sole normal refresh when the
required ClubElo HTML request returns 403. Production logs show the first failure
November 5 at 05:17 UTC; the last successful refresh was 22:17 UTC that day.
Existing standard cards retain exact saved member payloads and source clocks;
that continuity repair did not restore model refreshes.

R23 replaces the blocking independent strength input with licensed UCL/EPL
goals/xG. It does not remove the market reader. UCL Match Result, derived Double
Chance, Total and BTTS use the same final joint law, relative named-book market
paths and unchanged confidence/price grade rules. NBA, CBB, other sports,
settlement and historical tracking are outside this change.

## Fixed statistical method and source contract

The original pooled candidate was frozen before the additional confirmations.
One opponent-adjusted MAP fit shares club attack/defence parameters while
estimating a separate home/away scoring environment for each competition. It
retains the released 365-day half-life, four-match mode-one Gamma prior, 35% xG
blend, rho=-0.1 and UCL rest/congestion factors. Neutral venues remove both
venue intercepts symmetrically. There is no Elo, book-level score target,
postfit market/model blend, fitted forecast share, extra calibration, probability
cap or arbitrary promotion/demotion quota. The frozen prototype does not apply
the old designated-away travel penalty; travel observations remain explicitly
UCL-schedule-only context. An unseen club has the explicit limited-evidence
cohort prior, not a fabricated rating or observed sample.

The source is two previous seasons plus current-season finals for each licensed
competition. EPL data reuse the existing historical/current foundation and cache;
the EPL model is not run or changed. UCL keeps its authenticated frozen raw
historical foundation and existing current data collection. IDs are checked
against exact normalized club names across competitions. Fixture IDs are scoped
by competition, so overlapping numeric match IDs cannot collide. Conflicting
duplicates fail; identical repeats do not add likelihood; same-kickoff/future
results are excluded. Both 380-game historical EPL seasons and the complete
current EPL schedule/final cohort are required. Stats absent from an individual
valid result retain the existing goals-only interpretation, never invented xG.

The fit is bounded to 4,000 input rows, 256 clubs and 1,024 iterations at the
fixed convergence tolerance. Adjacency lists bound CPU/memory. Existing provider
pagination, concurrency, cache windows and request budgets remain in place.
There is no provider request per card/user, new cron, independent writer or
timer. No additional domestic subscription, paid AI call or web challenge bypass
is introduced. No ClubElo request occurs in the production slate path.

Actual completed input availability is recorded separately from match dates and
future kickoff. A result whose kickoff is already elapsed can only use existing
legacy display scaffolding; it cannot receive a newly backdated R23 record.
Stored fit evidence includes source hash, source counts, competition rates,
selected club attack/defence, weighted sample, prior exposure and completion
clock. The independent joint and the existing final market evidence remain
part of the canonical member/record path.

## Evaluation and limitations

All research is offline, with zero production prediction, grade, shadow or
snapshot writes. Original, rejected and final candidates/results are retained.
No parameters were changed on final confirmation outcomes. Retrospective stats
use their present provider vintage and strict earlier-fixture exclusion; they
are not represented as native historical receipt clocks or locked betting results.

The final untouched-to-this-candidate 2022 confirmation has 125 regulation-complete
matches. The comparison is with the released historical R7 statistical baseline,
not a claim of a matched full-market replay win over current R22:

| Metric | R7 | Fixed paid UCL/EPL candidate |
| --- | ---: | ---: |
| Match Result Brier (mean over three outcomes) | 0.192617 | 0.180582 |
| Match Result log loss | 0.971077 | 0.917642 |
| Winner accuracy | 64/125 | 72/125 |
| Total 2.5 Brier | 0.251270 | 0.247262 |
| Total log loss | 0.695746 | 0.687300 |
| BTTS Brier | 0.279169 | 0.264714 |
| BTTS log loss | 0.754422 | 0.723391 |
| Mean absolute team-score error | 1.102822 | 1.050838 |

Descriptive paired normal 95% intervals for Brier difference (candidate minus
baseline): MR [-0.02261,-0.00146], Total [-0.02077,0.01276], BTTS
[-0.02788,-0.00103]. They do not adjust for repeated clubs, earlier research or
multiple metrics; Total superiority is not established. BTTS's absolute Brier
remains worse than a constant 50% benchmark in this season. No guaranteed
accuracy or profitable betting claim follows from these comparisons.

Earlier results are not discarded: on 126 2025 calibration rows the candidate
has MR/Total/BTTS Brier 0.181729/0.225844/0.249737. On the already-inspected
63-row 2025 historical confirmation it has 0.183397/0.216185/0.236821, versus
R7 0.198904/0.229680/0.238448. On 122 regulation-complete 2023 matches it has
0.188870/0.247260/0.239210 versus R7 0.192158/0.242764/0.239886: Total regresses.
Nine actual R22-era matches give the candidate 7/9 winners and MR/Total/BTTS
Brier 0.152208/0.107030/0.126424; published R22 final market-read forecasts
have 7/9 and 0.141069/0.109478/0.152424. That small independent-versus-final
comparison is descriptive and cannot prove R22 noninferiority or superiority.
Exact historical execution prices and actionable records are unavailable for
the offline seasons, so locked-price units/ROI are unavailable, not zero or
synthetic. Performance must be monitored forward under the exact new release
and actual locked timestamp, separately for every market.

The extra posterior-predictive candidate is rejected, including its worse
2021 Total/BTTS scores. It is not part of R23. The production fixed fit's raw
rates and all market probabilities match all 125 frozen final forecasts exactly;
joint-law means differ from untruncated raw Poisson rates only at numerical-tail
precision. No finalist was tuned to these confirmation outcomes.

## Versions, immutability and release gates

Model `ucl_goals_coherent_2026_11_10_r23_licensed_ucl_epl_stats` and grade-era
`ucl_grade_policy_2026_11_10_r26_licensed_ucl_epl_stats` are new. R22/R25 and
older stored payloads retain exact probabilities, scores, grades, prices,
stakes, evidence and reader precedence. Legacy comparator calls keep R22/R25,
R21/R24 or R7 identities; they cannot acquire an R23 writer stamp. The original
R22 source module and its strict date checks are retained as historical tests,
not weakened into a stale live fallback. Market reader R15, score presentation
R13, member lifecycle R27 and writer R1 remain exact. Both normal refresh and
targeted T-60 jobs retain the sole `prediction_pipeline:soccer` lease and their
existing schedules. Failure preserves the last coherent published cards.

Required before merge: frozen-method parity, same-captured-odds board-impact and
all-market price/coverage review, paired existing confidence/path/price promotion
and demotion controls, actual R22 immutable writer/reader tests, full model gate,
focused UCL/member/tracking checks, type/lint/build, clean fresh-main integration,
protected PR checks and exact tested remote tree. The local full gate currently
fails because an unchanged optional CBB admission replay has a present v8 dataset
but four missing original source files, first
`/private/tmp/cbb-contextual-release-v5-frozen-raw-rows-20261105.json`. None is
fabricated, moved, hidden or skipped by this change. The same complete command
also runs in the new standard clean-runner UCL workflow; that run must pass.
The clean runner does not reproduce the unavailable external CBB data admission
replay, and a green unit run must not be described as doing so.

After merge, verify the actual deployed commit, canonical completed R23/R26
refresh, paid source coverage, all-market coherent record/reader tuple, current
prices and grade counts, unchanged historical lock hashes, then the next natural
refresh and targeted lock sweep. A branch preview or successful local fit alone
does not establish restored normal production updates. Roll back future unlocked
R23 publication on missing/mixed input contracts, unexplained board contraction,
publication/price failure, lease overlap, reader/record discrepancy or any locked
field change. Preserve every lock from either era.

Starting base `0cb70662fe674bb51097afa954f28bbaa6336f37`; fresh integrated base
before implementation `55e8457a992a3e761839943f5e59f33e18f27483`. Private raw
sources, immutable predeclarations, all candidate evaluations and replay captures
are retained under `/private/tmp/ucl-paid-stats-offline-audit-20261110` and the
corresponding `/private/tmp/ucl-*-20261110.json` reports. They are never bundled
as a live model/source fallback. Board counts and final verification follow.

## Frozen current-board comparison

The guarded read-only November 10 16:31:43 UTC audit built all 18 upcoming
fixtures from 446 regulation-complete UCL and 860 EPL results (1,306 unique
competition-scoped training rows). All current clubs have actual UCL stats/xG.
The normal licensed foundation loaded successfully while every ClubElo request
and every network mutation was explicitly refused. One Owls slate request
supplied the common current market capture; no The Odds API credit was spent.
There were no retained line-history observations for these far-future games.

For the comparison, each fixture's actual last-published R22 independent rates
were read from its saved `nativeGoalMarketRead.before` fields, not reconstructed
from a changed forecast or presented as a currently authenticated R22 input.
Those frozen rates and the new licensed-stat rates were processed through the
same captured market tuples and unchanged grade policy at one audit clock.
No incumbent locked prediction or market payload was changed. This is an
offline functional impact comparison, not forward performance evidence.

Both boards: MR 1 Lean /4 Watchlist /13 No Play; DC 18 No Play; Total 1 Lean
/17 No Play; BTTS 18 No Play. Promotions 0, demotions 0, net actionables 0.
One BTTS side changed from No (51.23%) to Yes (50.68%); both remained explicitly
held with no price. The current providers price 19/72 selected contracts and
53 remain held. This is a present source-coverage finding, not evidence that
the other 53 are complete model evaluations or that a former quote is current.
The existing publication contract permits complete predictions before all
bookmaker markets open, retaining explicit holds. Grade qualification and
adverse/cleared-path paired controls remain covered by the existing focused
UCL suite. Exact captures, records, outputs, hashes and request accounting are
retained in the private offline audit reports.
