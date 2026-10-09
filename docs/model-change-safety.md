# Model change safety protocol

## Owner-approved provisional exception: NFL professional market authority r29

On 2026-10-09 Daniel Mengel explicitly directed Oddsphere to replace the NFL
Daily Edge market reader with a professional, sport-specific implementation,
allow qualified market evidence to move or flip the projected score, avoid a
shadow-only delay, preserve useful board coverage, and publish the correction
after a complete audit. This exception is limited to the release family and
evidence documented in
`docs/model-audits/2026-10-09-nfl-professional-market-authority-r29-predeclaration.md`
and its paired result.

R29 keeps the paid independent score as the starting opinion and adds one
target-family-excluded authority shared by audit and production. It distinguishes
number movement, no-vig price movement, hold, chronology, persistence, reversal,
buyback, source class, split provenance and freshness, resistance, and NFL key
numbers. A Spread override requires aligned number and price movement plus
qualifying aligned flow. A Moneyline winner change additionally requires the
separately qualified Spread to agree. A Total override requires either two
stable aligned named-book number moves or five stable aligned retail moves with
zero opposition and target-excluded selected/all-book confirmation. One rebuilt
joint distribution owns the final score, all three sides, probabilities, and
grades. Unknown handle, ticket count, bet size, limits, origin, and suspension
lifecycle remain explicitly unavailable rather than inferred.

The owner-directed audit necessarily opened the 65 Weeks 1-5 locks and the 18
paid-score locks during development, so this is not an untouched holdout and no
future hit rate is promised. Against each lock's own historical release, the
final leakage-safe candidate changes one Moneyline, two Spreads, and four Totals:
seven corrections and zero harms. Moneyline moves 38-27 to 39-26, Spread
36-27-2 to 38-25-2, and Total 32-32-1 to 36-28-1; team, margin, and Total MAE
move 7.5999/10.0970/10.9755 to 7.5096/9.9467/10.8666. On the exact r28
comparison, the actionable board moves 23 to 24 through one promotion, zero
demotions, and one Total side correction with zero harms. The zero-write current
rehearsal retains 18 actionables across all 42 evaluations. Existing locked
snapshots retain their exact stored payload and release identity.

Publication still requires focused tests, full model-change verification,
current-main integration safety, protected PR checks, and post-deploy proof of
the live release, sole writer/lease, provider coverage, board counts, snapshot,
reader, and lock coherence. Roll back the complete r29 family to r28 for future
unlocked computations on any mixed release, target-exclusion failure, board
collapse, lock mutation, writer overlap, or reader mismatch.

## Owner-approved correctness exception: NHL pregame coverage gate r10

On 2026-10-08 Daniel Mengel directed Oddsphere to fix the NHL future price-
mapping path without altering the already locked game. Post-deploy verification
proved that SharpAPI had withdrawn six pregame spread/Total scopes from four
already-live, fully locked games, and the slate-wide completeness gate was
therefore withholding the repaired snapshot for two later games. This exception
is limited to the operational release and evidence documented in
`docs/model-audits/2026-10-08-nhl-pregame-coverage-gate-r10.md`.

R10 requires complete pregame market coverage for every scheduled or unknown-
state game and for any non-pregame game without a complete three-market lock,
exactly as before. It does not request or validate newly withdrawn pregame
scopes for games explicitly live, final, canceled, or postponed only after all
three official markets are locked. Their stored lock remains authoritative.
This changes no model, probability, projection, prediction side, selected
price, grade, stake, lock, tracking rule,
member copy, label, or layout. Publication requires the focused NHL suite, full
model-change verification, current-main integration safety, protected PR checks,
and post-deploy route/release/coverage/snapshot/lock verification.

## Owner-approved correctness exception: NHL exact-quote price mapping r16

On 2026-10-08 Daniel Mengel explicitly directed Oddsphere to preserve the
already locked NHL game and repair future NHL price mapping so the defect cannot
recur. This exception is limited to the release family and evidence documented
in `docs/model-audits/2026-10-08-nhl-exact-quote-price-mapping-r16.md`.

R16 does not tune a forecast, probability, side, grade, threshold, stake, or
market-reading coefficient. It replaces separate writer and reader price
selection with one exact market/side/line selector, freezes the complete chosen
quote tuple for future locks, and requires the reader to honor that frozen tuple
after lock. Existing locked payloads remain immutable. A legacy lock may recover
a sportsbook only when its own frozen snapshot contains one unique exact match;
an ambiguous missing book is never fabricated. The zero-write current-board
replay preserves 24 locked rows and changes none of the six unlocked sides,
scores, probabilities, grades, promotions, demotions, or actionable counts.
Publication still requires the focused NHL suite, full model-change verification,
current-main integration safety, protected PR checks, and post-deploy release,
writer, lease, coverage, reader, and lock verification.

## Owner-approved correctness exception: CFB paid FCS odds-gap fallback r38

On 2026-10-08 Daniel Mengel explicitly approved a lock-preserving production repair that uses the
paid The Odds API feed for current live and future CFB games while leaving completed games and valid
immutable tracking results untouched. This exception is limited to the release family and evidence
documented in `docs/model-audits/2026-10-08-cfb-the-odds-api-fcs-gap-fallback-r38.md`.

R38 adds one bounded FCS-only named-book fallback after BALLDONTLIE, SharpAPI and CFBD. Exact event
orientation, team identity, kickoff proximity, two-sided price/line coherence and provider timestamp
checks are mandatory. A lower-priority quote fills only an absent named book and never replaces the
same book from a higher-priority provider. The current slate receives a one-time historical snapshot
recovery; those rows are retained internally as first-observed context rather than mislabeled as a
provider opening. Subsequent current pulls are hourly only while an upcoming FCS price gap exists,
with a hard weekly request ceiling and protected credit reserve. No copy, label, layout, stake,
independent-score equation, market-reading rule, writer, lease, lock definition or tracking
denominator changes.

The exact zero-write October 8 replay moves current paired Moneyline / Spread / Total coverage from
59 / 58 / 57 of 88 games to 85 / 84 / 84 of 86 upcoming games. Within the 31-game FCS-only cohort,
coverage moves from 2 / 1 / 0 to 30 / 29 / 29. Montana–Northern Arizona remains honestly unavailable.
Actionables remain 91 with zero promotions and zero demotions because target-excluded comparison
requirements remain unchanged. Valid r37 and r36 locks remain authoritative during the release
transition; unlocked games alone advance to r38. Publication still requires focused tests, the full
CFB production suite, full model-change verification, current-main integration safety, protected PR
checks and post-deploy writer/lease/release/coverage/reader/lock/tracking verification.

## Owner-approved correctness exception: CFB release-wave completeness r37

On 2026-10-07 Daniel Mengel explicitly directed Oddsphere to use all valid paid odds, reject isolated
off-market representative prices, preserve correct price movement, and get the repaired CFB board
live without changing copy or labels. This exception is limited to the publication-count correction
documented in `docs/model-audits/2026-10-07-cfb-release-wave-completeness-r37.md`.

R37 does not change a prediction, probability, projection, side, price, grade, stake, provider
hierarchy, market-reader rule, request budget, schedule, lock, tracking definition, copy, label or
layout. It prevents a completed lifecycle-only game from inflating the expected size of a new
evidence wave. Existing current-release membership remains sticky across partial refreshes and a
newly planned game is added once, so genuine capture failures still fail closed. The paid Sharp/CFBD
context captured by r36 can therefore reach the member snapshot while exchange-only quotes remain
target-excluded. Same-book opening/prior/current continuity and representative-price outlier guards
remain unchanged. Publication still requires focused tests, full model verification, current-main
integration safety, protected PR checks, and post-deploy release/reader/lock/tracking verification.

## Owner-approved provisional exception: NFL settlement-aligned Rushing Attempts r1

On 2026-10-07 Daniel Mengel explicitly authorized productionizing only the
validated settlement-aligned Rushing Attempts head from the coordinated NFL
Player Props projection-accuracy research. This exception is limited to the
release family and evidence documented in
`docs/model-audits/2026-10-07-nfl-player-props-projection-accuracy-predeclaration.md`
and its paired result. The rejected Rushing Yards, Receiving Yards, Passing
Attempts, Passing Completions, Passing Yards, and Receptions candidates must
not be revived by this release.

