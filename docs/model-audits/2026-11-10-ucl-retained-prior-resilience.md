# UCL retained ability and paid-stat updates

## Problem, scope and resulting model

The owner requested normal Champions League updates without one website blocking
the pipeline, while preserving forecast quality and using the existing paid
statistics. BALLDONTLIE subscriptions cover UCL and EPL only. R22's mandatory
ClubElo HTML request receives HTTP403 and aborts before odds/forecast publication.
The last successful production refresh was November5 at22:17UTC. The normal card
continuity repair preserved saved forecasts and original clocks, but did not
repair prediction refreshes.

R24 keeps genuine verified ability information as an explicitly dated model
prior. Existing paid UCL regulation goals/xG update the same opponent-adjusted
goal likelihood. As that original information ages, rated-club Gamma prior
precision decays by `2 ** (-sourceAgeDays / 365)`, using the existing relevance
horizon. Its mean, frozen coefficient, four-match exposure basis and original
source metadata remain exact; generic unrated cohort precision is unchanged.
The source date is November4, not a claimed new daily observation. No ClubElo
request occurs in the active path, and no age cutoff makes that website a
required recurring input. Future model revisions must version any prior update.

Model: `ucl_goals_coherent_2026_11_10_r24_retained_ability_paid_ucl_updates`.
Grade era: `ucl_grade_policy_2026_11_10_r27_retained_ability_paid_ucl_updates`.
Prior: `ucl_retained_ability_prior_2026_11_10_r2_original_2026_11_04`.
Coherent market reader R15, projected-score contract R13, member lifecycle R27,
writer R1, exact grade/price/stake rules and sole `prediction_pipeline:soccer`
writer/lease/cadence are unchanged. Other sports and the EPL model/data path are
unchanged. All four UCL markets still derive from one final joint distribution.

## Provenance and availability

The versioned prior artifact derives58 club/provider identities and values
exactly from the already verified original source, with no outcome refit:
`https://clubelo.com/`, asOfDay2026-11-04, captured2026-11-04T14:33:00Z,
original page SHA256
`3cddd29ed3ed2d06e2c59f682995b369aaf1c2b61e459f66b6d4a2e21a33bd48`.
Its coefficient0.6748444915670129 remains the frozen147 strictly pre-match
original2024-pair fit. The artifact was derived2026-11-10T16:53:03.215Z;
object SHA256
`696226ae1ce5663852f244867140a6ac11b10e330af166fb69de7874e3566d88`.
The original R22 audit/source object is not loaded as a live fallback and its
strict two-day validator is not weakened. The new artifact has a new statistical
meaning, identity, explicit old observation date and declining precision.

Runtime checks the exact artifact hash, original metadata, coefficient, finite
unique identities and current provider-name mappings. All current36 clubs must
be covered. The full frozen reference population is retained, so a changed
lookup cannot silently re-center known versus generic priors. Corruption,
conflicting clubs and missing current identities fail without publication.
No raw mirror, provisional continuation or fabricated club rating is admitted.

Source observation, artifact derivation, paid-stat completion and future kickoff
are separate clocks. Source must precede derivation; derivation must precede
completed input availability; completion must precede kickoff. Elapsed rows
remain historical display scaffolding, ineligible for new current-release
writes. R22/R25, R21/R24 and R7 comparator calls retain their exact old stamps.
New R24 evidence uses `retainedAbilityPrior`, not a falsely current
`currentStrengthPrior` receipt. It records original source/date/hash, artifact
identity/derivation, actual paid completion, source age, precision and rated sides.

The existing licensed UCL collection, historical manifest, caches, provider
budgets and bounded fit remain authoritative. The58-club model artifact adds
no growing cache, provider call, timer or independent writer. No new paid AI or
domestic subscription is required. Existing source failure behavior still
preserves the last coherent board when paid data or identity/coherence fail.

## Accuracy audit and rejected alternative

Before implementing this design, an unchanged UCL/EPL stats-only candidate was
evaluated offline. It improved the historical R7 comparator on a125-match
2022 confirmation but lost genuine non-EPL ability information: Barcelona's
current independent win forecast fell roughly87%→68%. That does not establish
maintained R22 quality. PR1092/R23/R26 is closed, unmerged and never deployed.
Its original/mixed results and sources are retained offline, not revived under
R24. An initial odds replay had a full-name/short-name mismatch; its counts are
superseded by the exact-provider-ID replay below. No live record changed.

The retained-prior method and365-day precision rule were declared before its
evaluation. There is no subsequent tuning. Historical evaluation uses only
the original2025-06-01 archived ratings; the archive owner's documented later
provisional continuation is excluded. That archive is an offline test source,
never a runtime input. Its raw SHA256 is
`1bbd3f8b171407483cf6e0a5a37fa983b9e9bf53a62a92f537bbe40d7dbb36f1`.
Current source provenance comes from the separately attested original page.

