# CBB future-card continuity and day rollover — October 30, 2026

Starting remote-main SHA: `def6d9a10f2107fd16b65338ccf6dba3dab3a826`.

The member CBB page already receives an authoritative refreshed server payload
every minute through `DailyEdgeLiveRefresh`. The CBB date selector did not
respond when the published snapshot advanced to a new Eastern date. This
presentation change selects the present game day when that authoritative date
changes, while preserving an explicit game deep link and a manually selected
date during ordinary same-day refreshes.

Not-yet-analyzed CBB fixtures now occupy the same chronological card grid and
card dimensions as analyzed games. Their market tiles and reader explicitly
withhold score, price, pick, and Bet grade. A scheduled fixture is identified
by its canonical external ID; once the existing writer publishes its analyzed
member game, the same matchup becomes the full card and full reader on the
next server refresh. The card is never represented twice.

This change does not modify the writer, model, grade policy, feed, lease,
tracking, locked payload, or any other sport. The production CBB coverage gap
is not concealed: counts distinguish analyzed fixtures from fixtures awaiting
analysis. No unavailable odds or grades are fabricated.
