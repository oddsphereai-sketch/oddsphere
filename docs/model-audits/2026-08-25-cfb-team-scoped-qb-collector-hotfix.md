# CFB team-scoped quarterback collector hotfix

Date: 2026-08-25

## Production failure

The first natural production collection cycle after the CFB v1 launch acquired the shared `prediction_pipeline:cfb` lease at `2026-08-25T20:09:29.504Z`, then failed before any evidence insert with `BALLDONTLIE NCAAF /players/active exceeded its pagination budget.` The append-only table remained empty, the member board remained empty, and no prediction, grade, lock, or tracking record was published.

## Cause and bounded correction

The active-roster request placed all 16 exact opening-week team IDs into one query. Even with correct provider filtering, the combined college-football rosters require more than the old four-page budget. The corrected collector never scans the league. It requests each of the 16 authoritative slate teams separately through the provider-supported `team_ids[]` filter, permits at most two 100-player pages for each team, and permits at most two pages for the resulting QB season-stat lookup. The exact launch slate therefore has a hard 34-request QB-context ceiling.

Every active-player row must match the single requested team, and every season-stat row must match a requested QB. Any pagination overflow, request-budget overflow, off-team row, or off-player row throws before the writer's sole all-payload append. This prevents a partly enriched eight-game wave from being persisted.

## Release boundary

- Evidence schema: unchanged, `cfb_forward_evidence_snapshot_2026_08_25_r1`
- Model, probability, grade, decision, member, lock, and tracking releases: unchanged
- Collector: `cfb_forward_evidence_collector_2026_08_25_r2_team_scoped_qb`
- Writer: `cfb_forward_evidence_writer_2026_08_25_r2_team_scoped_qb`
- BALLDONTLIE QB context: `balldontlie_ncaaf_active_qb_context_2026_08_25_r2_team_scoped`

No play was promoted or demoted by this operational repair. The authoritative replay remains eight games and 24 markets: 1 Best Angle, 2 Leans, 10 Watchlists, 8 No Plays, and 3 Held markets. Production acceptance still requires a later natural scheduled cycle, immutable checksum validation, and signed-in reader QA; no manual cron, writer, provider call, or seed is authorized.
