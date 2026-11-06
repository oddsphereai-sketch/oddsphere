# CBB publication and settlement deadline

Starting main: `7f15ca4e8069bc30096633d6ccfe3c90776f82cd`.
Branch: `codex/cbb-refresh-headroom-20261106`.

The owner requested working Daily Edge grading and efficient durable collection.
Live verification must include actual cron closure, not only published cards.
No numerical method is changed in this repair.

## Observed failure and bounded correction

The preceding R50 normal run started 19:17:33.635 UTC, published at 19:25:34.788,
and closed at 19:26:06.049 (512.4 seconds total; 31.3 seconds after publication).
Its only reported partial condition was the same three future incomplete
evaluations. All191 stored locked-member payload fingerprints remained exact.

The first normal R51 run started 19:32:33.889, published its complete R7/R11
member board at 19:41:08.315 (514.4 seconds), but its lifecycle still had no
completion at 19:42:25.350. The statically configured route ceiling was 540
seconds. The route executes the existing seven-day settlement loop after board
publication, then closes the lifecycle and releases the shared lease. These
observations are consistent with insufficient remaining execution time; they
are not a claim of a retrieved platform invocation log or a measured settlement
duration for the interrupted R51 run.

The scoped correction sets the same route ceiling to 570 seconds, preserving
the exact ten-minute lease and 30 seconds of separation between the configured
limits. It exposes the distinct operational identifier
`cbb_daily_refresh_runtime_2026_11_06_r2_settlement_headroom` and both budgets in
the existing cron response details. No route, writer, automatic retry, paid
provider poll, schedule, settlement date or source refresh is introduced.

The pinned R7 model/covariance/private artifact, R11/R10 confidence decision and
grade, R51 publisher, R34 adapter and R37 tracking behavior stay exact. The
observed output remains the public record; no source, projection, probability,
price, stake, grade or locked evidence is rewritten for this operational change.
There are zero same-input promotions/demotions or board-count changes.

## Hosting and verification

The installed Next documentation requires a statically declared `maxDuration`;
the production build's `functions-config-manifest.json` must independently show
570 for this exact route. The unchanged 600-second lease must remain configured
on the existing sport-scoped `prediction_pipeline` path. No account or hosting
settings are changed.

The platform supports code-level duration configuration and publishes duration
limits for qualifying plans in its [official duration documentation](https://vercel.com/docs/functions/configuring-functions/duration).
The project's existing 540-second executions do not establish future completion
or independently expose its account settings. Require actual Vercel preview
acceptance and actual production normal-cycle closure; the 570-second ceiling
is not a completion guarantee or a replacement for profiling if work grows.

Required checks: `npm run verify:model-change`, focused existing cron lease and
CBB locked-record tests, TypeScript/production build and generated duration
manifest, clean latest-main integration, protected PR/tree/check verification,
then live commit, unchanged pinned artifact, completed normal writer/settlement
lifecycle, lease release, member/market coverage and191 immutable lock hashes.
The numerical Margin chat agreed to keep its shared docs clean and hold model
publication; it will integrate this operational merge before its own release.

The same nine-sport live audit found one diagnostic false positive: KU ML had
the explicit visible whyLine/riskLine "The payout is too small for an actionable
recommendation." at -20000, but the auditor's existing CBB reason list admitted
only older machine phrases. The exact already-released sentence is now recognized
as an explanation; no price, grade, reason, payload or reader is changed. The
captured KU case, unexplained/generic-copy controls and exact locked/unlocked
payload preservation are tested. On the same frozen491-game/1501-market reader
capture, this corrects one false critical to zero while retaining126 future-price
warnings. It is not a blanket exemption or a promise of good prediction accuracy.

## Limits and rollback

Longer future inference or slow settlement can still reach the ceiling. Do not
claim that the entire site memory incident is resolved by a runtime allowance.
No new concurrency, retained input volume or memory allowance is introduced.
If the next normal run still fails, investigate the measured stage that fails
before changing any model policy or increasing the lease. A protected rollback
changes only this operational contract and must retain all new stored grade
families, locked records and archive-aware readers.
