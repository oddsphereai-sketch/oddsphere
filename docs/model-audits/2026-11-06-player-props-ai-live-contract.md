# Owner-directed full player-prop AI integration

Starting production base: `9c9ba4db585044f5a0867dc6040fc1ac2ecf667c`.
The owner explicitly requested the complete product: live integration, grading,
two game-day reviews per game, scheduling and a target below $50/month. Historical
win-rate improvement is not a launch gate; source/process/runtime correctness is.

The owner's subsequent direction prioritizes reader correctness before refresh/lock
alignment. Runtime, grading and wallet modules on this branch are unfinished
integration scaffolding, not an enabled production release. No existing writer calls
the new reviewer yet. Do not deploy this branch as a complete live integration.

## Reader correctness contract

Each player receives the complete supplied raw evidence plus source-linked navigation
for recent form, opportunity/role, matchup, direct opponent history, availability,
game environment, named-book market and the independent model. Every review must
return all eight areas with the backend's actual source-coverage status, only that
area's fact IDs, an estimated directional interpretation and a short complete
sentence. The backend attaches the exact source values and hashes to accepted
citations. A response with omitted areas, invented/cross-player fact IDs, claimed
coverage that was not supplied, or an unfinished sentence is rejected. These checks
do not prove every interpretation correct; controlled evidence changes and manual
comparison with actual source facts remain necessary.

Recent windows reconcile matching start/team identities across provider IDs and
normalize stat aliases before counting games. Conflicting values stay visible and
are excluded from the affected summary field. NBA zero/unknown-participation rows
are retained separately from conditional-on-participation performance; NFL zero
production alone does not prove a DNP. Event dates, sample sizes and source
availability remain visible so old starts are not represented as fresh form.

No direct history is absence of evidence, not adverse evidence. Unlisted injuries
do not establish health or a starting role. Exact-game team reports, explicit source
clearances, roster/depth context, projected quarterbacks, batting order and actual
weather/park context are kept distinct. Existing NFL forward context can be joined
read-only by exact game/start/both-team identity, without importing Daily Edge model
forecasts or making new sports-provider calls. Missing context remains explicit.

The market report retains supplied opening quotes even when their line differs
from the current anchor. It exposes all supplied opening pairs, current exact-line
prices and bounded alternate-ladder summaries. Stored same-book movement is labeled
as derived from the same quotes; nearest-line openings are not proof of a main-line
move. Legacy archive clocks do not become provider confirmations. A bounded source
archive is not a full tick history. Money/splits are present only when actually
supplied; movement cannot invent betting volume or identify informed bettors.

Rehearsals retain vendor receipts and unknown-response charges in the fixed local
$2 ledger. Unsent parts cancelled after failure are explicitly refunded; dispatched
unknown calls cannot be erased or blindly repeated. Stream health stores timing and
character counts, not partial forecasts or hidden reasoning. A source inventory,
a controlled reader test and a single-player readout are not proof of full-game
completion, full forecast-path reliability, monthly cost or predictive improvement.
Private production packets, readouts and aggregate audit results stay outside Git.
The fuller reader input invalidates any budget claim based on an earlier, smaller
request format; the final combined product must be measured again before quoting
a monthly figure.

The current reader candidate is
`player_props_ai_2026_11_06_r8_independent_prior_only`. It removes the old published,
market-adjusted forecast fields from the AI-facing input while preserving the raw
source archive. A counterfactual test changes those old fields from extreme Under
to extreme Over values and proves the reader receives identical evidence aside
from the archive digest. It cannot reinforce the independent prior with a second
copy of the old final forecast.

NBA comparison references reuse the existing pure finalized-stat feature builder,
with actual cache-availability checks, observed current/prior-season sample counts
and matching pace units. Default or smoothed fallback numbers are not represented
as observed league data. An offensive-rating reference is contextual evidence for
defense, not a falsely exact matched-window adjustment or a league rank. Other raw
metrics without comparison support remain explicitly unbenchmarked.

