# MLB props optional-environment publication incident — r36

Date: 2026-08-19

## Scope and ownership

- Sport / market: MLB player props, all member-board markets.
- Projection and calibration: unchanged from r35.
- Decision and stake rules: unchanged from r35.
- Writer: `refreshMlbPropsBoard` through `/api/cron/mlb-player-props-refresh`.
- Lease: the existing sport-scoped `prediction_pipeline` lease.
- Reader: the existing persisted MLB props board and member-read snapshots.
- Release: `mlb_props_2026_08_19_r36`.
- Rollback: `mlb_props_2026_08_14_r35` plus the former validator behavior.

## Incident evidence

Production `data_refresh_log` showed the authoritative writer running on
schedule but returning `partial` with zero records written. The latest run at
2026-08-19 11:17 UTC returned `REQUIRED_RESEARCH_INCOMPLETE_263`; the same
failure had repeated on every scheduled refresh since 2026-08-18 20:47 UTC.

A no-write full rebuild for the August 19 slate returned 19,803 source rows,
19,803 mapped rows, 5,705 compact member rows, 126 actionables, zero stale
prices, and all 15 games. Publication failed only because the final validator
treated already-declared optional park/weather gaps as required research.

## Change

The validator now separates optional environment gaps from required research
gaps using the same authoritative `isSignalOptionalMemberFeature` contract
already used by scoring and the actionable-row safety gate. Optional gaps are
still disclosed as `OPTIONAL_RESEARCH_GAPS_ROWS_<count>`. Any normal-grade row
missing a genuinely required feature still produces
`REQUIRED_RESEARCH_INCOMPLETE_<count>` and blocks publication.

## Paired board impact

- Rows before / after: 5,705 / 5,705.
- Actionables before / after: 126 / 126.
- Promotions: 0.
- Demotions: 0.
- Probability, projection, side, grade, price, and stake changes: 0.

## Verification

- Focused regression: `npm run test:mlb-props-launch` passed.
- Model safety suite: `npm run verify:model-change` passed.
- No-write live rebuild: `npm run readiness:mlb-props-launch -- --date=2026-08-19`
  produced a publishable r36 snapshot with 19,804 source/mapped offers,
  5,705 member rows, 126 actionables, zero stale odds, and no validation errors.
  The command remained non-persisting by design.
- Production proof required after deployment: live r36 release identifier,
  successful leased writer, persisted fresh snapshot, member reader freshness,
  provider/mapping coverage, lock coherence, and the next scheduled refresh.