The released Rushing Attempts head is a frozen 25% incumbent / 75% model fit
only on historical player-games with official participation, matching the
population that can settle as a wager. Historical participation is a target
population filter, never a current-game feature. Its empirical residual
distribution is refit on the same candidate's out-of-sample 2023-2024 errors.
Every other point head, threshold, grade rule, market arbitration, exact-price
rule, alternate-line policy, target-book exclusion, stake, writer, provider
budget, cadence, lock, settlement rule, copy, label, and layout is unchanged.

The 2025 holdout improves MAE 3.13553→3.05408, RMSE 4.37183→4.14461,
bias -0.90974→-0.22787, CRPS 2.23959→2.16308, and NLL 2.68314→2.64071;
all four chronological MAE segments improve and the game-clustered 95% MAE
delta interval is [-0.12807, -0.03601]. On the release-pure 720-row Week 4
board, only Rushing Attempts changes: direction improves 38/62→41/62, with
zero promotions and one demotion of a settled losing Lean. Across all resolved
ordinary scopes, direction improves 162/291→165/291 and units improve
+0.196→+1.196. This is historical evidence, not a guaranteed future result.

Publication still requires focused tests, full model-change verification, a
clean latest-main protected PR, integration safety, and post-merge live
release/writer/lease/coverage/reader checks. Existing locks retain their exact
stored legacy payload and release tuple. Roll back the complete new release
family and the Rushing Attempts shard together; never recompute or relabel a
locked row.

## Owner-approved correctness exception: NHL complete-market ingestion and NFL exact-quote labels

On 2026-10-07 Daniel Mengel directed Oddsphere to repair confirmed live odds/price
mapping gaps immediately, specifically including Eagles–Jaguars, while preserving
the existing product surface and completing the all-sport data-health audit. This
exception is limited to the NHL r15 ingestion family and the NFL r38/r30 reader
publication documented in
`docs/model-audits/2026-10-07-nhl-complete-multibook-market-ingestion-r15.md`
and `docs/model-audits/2026-10-07-nfl-exact-quote-label-coherence-r38.md`.

NHL r15 replaces the incomplete generic event page with three bounded exact-event,
full-game market scopes: Moneyline, puck line, and Total. A two-way hold check
rejects regulation/three-way or malformed pairs mislabeled as full-game markets.
The exact October 7 replay restores 18–19 coherent books and 112–118 canonical rows
per game while preserving all three scores, nine prediction sides, nine grades,
and five actionables. Promotions: zero; demotions: zero. It does not add a writer,
schedule, lease, database loop, member copy, label, layout, stake, grade rule, or
model coefficient. Prior locked releases remain immutable.

NFL r38/r30 derives the displayed Spread or Total label from the same evaluated
sportsbook line that owns its displayed price. The current 15-game / 45-market
replay repairs nine mismatched labels, including JAX -7 to BetMGM JAX -7.5 at
-105, and produces zero unmatched book/line/price tuples. Scores, sides,
probabilities, prices, grades, and the 18-actionable board are unchanged;
promotions and demotions are both zero. The decision/model releases and sole
writer remain unchanged. No copy, label taxonomy, layout, provider call, schedule,
lease, stake, lock, or tracking rule changes.

Publication still requires focused tests, full model-change verification, a clean
latest-main protected PR, integration safety, and live release/coverage/reader
proof. Hold or roll back on a mixed release, missing current game/market, malformed
two-way pair, unmatched displayed tuple, board-count drift, writer overlap, lock
failure, or reader failure; never rewrite an existing immutable lock.

## Owner-approved correctness exception: WNBA current-quote reader coherence r1

On 2026-10-07 Daniel Mengel directed Oddsphere to continue the full live-model
health audit, repair any confirmed market-reading defect, preserve the existing
member product, and avoid new copy, labels, score changes, or board flattening.
This exception is limited to the WNBA reader release documented in
`docs/model-audits/2026-10-07-wnba-current-quote-market-read-coherence.md`.

The writer's released score, side, probability, evaluated price, grade, stake,
lock, and tracking tuple remain authoritative and unchanged. For unlocked
cards, the movement panel and market read now end at the reader's current
same-book quote while the evaluated price remains separately available for
grade economics. Locked cards continue to use the immutable lock quote. The
current grade-policy reader uses the writer's released outcome confidence for
the recommendation-strength display instead of applying a second reader-only
cap against a different target-excluded denominator. The cross-sport audit also
recognizes that a selected WNBA spread moving from -2.5 to -1.5 supports that
selected side.

The exact two-game production-input replay preserves all six sides, scores,
probabilities, grades, and prices used for grading. Promotions: zero;
demotions: zero; actionable count: four to four. The same deep audit moves from
eight critical findings to zero. No provider call, writer, schedule, database
write, model coefficient, copy, label, or layout changes.

## Owner-approved provisional exception: NBA independent-first regular-season r1

On 2026-10-06 Daniel Mengel explicitly directed Oddsphere to prepare the NBA regular-season model with
a strong sport-specific independent projection, coherent downstream market interpretation, exact-price
grades and reliable locking, without changing member copy, labels or layout. This exception is limited
to the r1 bundle documented in
`docs/model-audits/2026-10-06-nba-independent-first-regular-season-r1.md`.

R1 fixes the wrong October season identity, regular games running playoff context, contaminated
early-season counts, signed-spread cover inversion, cross-book/cross-line no-vig construction, and NBA's
missing bounded T-60 refresh/coherence gate. The independent score is no longer continuously averaged
toward the market. Exact-line market evidence may select Spread/Total direction and price economics, but
no market score correction or split-only flip is active without chronological confirmation. Moneyline
and Total remain official; Spread retains its existing context-only surface. Missing exact-price evidence
cannot create an actionable grade, and any T-60 incoherence defers lock rather than freezing a bad tuple.

The owner acknowledges that the 1,230-game 2025-26 confirmation result validates the prior-only
independent architecture rather than every current runtime feature, and that the empty October 6
regular-season board provides no current-slate hit-rate estimate. Zero current games means zero
promotions, demotions, or actionable-count change; this cannot be used to flatten the October 20 board.
Publication still requires focused tests, full model-change verification, current-main integration
safety, protected PR checks, and deployed runtime/cron/lock verification. Prior locks remain immutable.

This is the required release checklist for any change that can affect predictions, model
inputs, probabilities, projections, grades, promotions/demotions, calibration, prices used,
or stakes. It exists to prevent mixed model eras, competing writers, accidental board
flattening, and load spikes.

## Owner-approved provisional exception: NFL cross-market winner coherence r28

On 2026-10-05 Daniel Mengel explicitly directed Oddsphere to repair the sport-specific market
reader across every Daily Edge model without blindly following the market, flattening boards, or
changing member copy, labels, or layout. This exception is limited to the NFL r28 release and the
release-pure forward evidence documented in
`docs/model-audits/2026-10-05-nfl-cross-market-winner-coherence-r28-predeclaration.md` and its paired
result.

R28 leaves the paid independent score primary. Spread evidence may continue to correct the Spread
and rebuild the joint score, but it may cross zero and replace the Moneyline winner only when
Moneyline-specific same-book price movement and a source-qualified Moneyline money-minus-ticket gap
corroborate that winner, with named sharp opposition retaining a veto. Missing evidence cannot
authorize a winner flip. Total behavior is unchanged. One joint distribution remains authoritative
for expected score, representative score, Moneyline, Spread, Total, probabilities, and downstream
exact-price grades.

The owner acknowledges that the 14-game r27 forward cohort is small and does not guarantee future
performance. The exact 42-market replay improves Moneyline from 8-6 to 10-4, Spread excluding two
pushes from 6-6 to 9-3, team-score MAE from 5.6509 to 5.5307, and margin MAE from 7.5731 to 5.7677.
Total remains 9-5 and its side, probability, grade, projected Total, and MAE remain unchanged. The
candidate has zero actionable promotions, zero demotions, and identical grade/actionable counts, so
it does not flatten the board. It adds no provider call, database loop, writer, schedule, stake,
copy, label, or layout. Publication still requires focused and full model-change tests,
current-main integration safety, protected PR checks, and live release/coverage/coherence
verification. Prior locks remain immutable.

