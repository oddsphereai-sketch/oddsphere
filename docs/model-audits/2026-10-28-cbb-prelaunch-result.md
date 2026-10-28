# College basketball private candidate — result and handoff

## Status

Private development build, `cbb_candidate_2026_10_28_r1_adjusted_efficiency`.
No merge, production writes, scheduled job, member publication, grade or stake activation.
The existing CBB “Coming soon” state and empty official market registry are untouched.
This is a tested independent foundation plus evidence adapters; it is **not yet a complete
launch-qualified Daily Edge model**. The owner explicitly requested no publication.

## Architecture and research

Opponent-adjusted offensive and defensive points per 100 possessions, jointly estimated
tempo per 40 minutes, regularized team effects and a historical-season prior. Current-season
data naturally replaces the prior through accumulated observations. Venue is explicitly
verified: nominal home listing at a neutral tournament or international event grants no
home-court effect. A fitted margin/Total residual model supplies probabilities around the
same projected scores. Integer/half-point thresholds preserve win/loss/push and exclude the
impossible tied final margin; Moneyline and a zero Spread agree. Final-score labels include
overtime, while regulation tempo removes additional overtime minutes.

Box-score inputs include field-goal/three-point/free-throw makes and attempts, offensive and
defensive rebounds and turnovers. Four Factors are retained for diagnosis. They are not each
added as an arbitrary second score adjustment on top of efficiency. A roster context builder
identifies returning minutes, transfers and players without prior D-I production using current
player IDs and the **top-level historical team**; the provider’s nested `player.team` is current
and cannot establish historical membership. Roster context currently does not change scores.
Rest/travel, coaching, recruiting, lineup synergy and availability effects are not modeled yet.

Primary research and provider sources are linked in the scope document. The November 1
Notre Dame/Villanova opener in Rome is confirmed by Villanova University.

## Historical evaluation

2022 warmup; 2023 development and residual estimation; 2024 configuration selection by log
loss; 2025–26 chronological confirmation. Four configurations were predeclared. Selected:
`adjusted_ridge_10_carry_80` (ridge 10, prior carry 0.8, 90-day recency).
After selecting on 2024, residual uncertainty is fitted on 2023–24 only. Same-day outcomes
are withheld together; a six-hour lag from archived game start additionally protects against
late previous-day games entering midnight fits. Archives lack actual final-whistle receipt
times: this is a conservative historical simulation, not a reconstruction of captured pregame
payload availability. Historical neutral-site flags are venue metadata retrieved now.

The confirmation cohort was opened once for model selection purposes. A subsequent correctness
test removed impossible zero-margin pushes; the same frozen selection and every winning side
remained unchanged. Probability scores were regenerated after that correction. Do not call the
corrected probability report a second pristine holdout or tune further on this opened cohort.

| Metric | 2025–26 confirmation |
| --- | ---: |
| Games | 5,734 |
| Winner W–L | 4,022–1,712 |
| Winner accuracy | 70.14% |
| Always listed home team, same cohort | 63.71% |
| Brier | 0.1908853 |
| Log loss | 0.5604543 |
| Mean absolute team-score error | 8.7276 points |
| Mean absolute margin error | 9.8333 points |
| Mean absolute Total error | 14.2831 points |
| Ten-bin calibration gap | 2.7263 percentage points |
| 90% margin interval coverage | 90.1291% |
| 90% Total interval coverage | 89.5535% |
| Incomplete venue/history inputs (retained in results) | 66 |

November: 935/1,238 = 75.53%. December: 691/958 = 72.13%. January: 1,031/1,520 =
67.83%. February: 928/1,368 = 67.84%. March: 429/637 = 67.35%. April: 8/13 = 61.54%.
November contains more mismatched nonconference games; its accuracy is not an all-season
expectation. The listed-home baseline is a sanity check, not a sportsbook/competitor benchmark.
No claim of outperforming favorites, closing lines, an incumbent CBB champion or a competitor.

Historical team/box cohort exclusions across four seasons: 2,097 non-D-I/unknown-conference
games, 65 nonfinal games, 72 incomplete Four Factors, 6 invalid finals, 41 invalid possession
pairs, 7 missing box pairs and 1 invalid overtime row. Accepted training rows: 22,840, including
261 unknown-venue rows that are excluded from fitting but remain flagged in evaluation.
Missing input rows are never silently converted into a normal completed grade evaluation.

Source dataset SHA-256:
`18bbcc0977c972cc1f513a5779b4b59995f580dbd68e9bb09ba71f8af0d92e42`.
The portable prior, selected configuration, uncertainty and full report are retained in
`lib/cbb/artifacts/`. Full local raw capture and per-game confirmation rows are under
`/private/tmp/oddsphere-cbb-data/`. No final-season averages enter an earlier forecast.

