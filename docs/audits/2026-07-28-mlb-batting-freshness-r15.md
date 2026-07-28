# MLB batting freshness r15 audit — 2026-07-28

## Scope

This audit covers the model-input correction that replaces stale MLB batting
season rows before the Daily Edge model builds its feature snapshots.

Release: `mlb_daily_edge_decision_2026_07_28_r15`

No grade threshold, promotion rule, demotion rule, stake rule, or card cap is
changed by this release. Existing decision rules remain in force.

## Root cause

The legacy `/api/cron/daily-refresh` BDL writer is intentionally disabled. Its
original implementation mixed MLB Stats and Ball Don't Lie player identifiers,
and the BDL season endpoint ignored the expected per-player filter. Enabling it
could duplicate players or attach the wrong statistics.

The later per-player BDL mapping work repaired research access, which is why the
Player Props pipeline can use BDL data, but no safe league-wide writer replaced
the disabled Daily Edge season-stat refresh. Daily Edge continued reading old
`player_season_stats` rows.

## Runtime repair

- Official MLB Stats API is the authoritative bulk batting source.
- One league-wide request is used:
  `stats=season&group=hitting&playerPool=ALL&limit=2000`.
- The response currently contains 671 unique hitter rows and no duplicate
  MLB person identifiers.
- Only mapped active batters on the current slate are upserted.
- The upsert contains batting columns only; it cannot null or replace pitching
  or first-inning fields.
- Every slate cycle checks coverage freshness.
- A provider call is skipped when every slate team already has at least three
  qualifying rows updated within six hours.
- The step runs inside the existing sport-scoped `prediction_pipeline` lease
  and existing slate-cycle schedule. No independent cron or writer is added.
- The batting step runs before first-inning refresh and before the automodel.

## Historical replay

Read-only replay range: 2026-06-15 through 2026-07-27.

- Statistics were cut off at the previous calendar day for every slate.
- 456 completed games were eligible.
- 907 non-push ML/total decisions were evaluated.
- All 30 teams had coverage on every replay date.
- No database writes were performed.
- Historical roster policy was conservative: only currently active,
  MLB-person-mapped hitters whose historical MLB team matched their mapped
  team were used. Missing coverage would have excluded a game; zero games were
  excluded.

### Baseline versus fresh batting

| Cohort | Baseline | Fresh batting |
| --- | ---: | ---: |
| All decisions ROI | +0.2% | +3.4% |
| Moneyline ROI | +1.7% | +4.3% |
| Total ROI | -1.2% | +2.4% |
| Actionable base-grade ROI | +4.5% | +6.9% |
| Best Angle base-grade ROI | +4.9% | +2.4% |
| Lean base-grade ROI | +4.4% | +9.1% |
| Brier score | 0.2614 | 0.2564 |
| Log loss | 0.7203 | 0.7091 |

Fresh batting produced 101 actionable promotions and 95 actionable demotions
over the replay, a net increase of six actionable rows. It did not flatten the
historical board.

The final untouched 2026-07-25 through 2026-07-27 slice was approximately flat
at -0.1% ROI versus +4.7% baseline. This limitation is reported rather than
hidden. The broader replay, calibration metrics, moneyline, totals, and
actionable cohorts improved.

## Current-slate dry run

Date: 2026-07-28.

- 671 official provider rows.
- All 30 teams covered.
- 16 baseline and 16 refreshed games.
- Nine games had at least one core side or grade change.
- Two actionable promotions and three actionable demotions.
- Net current base-grade board impact: -1 actionable row.
- Moneyline base grades: 8 Leans to 7 Leans.
- Total base grades: 4 Leans to 4 Leans.

First-inning side changes are possible when the team-offense fallback is in use;
the existing FI grade and promotion rules remain unchanged.

## Required deployment verification

Before declaring r15 live:

1. `npm run verify:model-change` and focused freshness/orchestrator tests pass.
2. Deploy from the exact clean commit.
3. Run one authenticated slate cycle.
4. Confirm the batting step used at most one provider call and wrote only
   mapped batting rows.
5. Confirm qualifying batting timestamps are current.
6. Confirm all unlocked prediction records carry r15 and no older release
   overwrote them.
7. Confirm the Daily Edge snapshot, data-health monitor, and site response are
   healthy.
