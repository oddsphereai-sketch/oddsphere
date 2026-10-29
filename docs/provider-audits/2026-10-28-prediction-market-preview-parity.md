# Prediction-market chart: preview parity and pre-lock boundary

Starting production base: `80a0154c73cc4729f5f2603bc204ee4e6c03462f`.

Owner-directed scope: only the prediction-market panel, its display-only
Kalshi history capture, and regression tests. Sharp Book Splits, Public
Consensus, reader layout outside this panel, model readers, forecasts,
probabilities, picks, grades, stakes, tracking, and lock writers are unchanged.
All sports and supported full-game markets use this shared panel. No prediction
or calibration identifier changes because there is zero model behavior/input
change; promotions, demotions, and actionable board-count deltas are zero.

## Visual contract

The prior release deliberately dashed all connectors spanning more than fifteen
minutes and used the earlier source start. It did not match the owner's approved
continuous mint/violet chart. Both series now use one common covered time range,
the same bounded monotone geometry, restrained gradient fills and endpoint dots.
No dotted/dashed paths or permanent turning-price labels remain.

At a shared boundary an already observed value can be carried forward as a
**plot-only guide**. No receipt is created, dated differently, interpolated into
the source array, or used as an actual price in the tooltip. No source is extended
backward before its first receipt. A short caption identifies the curves as
connections between recorded quotes. The original earlier book observations
remain available to the full same-book movement summary, including round trips.
One observation stays one observation, not an invented price trend.

Kalshi's rolling eight-hour retention was discarding genuine morning history
while the book reader retained a full day. The display feed now retains and
backfills 24 hours, still bounded to 100 live / 96 historical actual observations
per contract and the existing 1.5 MB feed ceiling. Bounded sampling retains the
earliest/latest real receipt instead of dropping the start on each refresh.
History release: `kalshi_display_candles_2026_10_28_r3_shared_day_window`.

The existing sole five-minute display cron remains the only capture path, under
its unchanged sport lease. Public history still makes at most three requests per
sport/cycle: six contracts times 1,440 minute candles stays below the 10,000-candle
batch limit. At most eighteen contracts are backfilled per cycle, oldest-checked
first, rotating rather than repeatedly favoring the same game. No new timer,
per-member provider request, OWLS request, or SharpAPI request is added. No split
collector or split-refresh behavior is modified.

## Lock contract

The exact published `lockedAt` bounds both Kalshi and book observations; game
start is a conservative boundary if a lock timestamp was never stored. A locked
row with neither provable boundary fails closed. Stored locked book evidence
retains precedence; a live book cannot replace an absent or present locked trail.
Faster post-lock Kalshi receipts cannot advance the chart or headline. Current
rolling 24-hour volume is omitted on a locked reader because no locked volume
receipt was stored. The panel labels the display-only reconstruction **Pre-lock
history**; it is not represented as a newly persisted member prediction record.

Every existing locked member payload remains unchanged. This change never
persists, reconstructs, or replaces any locked projection, probability, pick,
grade, price, stake, or evidence field. Original quotes and timestamps are the
only tooltip values. Historical candle backfill remains independent display
context and can supply previously missing pre-lock history, not overwrite a
stored member field. There is no new locked-record writer.

## Required proof

- Focused display, market-contract, same-book comparison, sparse-curve math and
  preview-parity tests; true shared start/end coordinates, one continuous path,
  no overshoot, exact original timestamps, no post-lock advancement, immutable
  locked-book precedence and fixed request bounds.
- Cross-sport published-reader rehearsal, shared reader/locked regression,
  TypeScript, lint, full model-safety suite and production build.
- Fresh-main integration safety, no overlapping uncommitted/open-PR files,
  protected up-to-date PR, exact remote/local tree identity, deployment and
  actual desktop/mobile verification after merge. Never claim a preview is live.

Rollback is a new protected PR reverting this isolated change if the panel
mislabels a market, changes a stored field, shows a post-lock quote, increases
the three-request cap, or fails source-preserving rendering checks.

## Local evidence

The stored production-reader rehearsal checked 303 book trails and 305 matched
prediction-market panels across MLB, NBA, NHL, EPL, UCL, NFL and CFB. All 118
available paired comparisons had identical guide edges; 47 locked panels showed
no post-lock observations. WNBA had no current games, so it is covered by shared
synthetic-contract tests rather than a claimed live fixture. Missing source
coverage is not fabricated or counted as a matched pair.

A SELECT-only MIA@ATL rehearsal plus one public historical batch recovered
genuine morning spread-contract history. The resulting common start was
14:45:38 UTC, with the exact stored Circa `-110 → -105 → -110` round trip.
No feed refresh, model run, member-snapshot write, or split write occurred in
that rehearsal. The actual production-built reader was visually checked at
1280px and 390px; both used continuous aligned paths under the unchanged splits.