## Owner-approved provisional exception: MLB corroborated Total opposition r90

On 2026-10-05 Daniel Mengel explicitly directed Oddsphere to repair sport-specific
market reading across every Daily Edge model without blindly following the
market, flattening boards, or changing member copy, labels, or layout. This
exception is limited to the MLB r90 release and the opened retrospective
evidence documented in
`docs/model-audits/2026-10-05-mlb-corroborated-total-opposition-predeclaration.md`
and its paired result.

R90 leaves the independent MLB model primary. A future unlocked full-game Total
may select the priced opposite side only when independent confidence is at most
57.5%, the target-excluded two-sided no-vig price favors the opposite side, a
continuous same-sportsbook price trail moves materially against the pick, and
either an opposing money-versus-ticket pattern or the MLB-owned internal sharp
resistance independently corroborates it. Missing evidence is neutral; books
cannot be crossed; no Moneyline, first-inning, player-prop, or other-sport rule
is changed. The score Total is retained when already coherent with the
corrected side and otherwise reflected across the listed line while preserving
the independent team margin. One score, side, probability, quote, and grade
must remain coherent.

The owner acknowledges that the 58-row archive is opened retrospective
evidence, not an untouched holdout or a guaranteed future hit rate. The fixed
selector improved direction from 20-38 to 38-20 and improved Total MAE in each
of four chronological segments. It adds no provider call, writer, schedule,
database loop, copy, label, or layout. The correction cannot promote a Best
Angle and remains subject to ordinary exact-price and grade gates. The October
5 current-board replay has zero qualifying rows and therefore zero same-input
side, promotion, demotion, or actionable-count changes. Publication still
requires focused and full model-change tests, current-main integration safety,
protected PR checks, and live release/coverage/coherence verification. Prior
locks remain immutable.

## Owner-approved emergency exception: CFB verified-QB and same-book continuity r16

On 2026-10-02 Daniel Mengel reported that Delaware quarterback Nick Minicucci
was expected to miss the Liberty game and explicitly directed Oddsphere to
account for the injury immediately, update when a later designation is
announced, keep injuries from silently disappearing, and publish the repair
without new member copy or labels. This exception is limited to the r16 release
family and the outcome-blind evidence in
`docs/model-audits/2026-10-02-cfb-verified-qb-market-continuity-r16.md`.

R16 leaves the independent score artifact, PMF equations, probability
calibration, prices, stakes, schedules, sole writer, and
`prediction_pipeline:cfb` lease unchanged. Source-attributed likely-out
evidence may select an active-roster replacement in the existing expected-QB
field. A later exact-team Playbook Out, Doubtful, or Questionable designation
supersedes that report; the last verified exact-game provider designation is
retained through a later omission. An explicit Active, Available, Healthy, or
Cleared designation restores the named quarterback and removes the grade cap;
Questionable restores the named quarterback while retaining the unresolved
availability cap. The existing writer adds one league-scoped
injury read per collection; successful responses use the shared cache, while a
failed response cannot erase retained evidence or the board. Availability
updates select only from the already captured active roster and may not infer
healthy from a missing response or manufacture a player.

Because the frozen score artifact does not have a validated starter-level
substitution response, a source-attributed expected-QB replacement caps an
unlocked Best Angle or Lean at Watchlist. It does not erase or flip the score,
side, probability, exact price, game, market, lock, or tracking denominator.
Market movement must compare the operational opening with a current quote from
the same sportsbook; execution price shopping remains separate. The stored
board replay pairs nine promotions with fifteen demotions, moves actionables
44 to 40, and the live-provider candidate remains non-flat with 17 Best Angles
and 72 Leans. Publication still requires focused and full model-change tests,
latest-main integration safety, protected PR checks, and live writer/reader,
coverage, expected-QB, price, split, lock, and tracking verification. Prior
locks remain immutable.

## Owner-approved provisional exception: NHL roster-aware discrete market read r12

On 2026-09-30 Daniel Mengel explicitly directed Oddsphere to replace the
opening-season NHL model's stale roster assumptions, make the independent
forecast and market reader operate as one coherent product, publish the repair
without a shadow delay, and retain it for every future game without changing
member copy, labels, or layout. This exception is limited to the r12 release
family and the frozen evidence in
`docs/model-audits/2026-09-30-nhl-roster-market-arbitration-r12.md`.

R12 removes the generic continuous 20% Moneyline market anchor. During each
team's first ten regular-season games, the independent margin may consume a
frozen, target-excluded current-roster skater prior. Current-roster identity is
loaded once per slate through the existing BALLDONTLIE integration and cached;
it does not add a writer, schedule, or per-game request loop. Default prior-
season goalie history is eligible only for a goalie verified on the current
roster. If no current goalie can be verified, goalie context is neutral rather
than silently assigned to a departed player. After the opening window, current-
season team evidence automatically resumes the released scoring path.

Market evidence remains downstream of the independent model. It cannot average
every score toward consensus. For current and future slates, a Moneyline side
may flip only when the independent and market sides conflict, at least two
complete books support a 54% side, a continuous same-book price trail moves at
least one percentage point toward that side, and complete money and ticket
evidence with medium/high source agreement also supports that side. An
authorized flip solves the goal margin from the final target probability while
preserving the independent Total, then rebuilds one Poisson score distribution;
Moneyline, Total, and puck-line predictions remain coherent. Missing or
uncorroborated evidence leaves the independent side unchanged. Split-only and
popularity-only flips remain prohibited.

The chronological official-score tournament warms up on 2022, trains on 2023,
selects on 2024, and reports once on untouched 2025. The selected independent
margin improved untouched winner accuracy from 54.89% to 56.26%, Brier from
0.24530 to 0.24411, team-score MAE from 1.3719 to 1.3665, margin MAE from
2.1251 to 2.1109, Total MAE from 1.8448 to 1.8383, and puck-line direction from
67.48% to 67.63%. Total direction moved from 53.68% to 53.29%, a 0.38-point
tradeoff reviewed against the stronger score-error and winner metrics.
First-30-day winner accuracy improved from 54.38% to 56.22%. These are
historical estimates, not a guaranteed future hit rate.

The paired September 30 production-path replay retains all three games and all
nine markets. It makes one Moneyline side correction (NYI to TOR), promotes PIT
Under and LAK Under from Watchlist to Lean, demotes TOR Moneyline from the old
NYI Lean to Watchlist and NYI +1.5 from Best Angle to Watchlist, and preserves
five actionables overall (two promotions, two demotions). Publication still
requires focused tests, full model-change verification, latest-main integration
safety, protected-PR checks, and live current-release writer/reader, coverage,
price, split, lock, and tracking proof. Hold or roll back unlocked r12 output on
roster coverage failure, mixed releases, missing games or markets, score/side
incoherence, unexpected board collapse, writer overlap, lock failure, or reader
failure. Locked r10/r9/r7 tuples remain immutable and tracking-eligible.

## Owner-approved emergency exception: NHL overnight slate readiness r6

On 2026-09-30 Daniel Mengel reported that the NHL board showed no games and
directed Oddsphere to restore it. Production evidence showed three official
regular-season games available from the NHL schedule provider, zero September
30 game or prediction rows, and a correctly empty member snapshot. The sole
NHL daily seed was scheduled for 13:45 UTC, almost three hours after the report.

The r6 operational repair moves the existing single bounded daily refresh to
07:45 UTC (03:45 EDT / 02:45 EST). It does not add a second provider cycle, writer, schedule instance,
or lease; change any model coefficient, probability, score, side, grade,
threshold, stake, copy, label, or layout; or rewrite any lock. The r10 T-60
refresh remains the authoritative final market-read and lock path. The manual
recovery run proved the existing leased route could seed all three games, write
nine r10 markets, preserve complete two-sided prices, and publish the member
snapshot with no errors. Paired model/board impact for identical captured input
is zero side changes, promotions, demotions, or actionable-count changes.

