# Moneyline wager boundaries and NBA market-read publication integrity

Starting production base: `9c9ba4db585044f5a0867dc6040fc1ac2ecf667c`.
Dedicated branch/worktree: `codex/nba-best-angle-price-boundary-20261106`.

## November 6 owner-selected moneyline wager limits

The owner selected -500 or better as the inclusive Lean price limit after
identifying Ohio State -8000, Georgia -9000 and Xavier -8000 as inappropriate
Leans. Moneyline prices worse than -500 become complete priced No Plays, even
when the predicted winner is very likely or nominal EV is positive. Best Angle
requires -200 or better; -235/-300 can qualify as Lean. These boundaries only
restrict the otherwise evidence/risk-qualified tier. A better real price may
restore eligibility, while resistance can still make a pick Watch. No quota,
forced side flip or compensating promotion is introduced.

Native current paths: NBA grade `nba_grade_policy_2026_11_06_r31_moneyline_wager_price_boundaries`;
CBB decision/interpreted R13, grade R12, publisher R53, adapter R36, tracking R39;
CFB decision R62, grade R33, production R44, writer R153. The shared pure
`moneyline_price_policy_2026_11_06_r1_owner_boundaries` is qualification only.
Numerical models, calibrations, probabilities, chosen sides, exact contracts,
source tapes and provider budgets/cadence stay unchanged. CBB numerical R7 and
its private artifact remain active; the separate numerical candidate stays held.
NBA model R36/marriage R38 and CFB model R28/probability R30/calibration R34 stay
unchanged. Existing sport-scoped leased writers remain the only writers.

A No Play retains raw confidence, winner prediction and actual price, but has
null recommendation confidence and no wager eligibility in member/tracking
contracts. CBB old decision R12/grade R11 and every earlier released family,
NBA R30/R29/R28, and CFB R61/grade R32/production R43 retain exact stored reader,
writer and official-tracking semantics. No current price rule is applied to a
locked payload. A game that locks before rollout keeps its old grade.

Frozen 21:13/21:02/21:10 snapshots show CBB today 177 markets:
54 Lean/86 Watch/37 No Play -> 38/81/58 (16 actionable removals, five Watch ->
No Play). NBA today 27: 1 Best/6 Lean/20 Watch -> 0/7/19/1 No Play; Atlanta
-300 Best -> Lean, and one already nonactionable steep Watch -> No Play.
CFB rolling 300: 72 Lean/105 Watch/22 Best/101 No Play -> 69/94/22/115:
three future actionable removals and eleven Watch -> No Play. Today's five
CFB games retain all 15 grades. All other captured sports have zero actionable
violations; they are audited only, with no unversioned reader override.
Forecast/price/selection changes are zero. Locked state at actual deployment
may reduce the applicable scope. The owner-directed contraction is explicit;
paired same-forecast improved-price recovery is tested rather than invented
plays. This is product-policy qualification, not holdout accuracy evidence.

Evidence: `docs/audits/2026-11-06-moneyline-wager-price-boundaries-impact.json`.
Full model gate, affected focused/legacy lock tests, types/build, fresh-main
protected PR and actual normal-writer/release/source/reader/immutable-lock proof
remain mandatory before completion. The prior NBA source-read failure repair
below remains in the same pending release.

## The two board extremes

The owner then reported that the NBA board had become flat again. R30's
same-input correction changed one underqualified Best to Lean and removed no
actionables. It cannot explain the larger population swing. Comparing saved
19:46 and21:13 member snapshots shows11 actionable removals, one addition and
several large probability/side changes. All nine19:46 projected scores exactly
match the independently saved roster-adjusted independent forecasts.

The code allowed a failed price-evidence lookup to clear the price family,
retain independent projections and keep high statistical data quality for
grading. Missing opposition could therefore appear neutral, even though the
market had not been fully read. An additional NBA API catch returned HTTP200
with an empty board on a pipeline exception; the generic publisher could save
that failed rebuild as a successful new publication.

The retrospective failure reenactment uses1724 historical split rows available
before19:46, the captured independent forecasts/quotes, exact R29 policy and a
failed price family. It reproduces all27 published grades: six Best, eleven
Leans and ten Watches, with all nine independent scores retained. It inspects
no outcomes and makes no model fit/provider call/write. The precise historical
SQL error was not retained in that member snapshot; the failure mechanism is
reproduced, not represented as a directly observed past SQL log or blind
accuracy evidence. Script:
`scripts/operator/audit-nba-price-read-failure-reproduction.ts`.

## Declared source correction

`nba_reader_publication_2026_11_06_r1_complete_reads` rejects explicit failed
price/split high-water, page, ordering or coverage reads before constructing
new game decisions. Keyset reads continue through short backend pages to the
scoped high-water ID; an empty page before it or an invalid frontier fails. A
compact high-water/last-read/row-count proof accompanies future private captures.
A zero price frontier cannot silently erase previously attested quote anchors;
a genuine first read with no prior price knowledge remains valid absence.
The ordinary correctly sized read makes the same database requests; a lower
backend cap can require additional existing-history pages, never provider polls. It does not require supporting books or invent opposition from a
successful empty read. The sole existing pipeline is used by both the normal
reader/publication and prediction-record writer. A failed run retains the
previous published payload and its clocks; no grade count is targeted.

The NBA route returns503 on rebuild failure, and the existing publisher rejects
it before upsert/cache invalidation. Small allowlisted failure-phase receipts
travel to its existing cron result/log; SQL/provider secrets stay out of member
responses. Successful future NBA publications carry the new source-read release
in `payload_version`. The prior v1 publication's exact read status is not
retroactively certified. A later successful read resumes ordinary publication.

Healthy forecasts, probabilities, selected contracts/prices, source
interpretation and stakes are unchanged. Model R36 and marriage R38 remain
authoritative; grade R31 and the separate publication contract own these changes.
No provider request, writer, schedule, lease, fit, calibration or production
shadow is added. The publisher's injectable dependencies are offline tests only;
its default production path and all non-NBA snapshot rules stay the same.

## Same-input impact and locks

The original Best-only21:13 replay changed only Atlanta ML at-300 to Lean.
The owner subsequently selected the additional -500 wager limit; the complete
final counts and explicit CBB/CFB actionable removals are recorded above.
Scores, probabilities and prices stay exact. This is an explicit owner product
boundary, not a holdout-derived accuracy improvement. Source failure/recovery
controls pair zero-write retention with successful qualified re-publication;
no compensating picks are manufactured. Audit JSONs retain capture hashes.

R30/R29/R28 and older frozen audits keep their previous -400 economics and
causal rules. Stored locks keep exact reader/writer precedence, including a
legacy R30 Best at-300. No historical locked grade is corrected or suppressed.
The previously deployed CBB R12/R11 locked release family stays exact.
Only new unlocked/future decisions use R13/R12. Separate CBB numerical research remains held.

Required publication proof: focused both-side price/recovery, source fault,
zero-write freshness/lock preservation, full model gate, types/build, clean
latest-main protected PR and actual natural production publication/coverage,
reader coherence, source-read release and unchanged locked payloads. A preview
or an explained grade count alone is not completion.
