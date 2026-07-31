# MLB player props r18: batter doubles residual Best Angle

Date: 2026-07-30
Candidate release: `mlb_props_2026_07_30_r18`
Affected market: `batter_doubles` only
Authoritative writer: existing MLB props board refresh under the shared
`prediction_pipeline` lease

## Decision

Implement the mature batter-doubles Under residual signal as a Best Angle. Do not change any
other market, writer, stake size, provider, or refresh schedule.

The release adds an absolute value gate; it does not fill a quota:

- model side: Under;
- model probability at least 52%;
- model-minus-market edge at least 0.5 percentage points;
- expected value at least 0.5%;
- decimal price at least 1.25;
- existing global signal price and data-health gates must also pass.

## Fully time-forward evidence

At each evaluation block, the model and gate were selected using only completed earlier
blocks. A market was not promoted until it had at least 20 prior out-of-sample bets and more
than 2% prior out-of-sample ROI.

| Evaluation block | Bets | Record | Units | ROI |
| --- | ---: | ---: | ---: | ---: |
| July 8–12 | 10 | 10–0 | +2.604 | +26.04% |
| July 16–23 | 48 | 40–8 | +3.383 | +7.05% |
| July 24–29 final holdout | 4 | 4–0 | +1.037 | +25.93% |
| Total promoted sequence | 62 | 54–8 | +7.024 | +11.33% |

The 62 bets span 35 game/date clusters. A deterministic 20,000-draw cluster bootstrap
produced:

- median ROI: +11.60%;
- 95% interval: +2.65% to +22.20%;
- probability of positive ROI: 99.56%.

Probability performance also beat the no-vig market:

- rolling Brier wins: 4 of 4 folds;
- final market Brier score: 0.155555;
- final residual-model Brier score: 0.154867.

## Why this is a model change, not a threshold change

Replaying the same gate against the probabilities already locked by releases r6, r7, r9,
r11, r15, r16, and r17 produced 31 bets at -6.72% ROI. The predictive advantage comes from
the new market-residual probability, not from relabeling the existing probability.

The fitted 50-stump research model collapses exactly to nine deterministic splits. Runtime
inputs are all already available from the market pair and prior MLB game logs:

- no-vig market probability;
- last-five plate appearances;
- last-five and season RBIs;
- last-ten runs;
- last-20 and season walks;
- last-20 doubles-over-line rate.

No paid data, provider request, runtime trainer, independent writer, or new cron is added.

## Promotion/demotion and board impact

- July 24–29: 4 doubles Best Angles promoted, 0 existing actionables demoted, net +4.
- July 30 r18 full-slate dry run: 0 doubles promoted because no row cleared the absolute
  gate; 0 demoted; net 0.
- July 30 complete board: 32 actionables under both r17 and r18.
- Non-doubles decision differences in the paired dry run: 0.

The rule therefore expands the eligible candidate pool when value exists and does not flatten
the board when it does not.

## Runtime and release safety

- Release identifier bumped from r17 to r18.
- Doubles market version bumped to
  `batter_doubles_market_residual_v1_validated_under_best_angle`.
- Recovery/actionability policy bumped to
  `mlb_props_actionability_recovery_v5_2026_07_30`.
- The exact runtime artifact reproduced the final locked replay:
  4 bets, 4–0, +1.037140 units.
- Full-slate dry run:
  - 2,196 rows;
  - 6 games;
  - 17 markets;
  - 0 stale rows;
  - publishable;
  - no errors;
  - 11,325,765 JSON bytes / 576,116 gzip bytes;
  - `persisted: false`.
- `npm run verify:model-change`: pass.
- `npm run test:mlb-props-engine`: 357 passed, 0 failed.
- TypeScript `--noEmit`: pass.
- Focused ESLint: pass.

## Deployment status

Implemented and verified in the isolated branch
`codex/mlb-props-residual-r18`. It has not been committed, pushed, deployed, or written to
production. Production must not be called r18 until a clean intentional commit is deployed
and the live release identifier, lease health, provider coverage, snapshot coherence, reader
snapshot, and next lock sweep are verified.
