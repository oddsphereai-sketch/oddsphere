# NBA original player-impact validation and historical reconstruction

Frozen before fitting, November21,2026. Base1c928498556b0d02b1b8a169a877114a73cacfb5;
continues draft1138/dc9b6293663a. Production R38/marriageR40/readerR4/gradeR31,
the sole prediction writer, shared NBA lease and every original lock stay exact.

## Source engineering decisions before outcomes

Use original NBA liveData boxscore/playbyplay JSON with native player/team/game
IDs, old embedded source times, event/edited timestamps, HTTP Last-Modified, raw
hashes and actual current fetchedAt. The first verified pair for0022300061 has
original October25,2023 modification times. Current advanced API responses are
validation references only; they are never assigned an old observation time.

Pilot reconstruction now reproduces all24 participating players' traditional
counts, plus/minus scoring context and rounded published PIE. Free-throw-trip
scoring and context stay with the lineup at the foul/trip start even if a player
substitutes between attempts. Team turnovers enter the on-court PIE denominator;
team rebounds do not become individual rebounds.

Genuine estimated Net is independently reproducible from the on-court counts:
estimated possessions=FGA+.44*FTA-playerOREB+playerTO+teamTO, separately for each
team. Estimated Net=100*pointsFor/offensiveEstimatedPossessions minus
100*pointsAgainst/defensiveEstimatedPossessions. The first24 values match the
NBA PlayerGameLogs E_NET_RATING to its published0.1 precision. It is distinct
from actual-possession NET_RATING. The historical boxscore/paid wrapper exposing
actual Net under an estimated field is not silently blended with true E_NET.
The new source/ledger release will identify this semantic distinction explicitly.
No model window, threshold or feature was selected from forecast outcomes.

Validate the same source-defined calculation across both selection seasons,
training and a fixed chronological sample against official game logs. Require
native-ID uniqueness, all original player/team counts, five-player lineups,
coherent minutes, scoring attribution, positive source clocks and complete final
status. Do not repair individual mismatches by inserting provider values. Every
exception remains unavailable with its exact reason. Capture scopes/budgets are
frozen in the private collection plan before bulk requests.

## Explicit historical-clock mode

Keep R1's actual-received-before-cutoff admission unchanged for live/retained
observations. Add a separately versioned research reconstruction path for original
static archives. Its eligible time is the independently verified original source
publication time; current fetchedAt and computedAt remain actual and distinct.
This is a reconstructed historical input set, never a claim that Oddsphere's
collector observed it in2023. Recompute every impact value from those admitted
original game-only inputs. A current cache, mutable advanced response, old URL
date or later-regenerated edition alone cannot supply historical feature authority.
Target-game source bodies and post-cutoff publications are filtered before any
feature/identity/rotation construction. New default/legacy semantics are not
written over old snapshots.

Use complete prior-game native NBA rosters as dated membership evidence. Carry
them only through an interval with no unresolved roster movement/contract expiry.
Do not borrow the target game's active list. Date-only transaction facts can flag
uncertain intervals; they cannot supply invented intraday publication times.
Unresolved intervals are held, not guessed. Complete submitted exact-team injury
sections distinguish listed status from not-listed-in-submitted-report eligibility.
That eligibility is not a medical claim of healthy or certainty of playing.
Missing/unsubmitted sections remain unknown. Preserve source status and uncertainty;
only verified OUT sets minutes to zero. Redistribution requires verified eligibility
and prior rotation evidence, with no invented questionable/doubtful probability.

Keep the original last10 current/prior appearance windows,240-minute/48-minute
constraints and six net/PIE/overlap paired features. Zero observed participation
can give zero estimated minutes while impact remains null; it must never become
fabricated zero impact. Any positive expected/reference contribution still needs
validated impact. Preserve original/reference/replacement allocations and evidence.

## Unchanged fitting and release gates

No real-outcome fitting before at least1,000 complete2023/2024 selection games,
300 genuine availability/roster changes, zero target/future/ambiguous inputs,
future/target mutation invariance, coherent rotations and frozen ledger/schema/
source hashes. Report coverage and all refusals by season. The reconstruction
mode is explicit in that proof, separate from original operational observations.

Chronological training stays before2023, with an earlier-trained portable baseline
or saved genuine out-of-fold predictions for residual training. No in-sample
baseline is mislabeled out-of-fold. Compare A portable baseline, B chronologically
rebuilt incumbent roster recipe and C the fixed six-feature zero-intercept alpha1000
continuous replacement. No feature subset/window/cap/threshold/hyperparameter search.
Require original>=0.10 team-score MAE gain, season/week uncertainty, per-season
Spread/Total direction/probability, exact-price full-grader replay and promotion/
demotion/board counts.2025 is already-opened replication, never fresh confirmation.
Opened November results cannot select or refit a rule. Save new forward predictions
before their outcomes; current-model production promotion still requires that proof,
balanced actionable behavior, full checks, a fresh-base protected PR and live
release/cron/lease/coverage/reader/lock verification. No forced plays or blanket flip.

## November 22 source-engineering addendum, before fitting

