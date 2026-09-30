# NHL overnight slate readiness r6

## Incident

At 11:00 UTC on September 30, the member NHL board was empty. The official NHL
schedule and the existing provider adapter both returned three regular-season
games, while production contained zero September 30 NHL games, prediction
records, or populated member cards. The once-daily NHL seed was not due until
13:45 UTC.

## Recovery evidence

The existing protected `/api/cron/nhl-daily-refresh` route was run once under
the `prediction_pipeline:nhl` lease. It completed successfully:

- three events found and three games written;
- 600 odds rows fetched, 467 matched, 28 parsed, and 26 current/history rows
  written with zero line errors;
- 14 split rows retained;
- three games and nine r10 prediction markets written with zero errors;
- one three-game member snapshot published.

The resulting board contained all three official games, all nine market slots,
four Leans, five Watchlists, and complete selected-side prices. No game was
locked early.

## Durable repair

Move the same single bounded daily schedule from `45 13 * * *` to
`45 7 * * *` (03:45 EDT / 02:45 EST). The route, runtime gates, provider boundaries, r10 model,
sport-scoped lease, T-60 refresh, coherence gate, lock path, tracking path,
copy, labels, and layout are unchanged. No extra daily provider cycle is added.

For identical captured input, the schedule change has zero model-side changes,
promotions, demotions, or actionable-count impact. Its only intended effect is
that the day's slate is present before the morning member window. The r10 T-60
path continues to refresh the exact event and publish the final coherent card.

## Acceptance

- exactly one NHL daily cron at `45 7 * * *`;
- operational release `nhl_daily_refresh_schedule_2026_09_30_r6_overnight_slate_readiness`;
- focused NHL and refresh-cycle tests, full model-change verification, and
  production build pass;
- protected PR is current with production main;
- next natural overnight run seeds the slate without provider or lease errors.
