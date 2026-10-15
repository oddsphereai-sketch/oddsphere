# NFL player props family loss checkpoint

Date: 2026-10-15
Status: complete release-pure diagnosis; four follow-up architectures validated; no live release

## Coverage and failure ownership

The first immutable complete-board capture contains 135 settled canonical Week 5 scopes: 69 wins,
66 losses, and zero pushes. All 135 join to strictly shifted football features. Every loss is a
forecast-direction failure; only two are also exact-price actionable grade failures. Another 42
offers across 26 scopes lack an official player-stat match and remain a separate identity/
participation queue rather than being graded or modeled as losses.

| Family | Settled | W-L | Primary loss causes |
|---|---:|---:|---|
| Passing Attempts | 4 | 4-0 | none |
| Passing Completions | 4 | 3-1 | role survival 1 |
| Passing Yards | 4 | 3-1 | role survival 1 |
| Rushing Attempts | 8 | 7-1 | team opportunity/game script 1 |
| Rushing Yards | 14 | 6-8 | efficiency 4; share/workload 2; role 1; team opportunity 1 |
| Receptions | 28 | 17-11 | share/workload 7; role 1; team opportunity 1; matchup 1; efficiency 1 |
| Receiving Yards | 28 | 18-10 | efficiency 5; share/workload 4; role 1 |
| Anytime TD | 45 | 11-34 | share/workload 15; tail calibration 14; role 5 |

Across all 66 losses, the mutually exclusive primary-cause ledger counts 28 player-share/workload,
14 distribution/tail-calibration, 10 efficiency, 10 participation/role-survival, three team-
opportunity/game-script, and one opponent-matchup failure. Matched loss-versus-win contrasts add
evidence that actual matchup state is material in Rushing Yards, Receptions, Receiving Yards, and
Anytime TD, but those diagnostic outcomes are never candidate inputs.

Market reading does not explain the broad miss. There are 64 unavailable, 22 caution, 38 mixed,
and 11 confirming reader verdicts; the loss subset is 31/11/20/4. Historical qualified
Pinnacle/NoVig reference rows are zero, so no automatic opposite-side flip is supported. The two
actionable losses are low-line Rushing Yards. Thus ownership is: 66 independent forecast failures,
two overlapping grading/price failures, zero validated market-reader override failures, and 42
unmatched offers in the separate data/identity queue.

## Highest-impact repairs validated

1. **Rushing Yards team factorization.** Team carry budget × complete-roster share × conditional
   yards per carry improves 2024, 2025, and current MAE/RMSE. It is not released because current
   offered-line direction falls from 43.33% to 36.67% on two low-line quarterbacks.
2. **Anytime TD independent allocation.** A football-only team-touchdown budget and player-share
   ensemble beats the released market-implied-team-score control on 2024, 2025, and complete Week 5
   Brier/log loss/AUC. It is not released because Week 5 calibration gap worsens.

Receptions target-role survival and Receiving Yards recent-workload/conditional-efficiency
challengers improve some aggregates but fail chronological stability. Passing Attempts has no loss
cohort; Passing Completions, Passing Yards, and Rushing Attempts each have only one loss and do not
support a release-pure family-specific rule.

## Decision

Do not change this week's live model, grade policy, or market reader from these opened outcomes.
The concrete independent foundations are now materially stronger, but neither top repair clears its
entire prospective release gate. Existing locks remain unchanged. The next forward validation should
prioritize the independent Anytime TD allocation's calibration and the Rushing Yards low-line QB
distribution boundary; neither may be tuned on the Week 5 outcomes recorded here.
