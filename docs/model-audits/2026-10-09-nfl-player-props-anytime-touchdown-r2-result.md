# NFL player props Anytime Touchdown independent-model r2 result

Date: 2026-10-09

## Decision

Do not change the live Anytime Touchdown model. The bounded r2 repair confirms the r1 diagnosis
and materially repairs displayed-scorer selection, but neither frozen r2 candidate satisfies the
complete probability-stability and position-ranking gates. The current production release remains
authoritative for unlocked and future rows; locked rows remain byte-for-byte unchanged.

## What r2 proved

R2 changed no feature, tree setting, team model, calibration family, or outcome threshold. It kept
the football-only Poisson team touchdown budget and replaced only the within-team allocation head
with the released-shape HGB after removing `team_implied_touchdowns`.

That isolated repair explains the r1 F1 loss. At nearly the same selected count, the r1 role-budget
head selected 321 names and found 104 scorers; r2's incumbent-shape budget head selected 322 and
found 112. F1 moved from 36.30% to 39.02%, above the released 37.69%. The improvement comes from
teammate ordering, not from adding more market weight or hiding picks.

The 50% direct / 50% hierarchy candidate won the frozen 2023 r2 selection. Complete results:

| Metric | Released independent | R2 pure hierarchy | R2 selected 50/50 |
| --- | ---: | ---: | ---: |
| 2026 Brier | 0.076566 | 0.076383 | 0.076535 |
| 2026 log loss | 0.258502 | 0.256057 | 0.255920 |
| 2026 ROC AUC | 0.826334 | 0.828424 | 0.828710 |
| 2026 expected scorers | 285.96 | 258.44 | 250.00 |
| 2026 observed scorers | 252 | 252 | 252 |
| 2026 calibration gap | 0.017706 | 0.009293 | 0.009446 |
| 2026 selected-policy F1 | 37.69% | 39.02% | 38.23% |

The selected blend's scorer counts were stable rather than concentrated in one week:

| Week | Released selected / correct | R2 selected / correct |
| --- | ---: | ---: |
| 1 | 65 / 29 | 76 / 32 |
| 2 | 76 / 23 | 80 / 23 |
| 3 | 72 / 22 | 78 / 24 |
| 4 | 71 / 27 | 79 / 29 |

The pure hierarchy's game-clustered challenger-minus-released delta was -0.000183 Brier with 95%
interval [-0.001342, +0.001019], and -0.002445 log loss with interval
[-0.006419, +0.001810]. The selected blend's corresponding intervals were
[-0.001162, +0.001124] and [-0.006307, +0.001556]. Both point estimates improve, but neither
interval excludes zero.

## Why neither candidate ships

The pure hierarchy fails the historical gate: 2025 Brier 0.073391 and log loss 0.245203 are worse
than the market-free incumbent's 0.073292 and 0.244798. The selected 50/50 candidate improves those
metrics only marginally (0.073277 and 0.244783), but fails the current-season stability gates:

- 2026 Brier improved in Weeks 3 and 4 but regressed in Weeks 1 and 2, short of the required three
  improving weeks.
- WR AUC was 0.798999 versus 0.799752 released; TE AUC was 0.798367 versus 0.814480 released.
- TE Brier/log loss were 0.079830/0.269036 versus 0.078691/0.264025 released, a two-metric
  position-group regression.

Those are frozen rejection gates. The scorer improvement cannot override them.

## Current board and exact-price safety

The naturally refreshed Week 5 production snapshot contains 421 Anytime Touchdown scopes across
15 games: 394 unlocked and 27 locked. It has 74 Watchlists, 347 No Plays, and zero Best Angle/Lean
actionables. Because r2 failed before the exact-price board gate, no candidate was installed and no
price, probability, displayed prediction, grade, promotion, demotion, action, stake, or market
movement interpretation changed. Candidate promotions: zero. Candidate demotions: zero. Actionable
count remains zero. This is a fail-closed result, not board suppression.

## Exact missing dependency

The live current-season state already has team red-zone attempts/scores, basic player rushing and
receiving volume, touchdowns, depth, injuries, and target/rush share. It does **not** have the player
who received each red-zone or goal-line carry/target. Consequently the runtime can update the team
touchdown budget but must carry each player's red-zone and goal-line opportunity state forward from
2025. The r1/r2 isolation shows that this within-team allocation is the remaining failure mode.

The smallest sufficient addition is one bounded, checksum/ETag-pinned current-season nflverse
play-by-play refresh after each completed week, storing only game/week/team, yardline/goal-to-go,
rusher ID, receiver ID, and rush/pass attempt fields. Derive player red-zone and goal-line
opportunities once at slate level, join them through existing player/game identity, and append them
to the sole current-season state/writer under the existing `prediction_pipeline:nfl` lease. Do not
add a per-card provider loop.

Official nflverse documentation says play-by-play is updated nightly after game days and recommends
the Wednesday-night/Thursday refresh after stat corrections. Its documented `load_pbp()` interface
also exposes the yardline, goal-to-go, rusher, and receiver play fields needed for the derivation.
See the official [data availability schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)
and [`load_pbp()` reference](https://nflreadr.nflverse.com/reference/load_pbp.html). That supplies a
concrete bounded cadence. Freeze the r3 opportunity-share model before Week 5 outcomes, use Weeks
1-4 only for training/state initialization, and require Week 5 forward confirmation plus the same
historical, weekly, position, clustered-uncertainty, board-impact, lock, provider-budget, and
live-coherence gates before promotion.

## Reproduction

```bash
PYTHONPATH=/private/tmp/oddsphere-nfl-props-pydeps \
  /Users/danielmengel/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/operator/audit_nfl_player_props_anytime_td_independent.py \
  --r2-only \
  --output /private/tmp/nfl-player-props-anytime-td-independent-r2.json
```

The script is read-only with respect to production data and artifacts. It performs no provider call
and no database write.
