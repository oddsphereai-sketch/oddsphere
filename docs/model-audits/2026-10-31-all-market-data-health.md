# Daily Edge and Player Props data-health audit — October 31, 2026

Starting production base: `95b9e7f35afa99ea6997ea091b30d22e859c00b5`.
Owner direction: check all statistics, market data, lines and odds across Daily Edge and Player Props and repair confirmed failures.

## Verified production inventory

Read production refresh logs, shared leases, published response payloads, source evidence and active prediction-record releases. Existing SELECT-only audits covered all sports, NFL member health, CFB member health, NBA lock/reader coherence, NHL input health, and NBA/NFL Player Props. A direct official MLB schedule check returned zero games on October 31; its empty board and absent props are expected, not a reason to fabricate a slate.

The owner confirmed the MLB season is over. The current MLB member props reader is already date-scoped and has no current board. Remove the legacy `/api/lab/player-props` automatic latest-slate fallback so empty/offseason dates cannot resurrect historical props. Explicit historical date requests remain available and no stored prediction, lock or evidence is changed. Replace the MLB empty page's misleading loading promise with a truthful no-props state. A mocked route regression exercises an empty date alongside an available historical slate and verifies exact-date historical access without any write operation.

- NBA: seven current games, 21 priced market records, seven coherent lock candidates; current ratings fetched October 31. The rolling board additionally contains future fixtures whose books have not opened. Those schedule-only fixtures explain the unmatched far-slate warnings.
- NHL: ten current games, 30 priced markets, current 2026 provider statistics with 11–15 completed games per team, roster and goalie evidence, and successful refreshes.
- WNBA: one current game and three complete prices under `wnba_v1_8_owls_current_odds`, with the registered distribution and grade contract retained.
- NFL Daily Edge: 14 weekly games / 42 markets, 39 upcoming markets, zero upcoming missing prices, zero holds, zero missing trails, and no critical/warning findings from the authoritative snapshot health audit. Source evidence remained within its 90-minute contract.
- CFB: 100 weekly games / 300 forecasts; all FBS-involved markets priced. Five missing upcoming FCS selected markets remain across VMI–Chattanooga, Nicholls–McNeese and Delaware State–Norfolk State. Current Owls conventional-book pairs are captured in the grade-only lane, but the standing r57 policy explicitly disallows an Owl-only paired-context fallback. The approved primary fallback is reserve-limited. This audit does not silently expand source/model authority or override that qualification rule.
- CBB: 16 upcoming stored cards / 48 priced markets; no missing current selected prices. Current named-book/public split absence remains truthful, as specified by its staged launch contract.
- NBA props: seven games, 87 current player feature rows, 619 decisions, no zero independent/final projections, and fresh current-state evidence.
- NFL props: 2,559 internal rows / 1,491 canonical member rows, no duplicate canonical line scopes. The 1,363 upcoming canonical rows have valid prices and probabilities. All 361 null count projections are binary Anytime TD rows; every ordinary count/yardage market has a projection. The board and current-season state refresh under the existing NFL lease.
- EPL/UCL: confirmed source-mapping and freshness defects described below. Soccer source statistics remain under their dedicated BALLDONTLIE competition namespaces and validated historical foundations.

## Confirmed soccer defects and repair scope

1. Owls now supplies official `btts` and `double_chance` vectors, but the adapter only admitted `h2h` and `totals`. Retain these already-supported official market types with their original named book, timestamp, prices and event identity. Existing complete-vector and exact-line checks remain authoritative. No additional provider request is introduced.
2. UCL's exact alias roster omitted `Man Utd` and `Calcio Como 1907`. Add verified equivalences to Manchester United and Como, plus the canonical/full-name Feyenoord equivalence. Keep exact club matching; do not introduce prefix guessing.
3. UCL's separate stored-quote fallback had no age limit. Apply the existing shared soccer 30-minute / one-hour / six-hour freshness windows, reject future-dated receipts and opening-only rows, and retain original timestamps. No historical quote becomes a fresh current price.
4. A single unavailable UCL market blocked every other card from refreshing; the live snapshot had stopped at October 29. Publish complete forecasts and current markets while explicitly retaining missing-price markets as Held/No Play. A missing price without the explicit hold is a hard error. Whole-board quote collapse, incomplete fixtures/markets, PMF incoherence and nonpositive-EV actionables still fail closed. Locked snapshots retain exact prior precedence.

