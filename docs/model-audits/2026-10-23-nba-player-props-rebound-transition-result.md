# NBA player-props rebound transition candidate result

Date: 2026-10-23  
Status: qualified for release-pure forward evaluation; not authorized for member publication

## Outcome

The blanket generic-minutes replacement failed its declared opening-season
direction guard and is rejected. The support-weighted successor passed every
available development/diagnostic gate and is the only candidate advancing.

The accepted research candidate changes only the standalone rebound forecast.
It blends two complete robust rebound forecasts according to how closely the
player's `same_team_games_10` input resembles the fitted role model's training
support. It does not use the sportsbook line, price, side, player identity, or
result in the blend.

## Historical diagnostics

### Two-season data

| Window | Version | Direction | MAE | Over share |
|---|---:|---:|---:|---:|
| Selection, 866 priced rows | Active | 55.54% | 1.9347 | 44.11% |
| Selection, 866 priced rows | Candidate | 55.66% | 1.9351 | 44.23% |
| Confirmation, 1,661 priced rows | Active | 51.84% | 1.9903 | 33.11% |
| Confirmation, 1,661 priced rows | Candidate | 51.90% | 1.9908 | 33.05% |

### Separate opening-season data

| Window | Version | Direction | MAE | Over share |
|---|---:|---:|---:|---:|
| Selection, 170 priced rows | Active | 53.53% | 1.8190 | 39.41% |
| Selection, 170 priced rows | Candidate | 54.12% | 1.8151 | 40.00% |
| Confirmation, 343 priced rows | Active | 58.02% | 1.9604 | 37.32% |
| Confirmation, 343 priced rows | Candidate | 58.60% | 1.9581 | 37.32% |

The direction mix remains effectively unchanged. The improvement is not an
Under quota or a mean-collapsing rule.

## Current-release diagnosis

On the immutable October 22 locks, replacing only the unsupported role-minute
path with the generic minute path moved standalone rebounds from 45.45% to
54.55% direction. MAE moved from 3.01 to 3.03, within the declared 0.10 guard.
The final support-weighted candidate converges to that path for the opening-
week input regime because the role model's support is effectively zero there.

Points + Rebounds remains unchanged. Rebounds + Assists and PRA also remain
unchanged by the standalone-rebound candidate; their October 22 independent
forecasts were already 81.25% and 84.21%. A separate audit found that market
arbitration, not their independent rebound component, caused their losses.

## Release boundary

The candidate may be scored on the next immutable forward slate under its own
release identity. It may not be presented as validated or replace the member
runtime until that release-pure result is available, grade transfer is checked,
paired promotion/demotion impact is reported, all model-change tests pass, and
locked-record precedence is proven unchanged.

## End-to-end market-reading result

The independently qualified forecast was also evaluated through the declared
opening-consensus arbitration layer. The 2-percentage-point disagreement rule
passed both historical confirmation checks; the 5-percentage-point rule did
not and is rejected.

| Confirmation window | Independent | 2 pp market-aware | Net correct | Independent MAE | Market-aware MAE |
|---|---:|---:|---:|---:|---:|
| Two-season, 1,661 priced rows | 51.90% | 52.68% | +13 | 1.9908 | 1.9854 |
| Opening-season, 343 priced rows | 58.60% | 59.48% | +3 | 1.9581 | 1.9489 |

The same rule also improved both development-selection windows: 55.66% to
58.43% on 866 two-season decisions and 54.12% to 58.82% on 170 opening-season
decisions. Over share rose from 33.05% to 40.46% in the large confirmation
window and from 37.32% to 44.61% in the opening-season confirmation window, so
the gain is not an Under quota or a flattened side distribution.

The 5-point alternative improved the large confirmation window only from
51.90% to 52.14%, then reduced opening-season confirmation from 58.60% to
57.43%. It fails the predeclared cross-window gate.

This establishes that market reading can improve the candidate's final side,
not merely its grade. It does not yet authorize publication. The archive has
opening consensus but not complete target-excluded same-book movement and
lock-time evidence. The October 22 target-excluded reconstruction was net
neutral (two disagreement flips corrected and two harmed), so the complete
live reader and grade transfer still require a release-pure forward slate.
