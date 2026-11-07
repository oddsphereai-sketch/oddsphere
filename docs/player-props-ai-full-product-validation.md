# Player-prop AI product: full-scope offline validation

Forecast-reliability continuation base: `e008a0fd4f22653a8fde8690b87d38d4d1ac3cf2`.
Packet contract: `player_props_ai_offline_full_product_2026_11_06_r1`.
Research behavior is exported by `probability-proposals.ts`; receipts preserve each
original request. This is a manual local evaluation system, not a deployed model.

The current joint-forecast candidate and measured-cost workflow are described in
[`player-props-ai-forecast-reliability.md`](player-props-ai-forecast-reliability.md).
That workflow supersedes the older point-forecast/output-density cost rehearsal below.
The older scripts and their immutable receipts remain available for provenance, but
their smaller input layout cannot justify a current full-product monthly estimate.

## Owner's launch standard — November 6

The owner explicitly requires correct processing before launch and forward measurement
of prediction results afterward. Historical backtesting, a completed outcome cohort or
proof of beating the independent model is not a launch prerequisite for this product.
The scoped exception is recorded in `docs/model-change-safety.md`. Confidence estimates
must have clear model-estimate semantics; they cannot be represented as empirically
validated simply because the AI expresses certainty.

Launch requires correct player identities, fresh and honestly timestamped source data,
individual stats/workload and matchup/context review, actual availability facts, market
chronology, independent book accounting, correct event/price math and coherent outputs.
Every requested scope must receive a decision or a specific operational exception.
The two review windows, stronger-model replacement limit, durable spending reservations,
before-lock completion, source-grounded explanations, safe failure behavior and exact
locked-record handling must work in the real existing writer/reader path. These process
gates are not waived. A successful API response alone proves none of them.

## Intended product

Assess every offered player individually across the required catalog: eight NBA,
ten NFL and seventeen MLB markets. NFL passing touchdowns/interceptions are required
additions; an inventory entry is not a qualified forecasting head or executable quote.
Expansion/research-only markets remain explicitly inventoried. There is no side quota.

Exactly two logical reviews occur on the Eastern game date: early and before the
existing lock. The final review gets refreshed evidence. A stronger model may replace
at most 10% of final reviews; it never adds a third review. The offline scheduling key
includes the scheduled date, sport, game and stage, so a reschedule to another date is
not confused with an already completed slot. This does not migrate locked records.

Large reviews are partitioned by whole players with all their markets intact. Every
partition receives shared all-player baseline context. These are requests within the
same logical review. The full review is accepted only when every partition completes
and passes validation; partial delivery is not a completed game review.

## Implemented evidence and output

`export-sources.ts` and `prepare-current-nba.ts` use SELECT-only existing caches.
`build-full.ts` and `enrichment.ts` compile cached NBA/NFL logs, publicly available NFL
history, timestamped NBA availability, and immutable pre-lock MLB source snapshots.
Player joins reject ambiguous identities. Availability and cache timestamps must precede
the input cutoff. A past box score is not considered available merely because the game
probably ended. Replays with late or missing evidence retain explicit gaps.

MLB records retain their original model release and locked payload digests. Historical
releases may inform workload size; they cannot be blended into current-model accuracy.
NFL additional QB heads remain diagnostic-only until independently qualified, and the
stored export lacks their executable prices. Existing collection supports those markets;
this harness does not create a second sports-data collector or writer.

