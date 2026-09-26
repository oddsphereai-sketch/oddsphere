# CFB bounded member-transition completion r74

## Predeclaration

- Scope: the existing metadata-first CFB writer evidence reader and sole writer release.
- Incident: the current r27 release had valid evidence for every still-eligible game, but six
  already-started games correctly had no new r27 capture. The compact snapshot's existing
  release-transition selector needed the latest verified r26 row for those games, while the
  optimized reader supplied only current rows and pre-T-60 recovery rows. Snapshot r18 therefore
  remained unpublished and the reader continued serving the prior r17 board.
- Intended behavior: retain one latest full payload per game from only the immediately previous
  verified release. Keep the metadata scan payload-free and batched full-payload read bounded.
- Unchanged: all model, PMF, calibration, decision, grade, stake, lock, tracking, provider,
  member copy/label/layout, cron, and shared lease behavior.
- Release: sole writer r74. Rollback to r73 while preserving immutable evidence and locks.

## Result

- Focused and mandatory model-change verification must pass before deployment.
- Production verification requires snapshot r18 publication and direct inspection of the served
  SDSU-Toledo Spread card; deployment alone is not success.