Publication requires the focused schedule and NHL suites, full model-change
verification, production build, latest-main integration safety, protected PR,
and post-deploy schedule/release verification. Roll back only the cron time and
r6 operational stamp if the earlier run creates provider errors or load growth;
never rewrite already locked evidence.

## Owner-approved emergency exception: NHL T-60 market refresh r10

On 2026-09-29 Daniel Mengel explicitly directed Oddsphere to make the new NHL
independent/market-reading model durable, update it through the day, preserve
logical decimal score/pick coherence, and lock and track the correct final card
without changing member copy, labels, or layout. Live verification after r9
deployment proved that the generic T-60 sweep froze the earlier r7 daily tuple
without rerunning the NHL writer. This exception is limited to the r10 lifecycle
repair documented in
`docs/model-audits/2026-09-29-nhl-t60-market-refresh-r10.md`.

R10 changes no independent coefficient, probability calibration, market weight,
same-book movement equation, grade rule, stake, or displayed product surface.
Within the existing sport-scoped `prediction_pipeline` lease, the existing
pregame sweep refreshes only the NHL game entering T-60, persists the latest
complete public-split fallback, reruns the sole NHL prediction writer, verifies
one coherent three-market current-release tuple, and only then applies the
authoritative lock and reader snapshot. Superseded unlocked transition tuples
may be retired after the complete current tuple is safely written; locked rows
remain immutable. A model, write, cleanup, or coherence failure defers the lock
for the next minute rather than freezing mixed releases.

The reviewed paired board impact is zero side changes, promotions, demotions, or
actionable-count changes because the score and grade equations are unchanged.
The targeted odds refresh uses the existing bounded event-catalog and exact-event
request path only for entering games instead of rescanning the whole slate. Publication
still requires focused tests, full model-change verification, latest-main
integration safety, protected PR checks, and live next-slate writer/reader proof.

## Owner-approved provisional exception: NHL source-aware market trust r9

On 2026-09-29 Daniel Mengel explicitly directed Oddsphere to research which NHL
market movements deserve trust because not every move is equal, preserve a
strong independent model, and make market reading intelligent rather than a
uniform nudge. This exception is limited to the r9 release family and evidence
in `docs/model-audits/2026-09-29-nhl-source-aware-market-trust-r9.md`.

The r8 independent score, opponent-adjusted Total, bounded 20% no-vig Moneyline
sanity input, exact-price decisions, and named same-book movement remain
authoritative. Public Playbook and legacy SharpAPI money/ticket observations
remain source-separated, silently carried forward, and visible through the
unchanged member product, but no longer alter the projected score. They are
multi-book/public consensus, not proof of named sharp-book steam or RLM.
Circa, Pinnacle, then Bookmaker retain priority for a continuous same-book
opening/current trail. A fallback book may be used only when it has its own
complete same-book trail; books are never crossed to fabricate movement.

The owner acknowledges that the 589-game current-era split archive and its
147-game final chronological window are opened diagnostic evidence, not a
guarantee of future results. On that confirmation window, the price-sanity path
without the public-split nudge was 56.46% on Moneylines versus 54.42% with the
nudge. Public split direction was unstable across development, tuning, and
confirmation. For Totals the learned conditional candidate worsened direction,
and the prior split nudge changed no confirmation direction. No broad split-
only flip or learned market model is authorized.

R9 changes no independent coefficient, price weight, same-book movement
equation, grade threshold, stake, provider call, cadence, writer, lease, member
copy, label, or layout. The current-board replay must retain every game and all
three markets, remain actionable, and report all promotions, demotions, and
side changes. Locked r7 tuples remain immutable and tracking-eligible; no r8
tuple was published to production. Publication still requires focused tests,
full model-change verification, latest-main integration safety, protected PR
checks, and live writer/reader proof. Hold or roll back unlocked r9 output on
coverage loss, board collapse, mixed releases, score/side incoherence, missing
prices, writer overlap, lock failure, or reader failure.

## Owner-approved provisional exception: NHL validated market-read r8

On 2026-09-29 Daniel Mengel explicitly directed Oddsphere to complete a deeper
professional NHL architecture review, prioritize real projection and prediction
accuracy, preserve one coherent final score, correctly marry the independent
model to market reading, and publish the strongest validated model without
adding member copy or labels. He also directed that the board remain actionable
rather than being cosmetically flattened. This exception is limited to the r8
release family and evidence in
`docs/model-audits/2026-09-29-nhl-professional-architecture-market-marriage-r8.md`.

The frozen r7 independent score, opponent-adjusted Total, and validated 20%
Moneyline market sanity layer remain authoritative. The proposed learned market
marriage is explicitly rejected: after the official shootout-deciding scores
were restored, it made 132 side changes on untouched 2025 and worsened ten more
games than it corrected. No rejected score or market-arbitration candidate may
replace the released path. Provider-separated split provenance and agreement
confidence are retained in the internal snapshot for forward evaluation; they
do not change member copy, labels, or the score equations in this release.

The owner acknowledges that a 60% future hit rate is a goal rather than a
guarantee. The five-game transition replay retains all 15 markets and 10
actionables; the one unlocked puck-line demotion has no quota replacement.
Moneyline and Total retain their tested symmetric promotion paths. Puck-line
Best Angle now requires the only exact-price edge band that was profitable in
both 2024 selection and untouched 2025 confirmation (at least 5%). Missing
selected-side prices cannot create an actionable grade. Unvalidated goalie-pool
inputs, retrospective starter identity, and every rejected score/tail model
remain ineligible.

No stake, provider call, schedule, lease, member copy, label, or layout changes
are authorized. The sole writer and reader must accept locked r7 tuples during
the bounded r8 transition so existing valid locks remain immutable and tracked.
Publication still requires focused tests, full model-change verification,
latest-main integration safety, protected PR checks, and live writer/reader
proof. Hold or roll back unlocked r8 output on mixed releases, coverage loss,
unexpected board collapse, missing prices, coherence failure, writer overlap,
lock failure, or reader failure.

## Owner-approved emergency exception: WNBA score / prediction coherence v1.5

On 2026-09-29 Daniel Mengel explicitly directed that WNBA projected scores and
predictions be made logically coherent, prioritized prediction accuracy, and
previously authorized one accuracy-driven actionable demotion when a promotion
was not available. This exception is limited to
`wnba_v1_5_coherent_expected_margin` and the evidence in
`docs/model-audits/2026-09-29-wnba-score-prediction-coherence.md`.

The release may replace the final sign-tilted margin distribution with the
coherent normal distribution centered on the already released expected margin.
It must preserve Total identity, exact target exclusion, the sole writer, shared
lease, immutable locks, schedules, provider calls, stakes, and all member copy,
labels, and layout. The stored release-era replay must show zero score/side
contradictions and must not worsen expected-margin MAE, winner direction, or
Spread direction versus the rejected median alternative. The current-board
impact is expressly bounded to one Lean demotion, zero promotions, no lost game
or market, and no new suppressive threshold. The existing symmetric exact-price
promotion paths remain covered and active. This exception does not authorize a
similar unpaired demotion in any other release or sport.

## Owner-approved emergency exception: NFL Week 4 joint-Moneyline coherence

On 2026-09-29 Daniel Mengel explicitly directed Oddsphere to restore the missing NFL weekly board
immediately, preserve prediction accuracy and the new market-reading model, make the new release
the durable forward default, and add no member copy, labels, or product-surface changes. This
exception is limited to the r24 joint-Moneyline coherence family recorded in
`docs/current-model-releases.md` and the evidence report
`docs/model-audits/2026-09-29-nfl-week-four-rollover-joint-moneyline-coherence.md`.

The r23 score distribution, Moneyline winner, Spread, Total, market-reading inputs, prices, and
thresholds remain unchanged. The exact-price Moneyline evaluation must consume the winner
probability from that same final joint PMF; an older aligned-r6 probability may no longer replace
it after the final score distribution is frozen. Target-excluded book selection and other-book
fair consensus remain downstream economic inputs. This exception authorizes the resulting
Moneyline grade recalculation but no stake, score-model, market-reading, provider-call, cadence,
writer, schedule, copy, label, or layout change.