Recorded event age is distinct from source retrieval age. Dated performance
requires an explicit caution; a fresh DNP row cannot make old qualifying performance
look recent. Pitcher throwing hand cannot establish a left/right batter performance
split. The validator preserves valid negation such as “not confirmed healthy” while
rejecting unsupported affirmative claims. The AI-facing stat context uses six
significant figures; exact event lines, quote economics and original archived
values retain precedence. Source-navigation references remove duplicated workload
and book data without deleting their cited underlying evidence.

Reader-only full-game source rehearsals and controlled combined-format tests have
completed. The combined reader-plus-scenario request has also timed out on full-game
inputs after output began and before a terminal usage receipt. That failure remains
unresolved; its charge stays reserved and it must not be presented as a completed
forecast or a production-ready full pipeline. Cadence, live writer/reader adapters,
grades, calendar funding, lock integration, full required deployment checks and a
measured monthly cost remain separate outstanding work. Do not activate the
prototype runtime merely because the reader-only tests passed.

Scope is all eight required NBA, ten NFL and seventeen MLB markets from the product
inventory. Existing writers remain authoritative: NBA private/member writer, NFL
production writer, and MLB `refreshMlbPropsBoard`, under their existing sport leases.
There is no second prediction writer or production shadow model. Failed responses
retain usage/error receipts without storing candidate predictions as shadow output.

Current release baselines include NBA forward decision r14/runtime r13 and member
snapshot r8; NFL ordinary model r33/calibration r35/decision r39, member r53/lifecycle
r35; MLB aggregate model `mlb_props_2026_10_21_r44`, confirmed against the runtime
constant and current-model registry. New AI inference, law, grade, publisher and
reader semantics have explicit new identities. Independent-source identities remain
attributed separately. Legacy locked records must retain their exact fields first.

The new AI returns an individual weighted integer-outcome law for each player,
with source citations, estimated evidence confidence and explicit exceptions.
Probabilities, means, combinations, binary events, pushes and exact-price economics
are computed from that one law. This is a provisional AI-estimated distribution,
not a claim of empirically calibrated confidence or improved predictive accuracy.
Physical identities and player/market coverage are tested before acceptance.

Exactly two logical slots exist per scheduled game/date: early on game day and a
final window before the existing lock. Whole-player request partitions and a bounded
repair of the same frozen input are parts of a slot, not additional hourly reviews.
The existing frequent lock sweep may dispatch due slots; idempotent durable claims
ensure that frequent cron visits cannot multiply paid calls. Current quotes can be
repriced against a saved accepted law between slots without another inference call.

The prop-specific durable monthly ledger uses integer microdollars and server-side
atomic claims. It reserves the complete calendar's primary reviews before optional
stronger finals, preserves failure/unknown-response charges, protects a recovery
reserve and caps stronger replacements at 10% of games and available funding.
No cache discount, unfunded retry, silent scope reduction or independent per-user
provider/AI request is permitted. Calendar/billing-month boundaries, rescheduling,
overlapping workers and incomplete plans need tests. If a complete future plan
cannot be funded, report the issue before admission rather than selling a plan
that predictably shuts off midway through the month. The independent pipeline
continues with an explicit AI-unavailable source label during operational failures.

All providers continue through existing collectors. Future response-completion
clocks must be truthful; legacy collection-start/export clocks are not reconstructed
as provider confirmations. Stats, availability, matchup, independent model and
retained temporal book data enter the frozen input with their actual availability.
Money/splits or informed-bettor attribution are never inferred merely from odds.

Before publication: full/focused checks, source/price contracts, tested symmetric
promotion/demotion and board-count impacts, locked writer/reader precedence,
complete-calendar funding and actual API-format/load checks within the fixed local
$2 test ledger. Fresh-main protected PR checks and exact local/remote tree binding
remain required. Enablement requires the production key, ledger migration and
verified runtime configuration. Verify actual writer, review cadence, reader, lock
and cost receipts after deployment; do not declare the product live from a preview.
