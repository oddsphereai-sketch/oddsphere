# Stable prediction-chart source and full line history

Starting production base: `9e4402d9385a46102bab3cae99d1e18fd1b4ecca`.

Owner-directed display repair only. Keep the existing compact mint/violet
comparison and normal source legend; no source-change warning paragraphs.
Splits, models, predictions, provider capture and internal market readers are
not changed.

## Behavior

- Pin the actual sportsbook per exact event/start/market/selected side in the
  browser session. Changing a handicap does not discard that source preference.
  Session storage contains only bounded source identifiers, never quotes or keys.
- Ask the existing SELECT-only reader for the pinned source. Keep it through
  the normal five-minute receipt stagger, up to 15 minutes from the actual
  source observation. Beyond that, an actually fresher eligible fallback may
  replace it. Missing pins can fall back; stale alternatives cannot win merely
  through a new source label. A recovered higher-ranked book does not cause a
  hop back while the replacement is healthy.
- Each resulting trace contains only the selected book's actual observations.
  No old-book samples are joined to a fallback book. The ordinary legend
  identifies the actual source; no extra change paragraph is added.
- Separate the full same-book spread/total line-history strip from the shared
  Kalshi price-comparison window. Preserve real opening-to-current threshold
  changes and the exact price/time at each inspection point. A different
  threshold never becomes a price quote on the percentage comparison axis.
- Use the existing bounded curve treatment. A single observation stays a point;
  simultaneous ambiguous alternate thresholds are omitted, not chosen as a
  fictitious main-line move. An unavailable provider opening is not invented.
- Provider/canonical histories are reused. There are zero added provider
  requests, SELECT families, pollers, database writes, cron changes or model
  inputs. API cache preference varies only within the existing member request.

## Locked records

Locked member book/price/line/quote precedence is evaluated before any pin.
Existing frozen readers keep their exact legacy line-plot window; they are not
reinterpreted with the new full-history treatment. The existing pre-lock archive
writer is unchanged. Tests prove both stored-reader precedence and writer
immutability; the stored historical member checksum is checked after release.

## Verification

Focused tests cover pin stability, reload persistence, changed handicaps, fresh
fallback, stale non-fallback, source isolation, distinct sides/markets, invalid
pins, full-window source openings, exact line/price/time observations, ambiguous
alternates, single points, legacy frozen display and unchanged locked fields.
Run all eleven prediction-market suites, TypeScript, focused ESLint, production
build, `npm run verify:model-change`, actual desktop/mobile reader checks and
the clean committed integration guard before publication. Optional local
PostgreSQL proof requires `MARKET_BRAIN_POSTGRES_URL`.