Production requires all 16 Week 4 games and all 48 markets, zero score/side or event-containment
contradictions, the reviewed non-flat 25-actionable board, focused and full model-change tests,
latest-main integration safety, protected-PR checks, the existing `prediction_pipeline:nfl`
lease, append-only evidence, immutable prior locks, and live reader/writer proof. Hold or roll back
unlocked r24 evidence on mixed releases, incomplete coverage, coherence failure, unexpected board
collapse, writer overlap, or reader failure; never rewrite a valid locked tuple.

## Owner-approved emergency exception: NFL Week 4 player-props injury-feed continuity

On 2026-09-29 Daniel Mengel explicitly directed Oddsphere to restore the missing Week 4 NFL
player-props board immediately, preserve the newly released full-family model, make the repair the
durable forward behavior, and add no member copy, labels, or layout changes. This exception is
limited to the September 29 `injury_feed_continuity` release family recorded in
`docs/current-model-releases.md` and
`docs/model-audits/2026-09-29-nfl-player-props-injury-feed-continuity.md`.

The shared context must continue to prefer the newest verified injury payload for the exact same
provider game, including last-known exact-game evidence when a later provider cycle omits it. When
no injury payload has ever been returned for a future game, that absence is an internal health
finding rather than permission to erase an otherwise complete slate. The sole writer may score
only players present in current exact prop offers and the current roster/depth context, using the
existing official current-season state, matchup/weather features, target-book exclusion, posterior,
price, grade, and lock rules. A subsequent verified injury payload silently takes precedence, and
listed-out/inactive players retain the existing hard hold. Missing roster/depth, main-market, game
identity, or forward evidence remains a game exclusion.

The reviewed zero-write Week 4 replay must retain all 16 games, remain within the existing provider
ceiling, create no new provider call, and publish a nonempty, non-flat member board. This exception
does not authorize a model-equation, calibration surface, threshold, stake, provider cadence,
schedule, writer, lease, member copy, label, or layout change. Releases advance because input
eligibility changes, while the September 29 portable full-family artifact remains immutable
checksum provenance. Publication still requires focused tests, model-change verification,
latest-main integration safety, protected-PR checks, the existing `prediction_pipeline:nfl` lease,
and live Week 4 reader/writer proof. Hold or roll back the unlocked continuity release on a mixed
release, zero/partial slate, provider-budget growth, lock rewrite, reader failure, or writer overlap.

## Owner-approved emergency exception: NFL exact-game T-60 injury continuity

On 2026-09-28 Daniel Mengel explicitly directed Oddsphere to repair and lock the PHI-CHI card
before kickoff after the scheduled T-60 capture received a provider quote 4.178 seconds newer
than the cron invocation and an empty injury response, then published zero decisions. This
exception is limited to provider game `1392263`. The zero-decision row is
not an immutable valid lock and may not be used for tracking, but it remains immutable. Because
production enforces one T-60 row per game, the correction is published only into the recoverable
member snapshot and append-only official tracking rows. It must reuse only the most recent verified
injury report for this exact provider game, must retain
the original provider timestamp and provenance, and must recompute all three exact-price decisions
from the already-captured T-60 market and authoritative joint score distribution. It may be
applied only before kickoff and only while the original T-60 lag remains within the released
20-minute boundary. The repaired row must preserve coherent PHI Moneyline, PHI Spread and Under
directions if and only if those directions follow the captured distribution and exact prices.

No evidence row or valid T-60 tuple may be changed. The permanent writer remains append-only,
preserves a previously verified locked member card when its underlying evidence row is the audited
zero-decision failure, and may carry the last verified injury payload only within the exact same
provider game when a later provider response is empty. Its evidence timestamp must also advance to
the newest consumed provider-quote timestamp so fresh evidence cannot falsely postdate its own
decision. It adds no provider call, schedule, writer,
lease, member copy, label, layout, stake, threshold, score-model equation or market input. Older
valid T-60 rows remain immutable and retain their existing presentation. Newly captured evidence
may expose the authoritative expected score means rounded to one decimal instead of the integer
representative score; winner, Spread and Total must still derive from the same joint distribution.
Publication requires focused NFL tests, model-change verification, current-main integration safety,
protected-PR checks, live release proof, exactly three locked markets, and no duplicate tracking rows.

## Owner-approved provisional exception: NFL complete market-reading marriage r23

On 2026-09-28 Daniel Mengel explicitly directed Oddsphere to activate the reviewed complete NFL
market-reading marriage without a forward-shadow delay after the release-pure current-season
replay showed improvement over r22. This exception is limited to the r23 release family recorded
in `docs/current-model-releases.md`. It does not authorize member copy or labels, layout changes,
stakes, provider-call growth, another writer or schedule, retroactive lock changes, result leakage,
or a reusable relaxation for another model.

The owner acknowledges that the 47 settled Weeks 1-3 games are opened chronological evidence,
not a pristine future holdout or a guaranteed future win rate. The r22 paid independent team-score
center remains the authoritative starting point. Verified chronological same-book line movement
may perform a real and reversible Spread or Total direction correction by rebuilding the joint
score distribution from that independent base; the correction is not a capped cosmetic nudge and
must never compound across refreshes. Circa is the preferred named split source, another named
sharp-book split may substitute, and Playbook multi-book money/ticket data is the lower-trust
fallback. Missing evidence is unavailable, never neutral or fabricated. Split agreement,
disagreement and reverse-line behavior remain source-separated internal context; the reviewed
replay does not authorize a split-only direction flip.

The exact-price reliability comparison must select the representative quote before the forecast
side, probability and score are frozen. Grade calibration runs strictly downstream and cannot
change the selected quote, prediction, probability distribution or displayed score. Every final
Moneyline, Spread and Total side must agree with the same joint score distribution. The reviewed
board must retain at least 80% of the r22 actionables, contain tested promotions and demotions,
retain both Total flip directions, and contain no nonpositive-EV actionable.

The existing `prediction_pipeline:nfl` lease, sole writer, bounded provider cadence, append-only
evidence, target exclusion, immutable T-60 records, failure-preserving member snapshot and
zero-stake policy remain unchanged. Locked or started games keep their exact preceding release;
r23 applies only to newly generated unlocked/T-60 evidence. Hold or roll back the complete r23
family if any game or market disappears, a score/side contradiction appears, the action board
falls below the reviewed boundary, a writer or lease overlaps, an older release overwrites r23,
or the live reader cannot prove the expected release transition.

## Owner-approved provisional exception: NFL paid team-score activation r22

On 2026-09-28 Daniel Mengel explicitly rejected a forward-shadow waiting period and directed
Oddsphere to activate the already-captured BALLDONTLIE weekly team-score projection after a
release-pure Weeks 1-3 comparison showed that it materially outperformed the active independent
NFL signal. This exception is limited to the reviewed r22 architecture and does not authorize
stakes, quotas, member copy or labels, another writer or schedule, result leakage, retroactive
lock changes, or a reusable relaxation for another model.

The owner acknowledges that the 47 settled games are an opened chronological diagnostic rather
than a pristine future holdout. The direct opponent-D/ST `points_allowed` projection becomes the
target-free weekly team-score center when a complete pregame provider snapshot exists. The
existing football model remains the bounded last-known-good fallback. The active score may be
adjusted only through the established strictly same-book opening/current Spread direction and
the existing bounded, fresh, correctly matched Circa/public margin evidence. Total line/price
movement and Total splits remain observable evidence but receive zero score-mean weight because
the exact replay showed that Total movement worsened results. Exact sportsbook price continues
to affect only the line-specific probability, edge, expected value, and grade.

The exact 47-game comparison must retain the direct score's improvement over the preceding
independent signal in winner, Spread and Total direction and all three score-error measures.
The current-board replay must preserve all games and markets, report every promotion, demotion,
side change and actionable-count change, and prove that winner, Spread, Total, expected score,
representative score and probability all derive from one coherent final distribution. The
existing `prediction_pipeline:nfl` lease, sole writer, bounded slate-level projection request,
append-only evidence, target exclusion, immutable T-60 records, failure-preserving member
snapshot, and zero-stake policy remain unchanged. Locked or started games retain their exact
preceding release; the new release applies only to newly generated unlocked/T-60 evidence.

