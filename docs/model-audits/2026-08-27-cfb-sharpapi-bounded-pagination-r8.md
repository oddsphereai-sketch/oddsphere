# CFB SharpAPI bounded exact-event pagination — r8

## Scope and predeclaration

- Sport/markets: CFB Moneyline, Spread, and Total exact-price evidence only.
- Model and grade policy remain `cfb_v1_independent_score_model_2026_08_25_r1` and `cfb_v1_composite_grade_policy_2026_08_25_r1`; coefficients, PMF, thresholds, sides, grades, stakes, and tracking eligibility rules are unchanged.
- The sole authoritative path remains `/api/cron/cfb-forward-evidence` under the shared `prediction_pipeline:cfb` lease. No reader call, second writer, manual cron, or database backfill is added.
- Behavioral release stamps advance to Sharp fallback r2, collector r6, member r5, writer r7, and decision r8 because completing a provider event can change which exact named-book tuple is available.

## Production incident

PR #227 deployed the strict exact-event named-book fallback. The first natural post-deploy wake was `data_refresh_log` id 78891 at `2026-08-27T11:54:42.706Z`. It failed closed at `11:54:44.635Z`, before any append, with:

`CFB SharpAPI event ncaaf_ncstatewolfpack_virginiacavaliers_2026-08-29_b2 exceeded the 200-row safety cap.`

The last complete prior member wave remained live. There were zero partial r7 rows and no mixed release.

## Correction

SharpAPI documents offset pagination for `/odds`. The exact-event fallback now:

1. retains the same strict schedule-derived event ID and team/start-time validation;
2. requests at most 200 rows per page;
3. follows only a strictly increasing documented `next_offset`;
4. permits at most four pages (800 rows) per exact event;
5. remains inside the existing 96-request whole-run hard cap; and
6. fails the entire append on malformed data, a missing/repeated offset, a fifth page, or global budget exhaustion.

All pages are normalized together before selecting a named-book two-sided pair. No partial page can become a published price.

## Decision and board impact

The deterministic SJSU-USC fixture remains unchanged from the qualified r7 candidate:

- Moneyline: internal unavailable tuple / public reasoned No Play; USC outcome forecast and PMF score context remain visible.
- Spread: USC -38.5 at BetMGM -110, evaluated No Play.
- Total: Under 60.5 at BetMGM -110, Best Angle.

Candidate impact remains 23 evaluated decisions plus one internal unavailable market: 2 Best Angles / 2 Leans / 11 Watchlists / 8 evaluated No Plays / 1 unavailable, rendered publicly as 2 / 2 / 11 / 9 / 0 Held. Promotions and demotions relative to the r7 intended board are 0 / 0. The correction only allows the already-versioned exact-event input contract to finish for a provider event larger than one page.

## Required verification

- Focused pagination tests must prove exact two-page reconstruction, identical normalized tuples, strictly increasing offsets, the four-page circuit breaker, the global request cap, and malformed-offset failure.
- `npm run verify:model-change`, CFB production/weekly tests, TypeScript, ESLint, production build, diff check, and integration safety must pass on fresh current main.
- After protected deployment, the next natural scheduled writer wake—not a manual invocation—must complete a full current release wave. Live member QA must show SJSU-USC Total as the market prediction `Under 60.5` with model total 55.5 only secondary, Bet Grade Best Angle separately, Spread USC -38.5 -110, and Moneyline No Play without suppressing the USC forecast.
- Odds movement must remain exact same-book and chronological. A market with no earlier capture at the evaluated sportsbook must say current-only; it must not manufacture an opening quote from another book. Later same-book captures must extend the trail.
