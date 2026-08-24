# EPL weekly snapshot continuity repair — 2026-08-24

## Scope

This is an operational reader/publication repair. It does not change the active
`epl_goals_coherent_2026_08_20_r16` model, `epl_grade_policy_2026_08_20_v21`
calibration, any projection, probability, selected side, grade, price, stake,
lock, tracking record, provider budget, or writer ownership. The existing
`epl_daily_refresh` route remains the single scheduled writer under the shared
`prediction_pipeline:soccer` lease.

## Incident

At 2026-08-24T14:44:52Z the member page displayed zero Premier League games.
The stored gameweek-one snapshot still contained all ten fixtures, including
scheduled CHE@FUL at 2026-08-24T19:00:00Z, but its last successful publication
was 2026-08-23T14:30:41Z and its 24-hour stale deadline had expired. The member
read therefore fell back to an empty response.

The snapshot stopped publishing because the coverage gate required current
prices for all 40 weekly market selections and all 100 outcome rows. Finished
fixtures naturally lost their sportsbook prices, so every half-hour refresh was
classified partial even though the only active fixture was complete. The
14:37Z no-write reconstruction showed CHE@FUL at 4/4 selected prices and 10/10
outcome rows; the missing rows belonged only to full-time fixtures.

Round two was also reconstructed read-only from the provider: ten scheduled
fixtures, 40/40 selected prices and 100/100 outcome rows. The normal default
round will advance after CHE@FUL becomes final.

## Repair

1. Publication price coverage is scoped to fixtures whose provider status is
   not `final`.
2. A bounded continuity read can recover the newest stored EPL snapshot after
   its cache deadline only when it is no more than eight days old and still
   contains a game visible under the established soccer weekly lifecycle.
3. The next normal successful writer refresh stamps
   `epl_member_snapshot_lifecycle_2026_08_24_r2` and replaces the fallback.

The repair does not manually invoke the writer or mutate production data.