Hold or roll back the complete release family if the paid projection is not pregame-complete,
the fallback cannot build a coherent game, the board loses price coverage, the model creates a
score/side contradiction, actionables collapse without balanced replacements, a writer or lease
overlaps, or the live reader does not prove the expected release transition.

## Owner-approved provisional exception: NFL current-season raw signal r20

On 2026-09-25 Daniel Mengel explicitly directed Oddsphere to repair and improve
the NFL raw prediction signals rather than change thresholds, hide selections,
or flatten the board. This narrow exception authorizes the reviewed release
`nfl_weekly_raw_signal_2026_09_25_r2_current_season_possession` after its exact
release-pure Weeks 1-2 replay and current Week 3 board replay pass. It does not
authorize stakes, quotas, member copy or labels, a second writer, a new schedule,
or a reusable relaxation for another model.

The owner acknowledges that the 32-game Weeks 1-2 set is already opened and is
therefore diagnostic rather than a pristine holdout. Week 1 remains the immutable
released artifact. Beginning with Week 2, the sole writer may blend the selected
current-season possession/efficiency margin 10% with the current target-excluded
market margin 90%. The independent input is limited to final prior-week points,
plays, sacks, turnovers, and red-zone conversion captured in the existing bounded
current-season state. No current-week result may enter its forecast. The existing
price-neutral Total core remains authoritative; only valid same-book
opening-to-current movement outside the evaluated Total family may shift its mean. Money/ticket splits remain internal
evidence but may not directly rewrite the raw Total mean.

The diagnostic must improve Spread and Total direction without worsening
Moneyline, improve all three reported score-error measures, retain all 48 Week 3
markets, preserve every immutable T-60 game, and avoid a net actionable-board
collapse. All affected releases must advance together. The existing
`prediction_pipeline:nfl` lease, append-only evidence, target exclusion, price and
freshness gates, writer cadence, provider-call budget, and zero-stake policy remain
unchanged. Production must be evaluated prospectively by exact release and lock
timestamp. A mixed release, incomplete prior-week state, locked-row rewrite,
coherence failure, missing-price presentation as normal, unexpected board collapse,
writer overlap, timeout growth, or reader failure holds or rolls back the release
while preserving immutable evidence.

## Owner-approved provisional exception: NHL regular-season r1 split overlay

On 2026-09-23 Daniel Mengel explicitly directed the NHL model to relaunch for
regular-season games only with the mature Daily Edge combination of independent
prediction, market reading, public money/ticket splits, silent provider fallback,
and official puck-line tracking. This approval excludes every preseason game and
does not authorize new member copy, labels, stakes, a second model writer, or a
historical rewrite.

The underlying 2026 independent state and market weights must remain release-pure:
2023 is warmup, 2024 selects the independent parameters, the first 70% of priced
2025 games selects market weights, and the final 30% is untouched holdout. Because
historical public split observations are unavailable, only the explicitly bounded
split overlay may be provisional: money-minus-tickets can move the selected-side
moneyline probability by at most 1.2 percentage points and the total by at most
0.09 goals. Same-book opening-to-current moneyline movement is capped at 1.5
probability points. The combined margin translation is capped by those inputs and
cannot create or increase a stake.

Every split observation remains provider-separated. The member read prefers the
latest complete Playbook money+ticket pair and silently falls back to the latest
complete SharpAPI pair; a failed refresh never clears the last known good row and
no stale label or replacement copy is added. These provisional channels must be
evaluated prospectively by the exact r1 release and lock timestamp. The regular
model, calibrated market weights, puck-line distribution, and member board still
must pass every clean-PR, current-main, lease, test, build, coverage, and live-proof
gate in this document. Any preseason publication, mixed release, incomplete-price
actionable, unexpected board collapse, split-driven instability, writer overlap,
or snapshot failure holds/rolls back r1 while preserving locked evidence.

## Owner-approved provisional exception: NHL professional joint-score r3

On 2026-09-29 Daniel Mengel explicitly directed Oddsphere to replace the NHL
line-hugging model with the same independent-model-first architecture established
for NFL: maximize sport-specific projection and prediction accuracy, then marry
the forecast to market reading without restoring a 90% market anchor. He also
directed immediate publication without a shadow-only delay, no member copy or
label changes, preservation of a non-flat board, and safe current/prior input
fallbacks. This exception is limited to the r3 release family recorded in
`docs/current-model-releases.md` and the evidence in
`docs/model-audits/2026-09-29-nhl-professional-joint-score-r3-result.md`.

The owner acknowledges that historical split and intraday same-book movement
observations are not available across the full tournament. The independent score
and ability heads, fixed market weights, coherent joint distribution, and grade
calibration must pass the chronological train/tune/untouched-holdout protocol.
The existing forward-only split overlay remains bounded. Same-book line movement
may continuously condition the score only from a single preferred complete trail
(Circa, Pinnacle, Bookmaker, then another complete same-book trail), must apply
once from the independent base, and may not compound across refreshes. Split-only
evidence may not create a stake. The Total market line receives zero fixed weight.

Publication requires all five opening-night games and 15 markets, actual paired
puck-line quotes, zero score/side contradictions, the reviewed 5 Best Angle / 8
Lean / 2 Watchlist board, tested promotions and demotions, all available split
cells, focused and full model-change tests, TypeScript/build, latest-main
integration safety, protected-PR checks, the existing `prediction_pipeline:nhl`
lease, immutable prior locks, and live reader/writer proof. Hold or roll back on
mixed releases, incomplete coverage, a current-price actionable without price,
unexpected board collapse, writer overlap, lock failure, or reader failure.

## Owner-approved provisional exception: CFB confidence / execution PR #374

Approval and scope: Daniel Mengel, owner/operator of OddsphereAI, explicitly approved this
exception on 2026-09-04 after reviewing the limited independent holdout and the identical-board
impact. It applies only to PR #374 at remote head
`5df51da44d118121693df08261915b6c4039579a` before this governance amendment and to the CFB
confidence candidate `cfb_holistic_confidence_2026_09_04_r2_price_portable_execution`. The final
PR head may add only this approval record and verification metadata. It does not authorize a
similar exception for another sport, market, model, future threshold change, or stake change.

The owner acknowledges that the settled 2026-09-03 diagnostic is one independent date and does
not meet the normal held-out sample requirement in section 4. As a narrow exception, the reviewed
CFB policy may become active after all remaining protected-PR and live-proof gates pass. The
authoritative selected-side probability plus a maximum four-point combined contribution from
strict-identity Circa money-minus-tickets, Playbook money-minus-tickets, same-book line movement,
and same-book implied-price movement determines confidence. Ordinary evidence remains signed and
bounded; no individual channel is an automatic veto, promotion, or side flip. The evaluated
named-book quote and exact EV remain attached and determine only `bet` versus `shop` execution.

The reviewed September 3 board moves 2 Best Angles / 4 Leans / 17 Watchlists / 5 No Plays to
6 / 11 / 6 / 5, with 13 promotions, 6 demotions, and zero side changes. Massachusetts +29.5 is
recovered as Lean / Bet from 53.48% probability plus 2.4 bounded evidence points. The September 4
current-board replay moves 0 / 4 / 14 / 3 to 5 / 6 / 5 / 5, with 10 promotions, 7 demotions,
zero side changes, 7 displayed-quote Bets, and 4 Shops. These counts are evidence outcomes, not
quotas.

No stake creation or increase is authorized. Shop rows remain `no_bet=true`, zero-stake, and
excluded from exact-price ROI while retaining their confidence grade and locked-side accuracy.
The forecast PMF, side, probability, projection, exact quote, provider budget, T-60 immutability,
sole CFB writer, and `prediction_pipeline:cfb` lease are unchanged. MLB first inning is excluded.

