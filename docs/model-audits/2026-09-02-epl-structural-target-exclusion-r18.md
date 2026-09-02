# EPL r18 structural target exclusion and coherent PMF

Status: production candidate; not published. Registry integration, fresh-main safety, deployment, and live verification remain root-owned.

Starting base commit: `4f84cf57d8e664ac78897f1fcd7820bc639efdf4`

Starting base tree: `ee9c46523c50e71c1923ae9859a20cb9d40afe02`

Final integration base: `8f27adf0307999a0c36048037c510fc618f02a24` (NFL forward-evidence and MLB props deltas; no EPL task-file overlap). The shared release registry changed upstream but remains unedited on this branch pending root's EPL integration hunk.

Champion: `epl_goals_coherent_2026_08_20_r16` / `epl_grade_policy_2026_08_20_v21`

Candidate: `epl_goals_coherent_2026_09_02_r18_structural_target_exclusion` / `epl_grade_policy_2026_09_02_v23_positive_forecast_ev`

Pure contract: `epl_coherent_market_outcome_2026_09_02_r2_structural_target_exclusion`

Evidence schema remains `epl_forward_evidence_capture_2026_09_02_r1`. The writer, shared `prediction_pipeline:soccer` lease, refresh cadence, provider-call budget, lock reader, member surfaces, tracking vocabulary, and stake behavior remain unchanged.

## Structural correction

The incumbent r16 Total head includes the same selected evaluated Total book at 75%. Its BTTS head is inferred from the selected evaluated Match Result and Total pair, so the evaluated-book information can validate itself again through exact-price economics. The frozen r1 pilot reproduced both identities on all `10/10` games. It also found `6/7` incumbent actionable Total/BTTS rows had negative forecast-side exact-price EV.

r18 removes that loop. One Dixon-Coles score PMF produces full-precision decimal xG, likely and representative scores, three-way Match Result including draw, exact Double Chance sums, Total 2.5, and BTTS. The evaluated Match Result, Total, and BTTS canonical books are excluded book-wide from forecast evidence and retained only for downstream economics. Direct BTTS, evaluated prices, movement, public evidence, and Circa reporting never enter this posterior.

The identity baseline is the independent club PMF. A contextual Total constraint may apply only from already-fetched exact-2.5 vectors when all of the following are true: same fixture/provider event; complete two-sided named-book quote; both timestamps known, predecision, prestart, no older than 15 minutes, and no more than 60 seconds apart; at least two target-excluded observations; unanimous direction; distinct exact quote signatures; and distinct conservative evidence families. Named originators have their own auditable family. Because the provider supplies no independent ownership/feed lineage for other books, every non-originator from that provider belongs to one conservative provider family. Unknown or correlated family evidence therefore returns the independent PMF exactly. There is no fitted blend coefficient, source weight, fabricated split, quota, or cross-book movement join.

If qualified, a deterministic Total tilt operates within fixed home/draw/away result strata. It therefore holds all Match Result marginals fixed and Double Chance remains their exact sum. Any invalid mass, residual, target, or gate returns the independent PMF exactly. Missing optional evidence is identity-neutral and never flattens the forecast.

Grades are downstream. The forecast side is priced at its exact evaluated quote; every Best Angle or Lean now requires strictly positive forecast-side EV. Existing probability, edge, and price thresholds remain unchanged. A row that clears an existing threshold but has nonpositive EV becomes Watchlist with a truthful existing reason field. The maximum-EV side remains an audit comparator and never changes the forecast.

## Frozen current replay

The read-only replay uses the exact retained prospective r1 landmark `2026-09-02T12:38:05.049Z` for game IDs `58431`–`58440`. It reads only Match Result prediction snapshots and does not query outcomes, results, settlements, closing prices, or a provider.

All ten games selected the exact independent PMF: eight had two retained Total alternatives, but all 16 were one conservative `sharpapi:non_originator` family; two games had no retained target-excluded Total vectors. Source classes were 14 named retail and 2 named other. Maximum evidence age was `67,256 ms`; maximum within-vector skew was `0 ms`. Singleton authority was zero. The capture reported 101 exact same-book movement vectors, zero authentic public-evidence slices, and one Circa vector across the four markets; all remained reporting-only with zero posterior weight.

Match Result probabilities changed on `0/10` games and Match Result sides on `0/10`. Double Chance sides changed on `0/10` and remained exact pairwise sums. One Total forecast side changed, from Over to Under on `MAN@EVE`, with an exact `+123` quote available for the new side. BTTS forecast sides changed on `0/10`. The separate maximum-EV comparator changed on three BTTS rows.