## Market evidence and actual source defects found

BALLDONTLIE current and provider-opening odds return successfully. Each exact two-sided named
book/market/line/clock is retained. Same-book point movement and same-line de-vigged price
movement are separate. Prices at different thresholds do not fabricate a price-only signal.
An opening retrieved now remains available now; it is never backdated as a prior observation
available to OddsSphere. Two endpoints do not prove intermediate chronology or leadership.

The opening-week raw BDL side order is reversed relative to its schedule for some neutral-site
games. Named-team SharpAPI rows prove the ownership of current same-book exact prices. The
adapter corrects a current BDL side order only when exact same-book paired values establish
that binding; it never extrapolates the binding into an unverified historical opening.
The preview uses independently name-mapped current Sharp sportsbook quotes, preserving BDL
raw evidence and the binding receipts. No inference from favorite status alone is permitted.

SharpAPI `/events?league=ncaab` returned 522 mixed rows, including noncollege basketball,
outrights and a bucket containing both men's and women's contracts. Row-level competition,
full team names, start time, main-market status and sportsbook pairing exclude unrelated rows.
Exchange observations cannot masquerade as professional sportsbook evidence. Exact-event
requests recovered named sportsbook quotes; the bulk `/odds` path was not a sufficient source.
Professional-book chronology and public splits are not yet complete. A CBB price adapter emits
the shared observation shape while retaining the explicit prelaunch/unsupported inference
boundary; no NFL weights, side-flip rule or qualification is transferred to CBB.

Sharp `/splits?league=ncaab` returned zero rows in the captured cycle. Local `PLAYBOOK_API_KEY`
is absent, so no authenticated Playbook coverage conclusion is possible. ESPN's injury endpoint
returned an empty report; this is not clearance. The BDL CBB API does not document an injury
endpoint. Current official/conference availability and historical roster/availability bindings
remain genuine launch work. No arbitrary injury point deduction or automatic grade cap exists.

## Preview and reproduction

```bash
npx tsx --env-file=.env.local scripts/operator/collect-cbb-prelaunch.ts --venues
npx tsx --env-file=.env.local scripts/operator/capture-cbb-context.ts
npx tsx scripts/operator/evaluate-cbb-prelaunch.ts
npx tsx scripts/operator/preview-cbb-prelaunch.ts --date=2026-11-01
npx tsx scripts/test-cbb-prelaunch.ts
```

All research outputs are local; write/publication/activation arguments are rejected.
Cached historical files are reusable; `capture-cbb-context.ts --refresh` creates retained new
raw captures and advances only the local latest pointer. The preview contains transparent
independent projections, exact-price review, roster context, alternate-line probabilities and
input issues. An unpriced alternative is never assigned a fabricated price or units result.

## Remaining launch work

1. Validate roster/availability impact, including transfers and newcomers in November. Obtain
   verified current official/conference reports and the configured Playbook access. Absence
   from an injury feed is not evidence of fitness.
2. Complete named professional-book chronology and public/identified split coverage. Qualify
   CBB Moneyline, Spread and Total inference with the shared market-reader owner. Retain one
   final score/probability source and examine harmful as well as beneficial corrections.
3. Calibrate CBB play grades on exact-price chronological evidence; measure promotions,
   demotions and board impact. Do not substitute the EV-maximizing side for a forecast side.
   Current Best Angle/Lean, prices-used-for-units and competitor/ATS/Total hit rates are unproven.
4. Integrate one authoritative leased writer, targeted T-60 refresh, immutable lock writer
   and legacy-first reader, W-L-P tracking and a cached member DTO. No per-visitor model rebuild.
   Exercise the full publication lifecycle privately before requesting owner activation.
5. Fresh-base integration, full verification, protected draft/review, explicit owner approval,
   then deployment and live receipt checks. The feature must remain off until these pass.

Focused CBB tests, TypeScript, ESLint and the full existing `verify:model-change` suite passed.
The optional Market Brain PostgreSQL proof was skipped because its local URL is unset.
There is no production build or live verification claim because no production route or
publication was added. An env flag alone cannot make this partial candidate launch-qualified.

Concurrent-work refresh: remote main advanced to `3e64ed8372d9b70d18254a57479bc1dcbda42040`
while this candidate was built (prediction-market display PRs #848–#850). Those changes do not
overlap the CBB-owned files. Integrate that base before saving the draft and rerun the affected
checks. No shared display, reader, writer or market-brain contract file is changed by this branch.