Before merge, the amended exact tree must pass focused CFB tests, TypeScript, lint, `npm run
verify:model-change`, `npm run verify`, production build, latest-main integration safety, required
GitHub checks, and protected-PR up-to-date enforcement. Live acceptance requires a successful
natural CFB writer cycle, one empty released lease, a release-coherent member/tracking board, the
reviewed Bet/Shop separation, unchanged stake behavior, and preserved locked rows. Mixed releases,
side/probability drift, a writer or lease failure, missing-price rows presented as normal wagers,
tracking/reader incoherence, a stake change, or an unexpected actionable collapse triggers rollback
to the preceding r53/r28/r15 release family without rewriting locked evidence.

## Owner-approved emergency exception: CFB PR #265 provisional release

Approval and scope: Daniel Mengel, owner/operator of OddsphereAI, approved this exception on
2026-08-29. It becomes effective only when this governance change lands on protected `main` and
applies only to the CFB market/sharp-aware candidate reviewed in PR #265 at commit
`0e86abf4b02e55b26af0516e6c5a1eecc1403bcb`, whose candidate identifier is
`cfb_market_sharp_aware_shadow_2026_08_29_r3_borderline_spread`. It does not authorize later
changes to that candidate, any other sport or market, or any reusable relaxation of this
protocol. PR #265 remains a zero-write candidate and is not, by itself, a production cutover.

The owner acknowledges that chronological, source-specific historical CFB split validation is
unavailable for this provisional release. As a narrow exception to the shadow-only requirement
in section 4, the identified candidate may advance after all gates below pass. Current canonical
market movement and strictly matched sharp evidence may influence the single authoritative joint
PMF and every value derived from it: expected scores, representative score, winner probability,
same-line Moneyline/Spread/Total probabilities, predicted sides, exact-price EV, predictions,
and play grades. Sharp evidence must retain the candidate's exact league/team/date/market identity
rules, including exact-line identity for Spread and Total; missing or mismatched evidence is
unavailable, never neutral, inferred, relabeled, or fabricated. Movement evidence must remain the
same evaluated sportsbook's exact operational opening-to-current comparison.

The authorized math is bounded to the reviewed candidate: exactly 25% market/sharp PMF weight and
75% independent-football PMF weight, with sharp anchor adjustments capped at one point of home
margin and one point of game total. The reviewed balanced promotion/demotion and bounded spread
recalibration rules may affect grades, including the tested TCU-UNC case, but cannot create or
increase a stake. This exception forbids stake inflation, fabricated or loosely matched evidence,
rewriting locked or settled records, historical backfill presented as forward evidence, parallel
prediction writers, a second refresh path, or bypass of the sport-scoped `prediction_pipeline:cfb`
lease. The sole existing CFB writer remains authoritative.

Production activation requires a new immutable and internally coherent set of every affected
model, distribution, probability, calibration, public-outcome, decision, grade, schema, collector,
member, writer, fixture, tracking, and presentation release/version identifier. Generated
snapshots and tracking evidence must stamp that set. Old rows remain immutable, and evaluation
must separate forward results by exact release set and locked timestamp; mixed-era aggregates may
not be reported as current-release performance.

Before merge, the production cutover must pass focused CFB tests, TypeScript, lint,
`npm run verify:model-change`, `npm run verify`, build, and integration safety against the latest
remote `main`. It must report before/after promotion, demotion, actionable, No Play, and coverage
counts for the same eligible board. It must use a clean, up-to-date protected PR and retain every
testing, current-main-ancestor, no-overlap, deployment, and live-proof requirement in this file
and `AGENTS.md`; this exception authorizes no bypass of branch protection or integration safety.

Prepare the preceding coherent release and reader snapshot before activation. Roll back or hold
the provisional release upon any mixed current-slate release identifiers, reader/writer release
or value incoherence, missing required price coverage presented as a normal model No Play,
writer/reader crash, overlapping writer or lease failure, stale pre-release snapshots resurfacing
during refresh, or unexpected actionable-board collapse relative to the preceding release on the
same covered cohort. After rollback, preserve all new rows as release-stamped evidence rather than
rewriting them. Live success requires production database and member-site proof of the expected
release set, one leased writer, coherent board and T-60 locks, current price coverage, reader
freshness, tracking separation, and site responsiveness.

### Owner-approved stabilization amendment: actionable CFB grade ladder

On 2026-08-29, after inspecting the first production r12 forward wave, Daniel Mengel explicitly
approved one additional provisional grade-ladder amendment for this same identified PR #265 CFB
candidate. This amendment does not authorize different PMF math, another sport, later threshold
tuning, outcome-informed recalibration, a stake, or a second writer. The 75% independent / 25%
market PMF and maximum one-point sharp anchor adjustments remain unchanged. It exists only to
repair the release-transition failures and allow a usable, still bounded actionable board from
complete exact-price evidence while a later normally validated recalibration is prepared.

The owner explicitly rejected limiting promotion eligibility to American prices from -125
through +125 as too narrow. The sole CFB writer may apply these three additional actionable-tier
rules after the already authorized market/sharp PMF, probability grade, strict-evidence resistance
checks, and existing balanced promotion/demotion rules:

1. An existing `Lean` may become `Best Angle` only when its exact-price tuple has model
   probability at least 55%, target-excluded edge at least 5 percentage points, exact-price EV at
   least 6%, American price from -500 through +500, and neither strictly matched sharp evidence nor
   same-book movement resists the selected side.
2. A complete Spread `Watchlist` may become `Lean` only when its exact-price tuple has model
   probability at least 53%, target-excluded edge at least 2.5 percentage points, exact-price EV
   at least 2%, absolute spread no larger than 10 points, American price from -500 through +500,
   and neither strictly matched sharp evidence nor same-book movement resists the selected side.
3. A complete Total `Watchlist` may become `Lean` only when its exact-price tuple has model
   probability at least 52%, target-excluded edge at least 2.5 percentage points, exact-price EV
   at least 1.5%, American price from -500 through +500, and neither strictly matched sharp
   evidence nor same-book movement resists the selected side.

The frozen 2026-08-29 15:56:08Z r12 FBS wave contains 20 evaluated tuples after the failed legacy
TCU lock is excluded from recomputation. Before this amendment it is 0 Best Angles / 2 Leans / 12
Watchlists / 6 No Plays. Applying the thresholds above with explicit home/away abbreviation
identity and without using game outcomes yields 2 Best Angles / 2 Leans / 10 Watchlists / 6 No
Plays under the first two rules. The owner-approved Total rule yields the final 2 Best Angles / 4
Leans / 8 Watchlists / 6 No Plays: two existing Leans advance one tier, two Spread Watchlists and
two Total Watchlists become Leans, and two stored Watchlists correctly become No Play when the
selected team is mapped to resisting sharp evidence.
That is six tier promotions, two demotions, and four additional actionable tuples. Existing
resistance demotions remain active and can reduce live counts as prices or evidence move. No rule
can create or increase a stake. These frozen counts are an audit result, not a target, quota, or
required live distribution; every live grade must arise naturally from its own complete tuple and
evidence gates.

The production implementation requires another complete immutable release/version set and the
same protected-PR, integration-safety, focused/full testing, normal deployment, single leased
writer, release-separated tracking, and live database/member proof required above. A held legacy
T-60 row may not satisfy a new release's lock requirement; a genuinely valid immutable prior lock
must remain frozen. Historical same-book price observations may be used across release boundaries
for reader-only movement provenance, but model outputs, decisions, locks, and performance remain
release-separated. No missed or started game may be retroactively represented as an on-time lock.
Roll back or hold on mixed releases, value/reader incoherence, missing price coverage presented as
normal No Play, a writer/reader crash, lease failure, stale snapshot resurfacing, failed future
T-60 creation, or another unexpected actionable-board collapse.

## Owner-approved provisional exception: UCL EPL-grade transfer r6

Approval and scope: Daniel Mengel, owner/operator of OddsphereAI, explicitly
approved this exception on 2026-09-03 after reviewing the live forecast-only
UCL board. It applies only to the unchanged UCL model
`ucl_goals_coherent_2026_09_03_r6_authenticated_match_stats_manifest` and the
grade release
`ucl_grade_policy_2026_09_03_r6_owner_approved_epl_v23_transfer`.