| Market | r16 BA / Lean / Watch / NP | r18 BA / Lean / Watch / NP | Tier promotions / demotions | Actionable promotions / demotions | Exact quote coverage |
| --- | --- | --- | --- | --- | --- |
| Match Result | 1 / 5 / 0 / 4 | 1 / 3 / 2 / 4 | 0 / 2 | 0 / 2 | 10/10 |
| Double Chance | 0 / 0 / 6 / 4 | 0 / 0 / 6 / 4 | 0 / 0 | 0 / 0 | 10/10 |
| Total | 0 / 3 / 3 / 4 | 0 / 3 / 4 / 3 | 3 / 2 | 1 / 1 | 10/10 |
| BTTS | 0 / 4 / 4 / 2 | 0 / 2 / 6 / 2 | 1 / 4 | 1 / 3 | 10/10 |
| Overall | 1 / 12 / 13 / 14 | 1 / 8 / 18 / 13 | 4 / 8 | 2 / 6 | 40/40 |

The natural actionable promotions are `SUN@BRE Over 2.5` at `56.65365322319875%`, `-116`, `+5.493009450094233%` exact forecast-side EV and `SUN@BRE BTTS Yes` at `57.20196230298319%`, `-114`, `+7.379122217880729%` EV. The six actionable demotions are two Match Result, one Total, and three BTTS rows whose exact forecast-side EV is nonpositive. All nine surviving actionables have strictly positive exact-price EV. Best Angle, Lean, Watchlist, and No Play all remain naturally represented; no row is added to meet a count.

The candidate's decimal xG and score summaries change wherever r16 used its evaluated-book-derived goals fit, but every candidate projection is derived from the same PMF as its four market heads. Maximum Match Result residual is exactly zero across the ten games.

## Forecast-quality evidence

The ten-game pilot is not yet settled, so it has no proper-score result and is not called a holdout. The only settled historical diagnostic was opened in prior research and has six games (`51843`–`51848`). Its stored archive can reproduce MR/DC, for which r18 is identical to the independent champion: MR multiclass Brier `0.507134`, log loss `0.875303`, accuracy `0.833333`; DC mean one-vs-rest Brier `0.169045`, log loss `0.519258`, accuracy `0.722222`. The archive does not retain the raw independent Total/BTTS PMF or timestamp/source state required to reconstruct r18, so candidate Total/BTTS proper scores are unavailable rather than synthesized. The already-opened six-game champion scores were Total Brier `0.231198`, log loss `0.654379`, accuracy `0.500000`; BTTS Brier `0.244392`, log loss `0.681937`, accuracy `0.500000`.

This evidence proves the structural self-reference removal, exact fallback, coherence, downstream economics, natural promotion and demotion paths, and board shape. It does not independently establish a Total/BTTS predictive lift. Publication must therefore be judged as a narrowly bounded provenance correction, not a newly calibrated market-trust model.

## Operational invariants

- `epl-daily-refresh` and `epl-pregame-lock` remain the sole production entry points and keep the shared soccer prediction lease.
- Current Total vectors are reused from the already-fetched Sharp fixture result. There is no new provider call, query, table, write, cron, cache, or writer.
- The prediction-record read is broadened in place so any older-release locked row blocks a new-release write before capture merge or upsert.
- Existing locked member snapshots and exact stored projections/prices remain authoritative. No reader precedence changes.
- The bounded r1 capture, exact same-book movement semantics, public/Circa provenance, and retention caps remain byte/number-identical.
- Root owns the `docs/current-model-releases.md` integration hunk.

## Reproduction and gates

- `npx tsx scripts/operator/audit-epl-structural-target-exclusion-r18.ts`
- `npx tsx scripts/test-epl-coherent-market-outcome.ts`
- `npx tsx scripts/test-epl-shadow-model.ts`
- `npx tsx scripts/test-epl-forward-evidence-capture.ts`

Validation on the candidate:

- three focused EPL suites: pass;
- `npx tsc --noEmit --pretty false`: pass;
- focused ESLint over all changed TypeScript: pass;
- `npm run verify:model-change`: pass;
- `npm run verify`: pass;
- ordinary `npm run build`: isolated-worktree Turbopack dependency-root failure before compilation;
- `npx next build --webpack`: pass, including TypeScript and 105 static pages.
- repository-wide `npm run lint`: pre-existing baseline failure outside this task boundary (`1,551` findings: `1,305` errors and `246` warnings); focused changed-file ESLint remains clean.

Fresh-main integration safety is run from the final clean commit and remains a prerequisite to root publication.
