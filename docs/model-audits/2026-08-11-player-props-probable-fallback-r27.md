# MLB Player Props probable-pitcher fallback audit — r27

Date: 2026-08-11

Candidate release: `mlb_props_2026_08_11_r27`

Authoritative writer: `/api/cron/mlb-player-props-refresh` through `refreshMlbPropsBoard`

Lease: MLB-scoped shared `prediction_pipeline`

## Scope and contract

This release changes only the Player Props starter-context input path. MLB Stats remains the
authoritative source. When one side is empty, the existing ESPN scoreboard probable source is
accepted only when the game is not an ambiguous doubleheader and the published name maps to
exactly one active pitcher on the corresponding MLB roster. The name must also resolve to the
same-team Ball Don't Lie player before its pitch-mix research is used. A later MLB Stats player
id replaces the fallback automatically. No second writer, timer, or refresh path is introduced.

The operational rollback switch is
`ODDSPHERE_PROPS_PROBABLE_FALLBACK_ENABLED=false`; it restores official-only behavior without
rewriting historical snapshots.

## Current data finding

MLB Stats had not published the home pitcher on CHC at WSH or HOU at SF. ESPN published Jake
Irvin for Washington and Carson Whisenhunt for San Francisco. Both resolved uniquely on their
active MLB rosters and in Ball Don't Lie (BDL ids 926 and 2546258). The existing official away
probables, Shota Imanaga and Hunter Brown, remained untouched.

## Paired shadow result

Two non-persisting full rebuilds ran against the same 2026-08-11 slate, 54 seconds apart. The
candidate and official-only baseline each contained exactly 5,874 compact offer rows, 15 games,
6 books, 17 supported markets, 3,274 disclosed unsupported raw offers, and zero stale odds.
Every exact row id was present in both boards.

| Measure | Official-only baseline | r27 fallback | Delta |
|---|---:|---:|---:|
| Offer rows | 5,874 | 5,874 | 0 |
| Required-research held rows | 402 | 32 | -370 |
| Opposing-starter missing rows | 370 | 0 | -370 |
| Insufficient verified pitch-mix rows | 32 | 32 | 0 |
| Actionable rows | 107 | 116 | +9 |
| Best Angles | 2 | 2 | 0 |
| Leans | 105 | 114 | +9 |
| Stale odds | 0 | 0 | 0 |
| Publication errors | 0 | 0 | 0 |

The paired decision comparison produced 11 actionable promotions, 2 actionable demotions, and
105 retained actionables. Four promotions were CHC hitters against Jake Irvin and seven were HOU
hitters against Carson Whisenhunt. The demotions were one same-game SF signal displaced by the
existing slate signal limit and one ATH home-run candidate displaced by the existing standardized
home-run quality selector. No demotion rule was added; these are the paired downstream effects of
making the previously withheld candidates eligible. Net board impact was +9 actionables.

## Failure behavior

- ESPN is not fetched when MLB Stats already supplies every starter.
- ESPN never overwrites a non-null MLB Stats player id.
- Exact roster/team resolution is mandatory; zero or multiple matches fail closed.
- ESPN team-pair identity is skipped for doubleheaders.
- A Ball Don't Lie id is required for pitch-mix research; unresolved research remains visibly held.
- Provider failure preserves the official-only slate and the last coherent published snapshot.
- Snapshot validation discloses the count as `PROBABLE_PITCHER_FALLBACK_ASSIGNMENTS_n`.