`market-report.ts` preserves exact-book/line price pairs, anchor chronologies and observed
alternate-ladder summaries. Complete raw alternate traces remain in private artifacts.
Summary compression is lossy and needs quality evaluation. Native last-price-change time
and our confirmation/receipt time are distinct. Provider-response time, snapshot/export
availability and unknown legacy receipt provenance are labelled separately. The compact
AI input preserves both clocks and their provenance for pairs and unchanged-price runs.
Snapshot availability cannot masquerade as fresh provider confirmation. Pair construction
never mixes opening/current/unknown categories or incompatible receipt provenance.
The existing NBA collector records its legacy `fetchedAt` before sending requests. That
is not a response-completion timestamp. Its archived quotes therefore use the archive's
actual availability bound and retain `snapshot_availability` provenance. The original
collection-start field remains exact in the source export. Future live integration must
record real response completion through the existing collector; do not reconstruct it
for legacy records. A retained normalized source timestamp can also contain an older
normalizer's fetch-time fallback, so it alone cannot establish a native price-change time.
Opening prices and legacy rows with an
unknown opening marker are not qualified current references. Multiple feeds for one
book do not establish independent market breadth. An execution book cannot confirm its
own edge. Missing money/splits remain missing; price motion does not identify sharp money.

`readable.ts` uses named compact tables, shared context and short citation aliases.
Recent games remain individual; older season arrays have numerical summaries with raw
values archived. Prior grades and audit-only hashes do not anchor the AI. The reversible
codec remains available for comparison; roundtrip preservation alone proves no AI skill.

The required keyed schema enumerates each player and market and restricts citations to
that player's evidence. Every supported exact event can receive an uncalibrated numerical
probability hypothesis. Point proposals are relative to the independent projection, not
the betting line. Generic uncertainty is not an excuse to invent missing data or imply
calibrated confidence. DNP/void is never an Under win. Integer-line push targets without
an appropriate distribution are excluded from this binary probability benchmark.

`point-forecast.ts` derives combinations from components and checks physical identities,
including points versus made threes and completions versus attempts. Rejected outputs
retain their vendor receipt and cost. Raw probabilities are saved before point gating
so failed games cannot quietly disappear from evaluation. They are never accepted picks.
`recover-research.ts` can create a separately labelled raw-hypothesis supplement from an
original complete receipt; it cannot repair the original result or authorize publication.

`probability-proposals.ts` and `score-local.ts` reject after-lock issues, future cutoffs,
duplicate stage forecasts and invalid probability values. They score exact events with
Brier/log loss against the recorded independent baseline, preserving release/market/stage
cohorts. Pushes and voids are excluded explicitly. Score all predeclared games, including
raw hypotheses from rejected games, and report guard/fallback performance separately.
Correlated props need game-cluster uncertainty. One slate cannot qualify all markets.

A supplied synthetic joint-law primitive can generate coherent paths and exact-price EV.
Real sport-specific calibrated joint-law bridges and approved grade/stake adapters are
still qualification work. Raw AI probabilities, prose confidence and coherent means do
not substitute for them. No live probabilities, grades, stakes or locked payloads change.

## Measured-cost workflow and spending bounds

`api-eval.ts` implements a fixed $2 total LOCAL evaluation ceiling, shared across all
manual cases. It reserves every request in a game/slate before generation, claims each
reservation once, and atomically persists usage. Failed/incomplete calls count; a timeout
without usage retains its full reserve. There is no automatic paid retry. Never delete
or reset this ledger to obtain more test budget. This controls this harness, not other
activity under the same OpenAI project/key, and is not a deployed monthly cap.

Keep `OPENAI_API_KEY` in a private mode-0600 environment file outside Git; load it with
`node --env-file=/private/tmp/PRIVATE_ENV ...`. No key belongs in source, public browser
variables or reports. Count-only tools call the actual model-specific input-token API;
local tokenizer counts are explicitly proxies. Private production-derived datasets and
results remain outside Git and must not be included in a public PR.