No forecast outcomes were fitted or used to choose a rule. The original source
gate remains 1,000 complete selection games / 300 genuine positive-rotation or
OUT changes. Original R1 first-observation admission is unchanged. Intermediate
private normalization/ledger attempts remain preserved; the current explicit
source/ledger versions are native impact R2 and archival rotation R3.

Game-wide discard was too broad: a singular bench player's ratio or individual
scoring-context disagreement must not erase unrelated, independently validated
players. Preserve player-specific issues and taint overlapping players whenever
an original count disagreement can affect their impact denominator. Keep all
three-point count discrepancies as diagnostics; those fields do not enter the
declared estimated-possession/PIE equations. A structural unresolved lineup still
holds the game. Do not insert modern provider values to repair any metric.

The NBA's published zero-denominator convention produces zero, including when
the PIE numerator is nonzero. The expanded fixed validation cohort exposes that
case (for example native game0022100004). Record the convention explicitly; it
is arithmetic over observed counts, never zero imputation for missing stats.
Carry a silent prior-quarter survivor only when substitution constraints leave
one possible complete lineup, with native minutes/counts/scoring verification.
Nonplaying editorial review/timeout annotations cannot run the game clock back.

Use the conservative maximum of HTTP/meta/event-edit clocks, retaining current
retrieval/computation times. A later edition stays unavailable before its own
clock; a future edit clock cannot pass. Dormant players with observed zero recent
participation keep null impact and zero allocation. Every positive baseline or
reference contribution still requires the same validated original impact, and
the appearance windows, features, allocation, fitting and release bars stay exact.

## November 23 source scope and baseline declaration, still before fitting

All6,385 frozen native regular-season games now have original box/PBP bodies.
Native impact R4 retains both physical scoring counters and the fixed foul-trip
context used in the impact equations. LiveData's separate derived plus/minus
aggregate is never inserted into a feature or used to choose a metric. Preserve
its disagreement as a diagnostic. Complete original PBP identities, unambiguous
five-player stints, exact individual primitive counts, game scores, stint-minute
bounds and original publication clocks remain the feature authority. Current NBA
advanced responses are independent validation references, never historical inputs.
Unresolved lineup/clock/primitive-count errors remain unavailable, with count
disagreement propagated to every overlapping player's denominator.

Archival ledger R5 retains complete reference rotations, including departed
players, so its shocks can be replayed from stored allocations. Injury-name joins
may use only exact aliases explicitly attached to the same native ID in original
prior boxes published before the target cutoff. Preserve the alias-source receipt.
A uniquely identified nonmember explicitly listed OUT is preserved as an excluded
zero-allocation fact; unknown identities and eligible nonmembers still hold the
team. No current name/roster or target-game participation supplies an alias.

The shipped portable R15 artifact reports training seasons2021–2025 (6,152 rows).
It cannot be used as an out-of-sample baseline for2022–2025. Earlier-trained fixed
ridge heads must be rebuilt with training-only imputation/scaling:2021 for2022
residual training,2021–2022 for the fixed2023/2024 selection comparison. The final
current composition against the through2025 production head requires a separately
frozen prospective comparison; no opened2026 outcome may refit the correction.
The2025 incumbent roster artifact is likewise never applied backward and called
an historical incumbent. No actual forecast-outcome fitting has occurred.

Before fitting, archival estimator R6 makes missing measurement handling explicit:
role minutes/participation use every source-confirmed appearance in the fixed
last10-current/last10-prior windows. Impact is the minutes-weighted estimate over
individually validated measurements inside those same windows. Never insert zero
for an unavailable metric, expand the window, or read a later/target observation.
Persist window/observed appearances and minutes plus each unavailable game ID.
Zero validated impact exposure still holds any positive-contribution profile.
This estimates a player's prior from observed evidence rather than pretending
an unavailable old game erased the other observations. The1,000-selection/
300-change gates and all numerical accuracy/uncertainty/board/forward bars stay
unchanged; no performance result selected this missing-data estimator.

Archival R7 copies only the three declared receipt fields into the ledger. The
R6 replay otherwise retained complete game/player objects through structurally
typed receipt references, exhausting its768MB offline heap during final hashing.
R7 preserves the R6 allocation/impact estimator and original evidence hashes and
clocks; no result fitting occurred. A shape regression rejects source graphs in
receipt envelopes. The failed R6 logs remain preserved.

The earlier baseline heads use the unchanged75-column shipped recipe and ridge
alpha1000, with training-only medians/missing indicators/scales and an unpenalized
intercept. An explicit research-only original-T60 feature entry point uses verified
native original box counts and their actual original publication bounds. It does
not use current BDL historical revisions or the runtime's assumed five-hour result
availability. R13's runtime feature entry point and exact outputs stay unchanged.
Native game/team IDs avoid a fuzzy cross-provider game join. The fixed earlier
heads are historical recipe comparisons, not replays of the current through2025
production coefficients. Training finals must be available before the next fold.

