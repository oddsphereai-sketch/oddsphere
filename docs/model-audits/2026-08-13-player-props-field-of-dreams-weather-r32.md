# MLB Player Props Field of Dreams weather recovery — r32

Date: 2026-08-13

## Scope

- Release: `mlb_props_2026_08_13_r32`
- Supersedes: `mlb_props_2026_08_12_r31`
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through `refreshMlbPropsBoard`
- Shared lease: unchanged `prediction_pipeline:mlb`

## Production finding

MLB's official August 13 schedule identifies PHI-MIN venue 5445 as `Field of Dreams`.
That neutral-site name was absent from OddSphere's ballpark metadata. Both the NWS
weather client and Open-Meteo fallback therefore skipped the game. The full refresh
built 3,502 member rows but failed closed with
`REQUIRED_RESEARCH_INCOMPLETE_271`; all 271 affected rows lacked only
`game time weather`, including five otherwise actionable rows.

## Change

Add Field of Dreams as an outdoor special venue using MLB's published Dyersville
address, geocoded to `42.4952072, -91.0546726`. Special venues remain separate
from the team-owned park-factor fixture, so Minnesota's park factor is not
misrepresented as the neutral site's factor.

No probability formula, calibration, threshold, market selector, grade policy,
promotion/demotion rule, or stake rule changes. The release bump is required
because restoring weather can change the existing environment input for rows in
this game.

## Verification contract

- Confirm the venue resolver returns the special venue and outdoor roof status.
- Run `npm run verify:model-change` and focused Player Props tests.
- Run paired current-slate full previews and report row/actionable-board impact.
- Persist only a publishable r32 snapshot through the existing authoritative
  refresh route and shared MLB prediction-pipeline lease.
- Verify the live release id, member snapshot freshness, data coverage, tracking,
  and member reader after deployment.

## Paired current-slate result

Both full previews used the August 13 slate and the same r31 scoring rules.

- Before venue recovery: 3,502 rows; 69 actionable (9 Best Angles, 60 Leans);
  snapshot blocked by 271 unsafe `game time weather` gaps.
- After venue recovery under r32: 3,502 rows; 69 actionable (9 Best Angles,
  60 Leans); snapshot publishable with zero validation errors and zero stale odds.
- Actionable board-count impact: **0**.
- Non-actionable grade impact: one Research row became No Play after the existing
  weather context was restored; no promotion, demotion, side, probability,
  projection, price, or stake rule changed.
- Remaining 20 held rows are disclosed thin pitch-mix samples and remain scoped
  to Research/Pending behavior rather than blocking unrelated complete rows.

## Rollback

Revert the special-venue mapping and restore r31 only if r32 has not written a
production snapshot. Once r32 has published, do not write r31 again; forward-fix
the venue metadata under a new release identifier.