The126-row2025 calibration and63-row chronological confirmation were already
opened during earlier research. They are retrospective diagnostics, not a new
untouched holdout or a claim of R22 superiority. Present provider-vintage stats
use strict earlier-fixture exclusion; native historical receipt clocks and
locked-price ROI are unavailable and are not invented. On confirmation:

| Metric | Same retained mean, full prior precision | Age-aware precision |
| --- | ---: | ---: |
| MR Brier (mean over3 outcomes) |0.185789|0.184789|
| MR log loss |0.941144|0.934943|
| Winner accuracy |38/63|39/63|
| Total Brier |0.214136|0.212186|
| Total log loss |0.616837|0.613173|
| BTTS Brier |0.233653|0.233460|
| BTTS log loss |0.659729|0.659674|
| Mean absolute team-score error |1.143451|1.140695|

Calibration MR/Total/BTTS Brier:0.177609/0.226022/0.246777;80/126 winners.
On nine actual R22-era matches, the matched independent R22 formula versus
age-aware formula gives7/9 winners each and MR Brier0.1450045→0.1450057,
Total0.1093599→0.1093524, BTTS0.1458553→0.1458724. Small adverse changes are
retained, not called improvement. Published final R22 market-read forecasts
are a different comparator and are not blended into these independent results.
Forward results must remain separated by R24/R27 and actual lock time; the
prior's age and sparse UCL evidence remain limitations, not calibrated certainty.

## Exact current-board consequence

The corrected offline replay uses all18 exact provider IDs, the original real
16:31 odds captures and a16:54 logical audit clock after prior derivation.
Every fixture lookup is checked; zero misses, zero network calls and zero
production writes. Both independent forecasts use identical observed offers,
existing grade rules and source evidence. The incumbent component is the
actual saved R22 `nativeGoalMarketRead.before` rate pair; it is not a fabricated
current R22 website fetch. The candidate uses the58-club retained prior and446
licensed regulation-result training rows. This is a counterfactual functional
replay, not a backdated public prediction or performance result.

Before and after: MR2Lean/11Watchlist/5NoPlay; Total1Lean/3Watchlist/14NoPlay;
DC18NoPlay; BTTS18NoPlay. Zero promotions, zero demotions, zero side changes,
and all selected prices unchanged. Maximum primary selected-probability change
0.00700192; maximum expected team-goal change0.02601063. Barcelona87.1864%→
87.1124%, retaining NoPlay at the captured−1118 quote. No steep-favorite Best
Angle or play quota is introduced. Existing focused paired value/path/confidence
qualification and adverse/cleared-path controls remain required.

The real current feeds price22/72 selected contracts and62/180 outcomes;
50 markets are explicitly held pending usable prices. These are operational
source exceptions, not completed wager evaluations. Prediction coverage18/18,
market coverage72/72, PMF/coherence and qualified-actionable errors are zero,
with no price collapse or unlocked price regression. Normal refresh can publish
complete predictions while waiting for individual markets to open, using the
existing publication contract and honest quote timestamps.

## Release verification and rollback

Tests must prove artifact/source derivation, wrong/corrupt/missing identity
refusal, zero external requests, precision decay, exact original math at unit
precision, contradictory-history updates, neutral symmetry, source/derivation/
completion/kickoff ordering, shared all-market law and release separation.
R22 writer/reader tests require zero locked replacement writes and exact full
stored market payload precedence. Older probabilities, projections, picks,
grades, prices, stakes, evidence and tracking are never rewritten.

Required before merge: full model gate, focused UCL/member/tracking tests,
type/lint/build, clean fresh-main integration, protected up-to-date PR checks
and exact locally verified remote tree. The unchanged local full gate encounters
missing original external CBB admission artifacts when an existing v8 dataset
activates that optional replay. No fixture/test is hidden, moved, fabricated
or edited. The same full command runs on the standard clean CI runner; it
must pass, and that run must not be described as reproducing the unavailable
external CBB admission dataset. No CBB behavior changes.

The first PostgreSQL CI run exposed an import coupling: the new pure model
loaded the legacy database-backed foundation just to normalize club names.
The exact existing identity function now lives in a pure module, with the
legacy foundation retaining its re-export. No identity or forecast value
changes. A child-process regression imports the model with database credentials
explicitly absent; affected NFL recovery and UCL tests must pass before release.

After merge verify actual production commit, R24/R27 canonical completed
refresh, source evidence, all current card/record/PMF/price/grade tuples,
historical lock hashes, then the next natural refresh/targeted sweep. A preview
or local replay alone does not prove normal production is restored. Roll back
future unlocked R24 publication on source/identity failure, unexplained board
contraction, writer overlap, lock mutation, publication failure or reader/record
disagreement, preserving every era's locked record.

Base: `55e8457a992a3e761839943f5e59f33e18f27483`. Predeclaration and exact
offline source/evaluation/replay evidence are retained under
`/private/tmp/ucl-retained-prior-offline-audit-20261110` and corresponding
`/private/tmp/ucl-retained-prior-*-20261110.json` reports. No live shadow model,
prediction, grade or database artifact is deployed by those audits.
