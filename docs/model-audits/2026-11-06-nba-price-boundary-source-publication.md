# NBA price boundary and market-read publication integrity

Starting production base: `9c9ba4db585044f5a0867dc6040fc1ac2ecf667c`.
Dedicated branch/worktree: `codex/nba-best-angle-price-boundary-20261106`.

The owner explicitly rejected NBA Moneyline Best Angles at -300 and -235,
while allowing independently qualified Spread Best Angles. R31 requires an
offered Moneyline price of -200 or better for Best Angle, inclusive at -200.
An otherwise actionable expensive winner stays Lean; genuine opposing evidence
can still make it Watch. No Watch/No Play is forced to Lean. Other markets keep
their existing confidence, value, source and uncertainty rules. Improvement
to -200 can restore Best eligibility at the same forecast; causal support and
legacy audit flags cannot waive the current price ceiling.

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

The captured healthy21:13 board has one Best, six Leans and twenty Watches.
The exact final price-tier function changes only Atlanta ML at-300 to Lean:
zero Best, seven Leans, twenty Watches; zero actionable promotions/demotions.
Scores, probabilities and prices stay exact. This is an explicit owner product
boundary, not a holdout-derived accuracy improvement. Source failure/recovery
controls pair zero-write retention with successful qualified re-publication;
no compensating picks are manufactured. Audit JSONs retain capture hashes.

R30/R29/R28 and older frozen audits keep their previous -400 economics and
causal rules. Stored locks keep exact reader/writer precedence, including a
legacy R30 Best at-300. No historical locked grade is corrected or suppressed.
The previously deployed CBB R12/R11 policy and its locked release families are
unchanged. Separate CBB numerical research remains held.

Required publication proof: focused both-side price/recovery, source fault,
zero-write freshness/lock preservation, full model gate, types/build, clean
latest-main protected PR and actual natural production publication/coverage,
reader coherence, source-read release and unchanged locked payloads. A preview
or an explained grade count alone is not completion.