The owner directed UCL play grades to inherit the established Premier League
foundation rather than remain universally No Play while new UCL exact-price
outcomes accrue. The UCL implementation must own and freeze the EPL v23
hierarchy; it may not call the mutable EPL grade runtime. UCL forecast sides,
the coherent regulation-time PMF, probabilities, expected scores, and target-
excluded evidence rules remain unchanged. Every actionable requires a complete
current quote and positive exact-price forecast-side EV. Match Result remains
forecast-first, sparse club priors retain their caps, and Double Chance remains
monitoring-only. No stake, quota, contrarian side, or parallel writer is
authorized.

This is a provisional transfer policy, not a UCL-specific historical price-
validation claim. Production and tracking must stamp the exact UCL calibration
release and report forward T-60 results separately. Before merge, the frozen
18-game board replay must report coverage, promotions, demotions, market mix,
side changes, and nonpositive-EV actionables; focused UCL tests, TypeScript,
lint, `npm run verify:model-change`, production build, protected PR, integration
safety, deployment, and live proof remain mandatory. A total current-price
collapse may not replace a priced member LKG. Roll back future unlocked rows to
r5 on any nonpositive-EV actionable, side substitution, mixed release, broken
four-market lock, or unexpected actionable-board collapse, while preserving
all locked r6 evidence unchanged.

Evidence: `docs/model-audits/2026-09-03-ucl-epl-grade-transfer-r6-predeclaration.md`
and `docs/model-audits/2026-09-03-ucl-epl-grade-transfer-r6-result.md`.

## 1. Declare scope before editing

- Name every affected sport, market, model family, calibration layer, writer, reader, and cron.
- Record the current champion version/release identifiers.
- Identify the single authoritative write path and its sport-scoped lease.
- Check the worktree and preserve unrelated changes.

## 2. Version behavior, not filenames

- Any behavioral change requires a new immutable model or calibration release identifier.
- A release identifier must be stamped into generated snapshots and tracking evidence.
- Old rows remain historical evidence. Do not rewrite them to the new version.
- Reports must separate release eras and show the exact start time/date of each era.
- A fallback may read an older snapshot only for availability; it must remain visibly stamped
  as old and must never be counted as the active release.

## 3. Prove data and runtime coherence

- All scheduled prediction writers for a sport must use the shared `prediction_pipeline`
  lease. Do not create a second independent writer or timer.
- Odds, stats, context, model generation, publication, and locking run in that order.
- Frequent lock sweeps remain targeted to games entering the lock window; they must not turn
  into full-slate refreshes.
- Confirm provider coverage, stored-price coverage, model version, calibration version, and
  published-reader version agree before publication.
- Missing required evidence creates an internal hold/data-health finding. The
  member contract may present that exception as `NO_PLAY` only with an explicit
  incomplete-evidence reason and separate operational-exception accounting; it
  must not fabricate or count a completed model evaluation.

## 4. Calibrate with promotion/demotion balance

- Never tune on the same outcomes used for final evaluation.
- Use chronological train/calibration/holdout splits and report each separately.
- Report record, locked-price units/ROI, Brier score/log loss, calibration gap, and board count.
- Treat multiple correlated props from the same player/game as clusters when estimating
  uncertainty; row count alone overstates the independent sample.
- Every demotion rule must be paired with a tested promotion rule from an eligible candidate
  pool. Report promoted count, demoted count, net actionable-board change, and market mix.
- A promotion must improve held-out value or calibration without bypassing price, lineup,
  freshness, or data-quality gates.
- With insufficient held-out evidence, ship only shadow labels/audits—never live grades/stakes.

## 5. Bound load and failure behavior

- Reuse cached slate-level feature bundles; do not add per-card or per-user provider calls.
- Bound concurrency, pagination, snapshot size, retry count, and database writes.
- Failure must preserve the last coherent published snapshot and must not partially publish a
  new release.
- Do not clear or rewrite locked predictions as part of a model release.

## 6. Required verification

Run:

```bash
npm run verify:model-change
```

Then run focused tests/backtests for every affected model and a dry-run or shadow comparison
that reports old-versus-new decisions. Verify that unchanged markets remain unchanged.

## 7. Deployment and live proof

- Commit only intended files and deploy that exact commit.
- Verify production reports the expected release/version identifiers.
- Verify the latest writer completed under the shared lease with no overlapping writer.
- Verify odds/stat coverage, actionable counts, snapshot freshness, lock coherence, error rate,
  and site responsiveness.
- Re-run the live check after the next scheduled update and the next lock sweep.
- Do not say a change is live until production evidence proves it.

## 8. Rollback criteria

Prepare the previous release identifier and reader snapshot before promotion. Roll back or
hold the new release when any of these occur:

- mixed release identifiers on the same current slate;
- missing prices or required features presented as normal `NO_PLAY`;
- unexpected actionable-board collapse without the approved balanced replacement;
- overlapping prediction writers, timeout growth, snapshot-size failure, or reader crash;
- material disagreement between stored predictions and the member-visible snapshot.
## Owner-approved provisional exception: NHL opponent-adjusted Total hybrid r6

On 2026-09-29 Daniel Mengel explicitly directed Oddsphere to preserve the good
parts of the active NHL model, identify and repair its weak points, improve it
immediately rather than restart or remain in shadow mode, and make no member
copy, label, or product-surface change. This exception is limited to
`nhl_regular_2026_r6_opponent_adjusted_total` and the evidence in
`docs/model-audits/2026-09-29-nhl-matchup-total-hybrid-r6-result.md`.

The r5 Moneyline probability, winner, and puck-line direction must remain exact.
Only the independent scoring Total may use the reviewed multi-season,
opponent-adjusted expected-goals component. The final margin must be solved at
that Total so one joint Poisson distribution retains the r5 home-win probability
and supplies every displayed score and market probability. Existing Total
confidence calibration and grade thresholds remain unchanged. This exception
accepts the 0.000079-goal untouched margin-MAE regression because untouched
team-score MAE, Total MAE, and Total direction improve, full-2025 team-score,
margin, Total MAE, and Total direction improve, and Moneyline calibration plus
puck-line direction remain unchanged.

The production state may consume only MoneyPuck game rows strictly earlier than
the slate. The frozen opening state is authoritative before current-season rows
exist; incomplete or failed current-season retrieval must silently execute the
exact r5 Total fallback and may never suppress the board. Existing locks remain
immutable. Publication requires 5 games and 15 markets on the reviewed opening
slate, unchanged actionable count, explicit promotion/demotion reporting,
focused and full model-change tests, current-main integration safety, protected
PR checks, and live release, coverage, writer, lease, lock, and reader proof.

## Owner-approved correctness exception: NHL runtime-unit parity r7

On 2026-09-29 Daniel Mengel explicitly directed Oddsphere to correct the NHL
score huddling, restore complete two-sided line/odds tracking for internal
market reading and the existing member surface, publish the repair immediately,
and avoid new member copy or labels. This exception is limited to the r7 model,
r3 reader and r5 refresh releases documented in
`docs/model-audits/2026-09-29-nhl-runtime-parity-two-sided-prices-r7.md`.

The candidate may replace production special-teams per-60 inputs with the
per-game units used by the already validated score fit. It may canonicalize
only active, pregame, complete two-sided named-book quotes and expose their
existing append-only trail through the existing UI. It cannot change the
historical coefficients, thresholds, stakes, provider-call ceiling, schedule,
writer, sport-scoped lease, lock rules, copy or labels.

The owner-authorized correctness repair may ship the reviewed 14-to-10
actionable change without fabricating compensating promotions: five Total Best
Angles were artifacts of the unit mismatch, and the sixth demotion follows the
corrected coherent puck-line probability. The board remains non-flat with
actionable Moneyline, Total and puck-line markets, all five games and all 15
markets. This is not a reusable exception to the promotion/demotion rule.

Publication still requires focused/full tests, exact board-impact reporting,
latest-main integration safety, protected PR checks and live proof of the r7
writer, r3 reader, r5 refresh, complete prices, one lease and immutable prior
locks. Hold or roll back on mixed releases, lost coverage, a partial quote
replacing last-known-good data, score/side contradiction, writer overlap,
reader failure or mobile navigation overlap.