The affected source/model/calibration/member release family is registered in `docs/current-model-releases.md`. Independent score equations, coefficients, grade thresholds, stake rules, provider request ceilings, the 1,000-credit reserve, schedules and the single sport-scoped writer lease do not change. No replacement writer or production shadow path is added.

## Frozen-source board impact

The paired replay holds the captured Owls response, current BDL statistical inputs, durable history, timestamps and existing locked payloads fixed. It makes zero paid Odds API requests and writes no production data. The incumbent replay includes its original unbounded UCL stored fallback; the candidate includes the freshness repair.

| Cohort | Current prices before → after | Actionables before → after | Promotions | Demotions | Forecast-side changes |
| --- | --- | --- | --- | --- | --- |
| EPL, 40 markets | 21 → 39 | 4 → 9 | 5 | 0 | 0 |
| UCL, 72 markets | 68 → 49 | 12 → 7 | 1 | 6 | 2 |

EPL probabilities are unchanged. Four UCL probabilities and two UCL sides change through the existing reader when the missing club aliases admit current named-book evidence. Six UCL actionables step down because their old prices are stale or their current exact-price economics no longer qualify; the same existing policy also promotes the newly recovered eligible BTTS row. This is an explicit data-correctness impact, not a new demotion threshold or an undisclosed board contraction. Existing locked payloads remain byte-authoritative in both paired outputs. The underlying forecasts remain visible for all 112 markets; no unavailable price is synthesized.

Full transitions and input hashes: `2026-10-31-all-market-data-health-replay.json`. Captured receipts, full replay inputs/outputs and the zero-write replay runner are retained under `/tmp/oddsphere-health-*-20261031*` for this work session. No production credential was exported.

## Account dependency

The existing no-write production UCL provider probe acquired `prediction_pipeline:soccer`, evaluated all 18 fixtures, and reported zero paid requests because the account has **947 credits**, below the protected **1,000-credit reserve**. It also reported unpublished supplemental events. The reserve is preserved. Current source gaps must remain explicit until provider coverage or the credit balance recovers; this repair cannot create an unavailable exact-2.5 quote.

## Verification and publication

Focused source tests cover both new official market keys, exact aliases and near-name rejection, wrong orientation/time, incomplete vectors, provenance and timestamp retention. UCL tests cover stale/future stored receipts, honest partial-price publication, dishonest missing-price rejection and total-price-collapse protection. Existing locked writer/reader tests remain required.

Required publication gates: focused EPL/UCL suites, `npm run verify:model-change`, TypeScript, focused ESLint, production build, clean latest-main integration safety, protected PR checks, remote/local tree equality, and post-deploy production writer/release/source-age/coverage/lock verification. Do not claim that reserve-limited markets have recovered merely because a deployment succeeds.

Pre-publication results: the full model-change suite, focused soccer/locked-record suites, MLB empty-slate regression, TypeScript, focused ESLint and final webpack production build passed. The unrelated NFL Market Brain PostgreSQL proof was skipped locally because no test database is configured; this candidate changes none of that workflow's SQL/runtime paths. Remote main remained the recorded starting base. Open-PR overlap review found documentation-only intersections with #877, #811, #676 and #606; this candidate preserves the newer main registry/policy and adds its own bounded release record, without importing those older branches or changing their runtime scope. Main protection requires `current-main-ancestor`, strict up-to-date branches, and administrator enforcement. Protected checks and live proof remain publication gates.

Rollback the complete October 31 soccer provider/model/calibration/member family together to its October 28/20 predecessors for future unlocked rows only. Never rewrite or reconstruct an existing immutable lock.