Standard pricing and cache-write rules were checked against [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
and [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
Default 30-minute cache writes cost 1.25 times ordinary input. Two reviews hours apart
should not assume reuse. Generation uses `prompt_cache_options: { mode: "explicit" }`
with no breakpoints, avoiding cache writes; verify zero writes in returned usage.
`reconcile-costs.ts` includes writes in historical receipts and retains the earlier ledger
quote with its correction. Original vendor receipts are never edited. The no-discount
billing function charges cache reads at ordinary rates conservatively and includes all
billed output, including reasoning. These calculations are not invoice reconciliation.

`profile-costs.ts` measures model-specific input counts per player-preserving request.
`build-calendar.py` uses complete selected month calendars, including heavy days.
`monthly-cost-report.ts` projects two final-sized reviews per game, with largest observed
output-per-market density, per-request billing, a 20% allowance and $5 evaluation reserve.
It reports ordinary, doubled-output, largest-sampled-game and full-output-cap scenarios.
Output density for stronger NFL/MLB reviews remains an assumption until measured; a
stronger NBA comparison does not prove cross-sport reliability or accuracy.

Full primary coverage must be funded for the entire month before stronger upgrades are
admitted. The planner compares a fixed 10% stronger allocation against the affordable
allocation up to 10%. If the primary reserve itself fails, report that failure before
launch: do not silently drop markets, stop reviews mid-month or claim a guaranteed $50.
An allowance and sampled workloads are projections, not a hard future workload bound.
Every-request-at-output-cap scenarios can exceed the target even when ordinary loads fit.
No production scheduler/monthly reservation system has been deployed by this work.
Sports-data subscriptions, hosting/database, taxes and other AI products are excluded.

## Reproduce locally

These checks make no network calls:

```bash
node --import tsx ops-local/player-props-ai/test.ts
node --import tsx ops-local/player-props-ai/api-eval.test.ts
node --import tsx ops-local/player-props-ai/full-product.test.ts
node --import tsx ops-local/player-props-ai/cost-plan.test.ts
node --import tsx ops-local/player-props-ai/process.test.ts

# Read-only local build from exported sources; NEW private destination.
node --import tsx ops-local/player-props-ai/build-full.ts \
  --input=/private/tmp/enriched-source.json --nflverse=/private/tmp/nfl-history.json \
  --out-dir=/private/tmp/full-product-new

# Exact count-only preflight. Does not generate forecasts.
node --env-file=/private/tmp/PRIVATE_ENV --import tsx \
  ops-local/player-props-ai/profile-costs.ts \
  --manifest=/private/tmp/full-product-new/manifest.json --out=/private/tmp/new-profiles.json

# Manual paid generation, governed by the fixed common evaluation ledger.
node --env-file=/private/tmp/PRIVATE_ENV --import tsx \
  ops-local/player-props-ai/api-run.ts --mode=generate --partition=true \
  --packet=/private/tmp/research-packet.json --model=gpt-6-luna \
  --max-output=16000 --label=UNIQUE_DELIBERATE_ATTEMPT

node --import tsx ops-local/player-props-ai/monthly-cost-report.ts \
  /private/tmp/new-profiles.json /private/tmp/calendar.json \
  /private/tmp/receipt-directory /private/tmp/new-cost-report.json

node --import tsx ops-local/player-props-ai/score-local.ts \
  /private/tmp/scoring-manifest.json /private/tmp/new-score-report.json
```

The scoring manifest contains `forecastFiles` (saved probability artifacts) and optional
`outcomeFile`. Outcomes use `SettledOutcome` from `probability-proposals.ts`: exact proposal
ID, settled/void/push status, actual stat or null, official availability timestamp and
source. Do not manufacture outcomes or infer participation from an absent box-score row.
With no outcome file the report correctly says pending; it does not report accuracy.

## Production process gates and forward evaluation

Results are evaluated forward by release against the independent model, current member
decisions and a qualified market baseline. Report full boards, both sides, binary/combo
markets, promotions paired with demotions, exact prices and board-count impact. Freeze the
issued forecasts; do not retrospectively rewrite them. These measurements are not the
owner's prelaunch gate. A flatter board is no proof of better accuracy.

Follow `docs/model-change-safety.md`, bump affected production release identifiers, update
the model registry and retain the shared `prediction_pipeline` lease and sole writer.
Prove writer immutability and exact legacy locked reader precedence. Run all required
model/integration checks from a clean fresh-main branch and publish only through a PR.
Verify live release, cron health, coherence, data coverage and reader snapshots after any
future qualified deployment. Until those gates pass, keep these artifacts offline.