Report unconditioned team/margin/total MAE and bias, season totals, weekly paired
loss differences and a fixed deterministic1,000-draw week-block bootstrap95%CI.
A Total/Spread direction or ROI result requires a separately evidenced market line;
score-error gains are never relabeled as wager accuracy. Current incumbent B,
actual exact-price full-grader/actionable board replay and fresh prospective proof
remain mandatory for live promotion regardless of these historical A/C results.

## Fixed C1 completed; two-way C2 predeclaration

The first fit passed source gates but failed its >=0.10 team-MAE improvement
requirement: selection gain0.000263, week-block95%CI[-0.012461,0.012357]. Total
MAE worsened15.097664→15.111717; margin MAE10.900124→10.887210. Keep C1 inactive.
There was no live NBA model/grade change and no forced promotion.

Combined net strength cannot identify whether a rotation affects scoring or
prevents it. C2 preserves C1's exact role/minute/OUT/eligibility allocations and
fixed last10-current/last10-prior appearance windows, but estimates the original
on-court offensive and defensive ratings separately. The original source equations
already calculate both rates; expose them only under a NEW two-way source release,
leaving R4 output exact. Validate against published E_OFF/E_DEF as independent
current references only. No provider value becomes an historical feature.

Use exactly six features: home-minus-away/offense, home-plus-away/offense,
home-minus-away/defense, home-plus-away/defense, and the same overlap difference/
sum. Expected-minus-reference minute-weighted shocks stay continuous; alpha1000,
zero intercept, no feature/window/hyperparameter/activation search. Train only
2022 residuals against the frozen2021 head; use the exact frozen2021–22 baseline
for comparison.2023/24 are now explicitly reused development comparisons, not
fresh untouched confirmation;2025 and opened2026 remain replication. All earlier
source, MAE, uncertainty, probability/direction, exact-price board-balance and
fresh prospective/live-release gates remain mandatory. No new paid collection,
production import, writer, grading threshold, locked correction or blanket flip.

## November23 completed validation and early forward freeze

The original source gate is now satisfied:1,880 complete selection games and
1,858 genuine changes, with976 complete2022 training games.14,165 referenced raw
documents match their saved receipts.52 stratified real-source target/future
poison replays preserve their complete snapshot hashes. Actual current retrieval
clocks remain distinct from original source publication. Zero paid calls or
production/database/history writes were added by this phase.

C2 also fails the predeclared improvement bar. Reused2023/24 development team-MAE
gain is0.005910, week-block95%CI[-0.004281,0.015973]; margin MAE10.900124→10.872425,
Total MAE15.097664→15.100390.2025 opened replication team gain0.020619 does not
rescue this failure. Both C1/C2 stay held. Their exact frozen heads are retained;
no coefficient/threshold is tweaked from these opened results and neither is
eligible for production. There are zero live promotions/demotions/stake changes.

Private evidence lives in the ignored archive
`ops-local/learning-lab/nba-player-impact-validation-20261121`. The selected R7
ledger hash is ec5869e18426f66ff2c65c350a68985b1ccb7d029d4352fb74b7190369e6712f;
C1 head63d96f87b36478d0de203c319c8478f6862c91bd4c51f43bc63420c8db909f61.
C2 ledger15af38b3e54443cb96b5e5e0279c100bc27aec5c4c74ca012aa0e784c8a6a346;
C2 headbec4a3c71a5e9d53047532a3cc1d462b3b315d7b83c7deb33e42150843d0fbce.
Keep failed/OOM/intermediate logs append-only. The large two-way ledger uses
compressed JSONL and ordered verified snapshot hashes, avoiding a single giant
JSON string; no such archive is loaded by the live site.

At14:15UTC all30 actual R38 records for today's10 games were retained privately,
including their exact original snapshots/lines/prices. All were still unlocked.
A separate early research forecast was generated14:17UTC from original sources
available by then, with seven complete two-way comparisons and three explicit
medical-report holds (OKC–IND, CLE–CHI, UTA–LAL). Normal live forecasts remain
available for all10. These are early forecasts, NOT observed T60 locks, not
live plays, and cannot be blended with later locked performance. The already-
failed C2 head remains explicitly ineligible even if this small slate wins.

The rolling NBA scoreboard still described November22. Reject it as today's
inventory; the season-addressed official NBA schedule corroborates all10 Monday
fixtures by native IDs, oriented teams and exact UTC tip against the live census.
The generic/regional static schedule files were unavailable; the primary Stats
season endpoint worked.13 weekend finals, the current linked official injury PDF,
current date-only movement feed and dated schedule are retained. Conservative
cumulative public request count14,633 stays within15,000; no extra paid requests.
The current portable artifact's actual repository commit onOctober20 provides
only a conservative training-completed upper bound for the early comparison;
its artifact identifier and coefficients remain unchanged. Native reconstructed
features are not presented as an exact replay of saved current provider inputs.

At13:45UTC the ordinary NBA refresh republished all10 games/30 records; source
coherence passed. Its partial consumer fallback warning preserves unmatched
scopes rather than erasing other available quotes. No source-capacity or missing-
game condition was found. CFB rollover PR1139/production736c4ee4 remains verified
live separately; this draft does not change that repair.
