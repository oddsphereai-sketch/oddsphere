# NFL player props Anytime TD channel-hazard result

Date: 2026-10-15  
Decision: **reject unchanged; do not release**  
Scope: research only; production Anytime TD actionability remains disabled

## What was tested

The candidate separated team receiving-TD, non-QB rushing-TD, and QB-rushing-TD intensities. Each
channel was allocated only to eligible players using its corresponding strictly lagged opportunity:
targets and receiving red-zone role for the pass channel, carries and rushing red-zone role for the
non-QB rush channel, and QB rushing, scramble, designed-run-proxy, and goal-line role for the QB
channel. Player hazards were summed and converted to an anytime probability.

The candidate used no sportsbook price, line, implied probability, spread, total, movement, or
consensus input. Exact prices and no-vig probabilities entered only after predictions were frozen.

## Probability gates

| Evaluation | Fixed independent foundation | Channel candidate | Result |
|---|---:|---:|---|
| 2024 Brier | 0.073056 | 0.073082 | worse |
| 2024 log loss | 0.238165 | 0.240158 | worse |
| 2024 AUC | 0.864300 | 0.861318 | worse |
| 2025 Brier | 0.072230 | 0.072769 | worse |
| 2025 log loss | 0.237939 | 0.241215 | worse |
| 2025 AUC | 0.857856 | 0.851875 | worse |
| Frozen Week 5 Brier, 45 rows | 0.108720 | 0.123848 | worse |
| Frozen Week 5 log loss | 0.329791 | 0.369763 | worse |
| Frozen Week 5 AUC | 0.959893 | 0.927807 | worse |
| Frozen Week 5 calibration gap | 0.143912 | 0.164659 | worse |

The channel design materially recovered historical accuracy relative to the rejected pooled
hierarchy—its 2025 Brier was 0.072769 versus 0.073003 for the pooled candidate—but it still did not
beat the fixed foundation.

The untouched-2025 candidate-minus-foundation Brier delta was **+0.000539**, with game-clustered
95% interval **[-0.000004, +0.001078]**. All four chronological segments were worse:
+0.000178, +0.000482, +0.000604, and +0.000803. The interval is not conclusive by itself, but the
directional agreement across every segment and all three aggregate probability metrics rejects the
candidate.

Position results do not provide a safe carve-out. On 2025, TE Brier improved slightly (0.070232
versus 0.070456), but TE log loss and AUC worsened. QB, RB, and WR Brier/log-loss/AUC were all worse.
The frozen Week 5 RB lane was especially poor: candidate Brier 0.184519 versus 0.135475.

## Frozen-ledger economics

At exact locked prices, the channel candidate marked eight rows positive EV; they went 3-5 for
**+2.700 units**. The fixed foundation's 12 positive-EV rows went 4-8 for **-1.581 units**. Candidate
top-ten claimed EV went 4-6 for +2.652 units.

That 45-row economic result cannot override the failed 22,447-row historical probability gates and
the candidate's worse Week 5 probability quality. It also did not survive the existing downstream
market reader: candidate final positive-EV rows went 5-17 for **-7.098 units**, versus 9-22 for
**-6.835 units** under the fixed foundation.

## Diagnosis

Splitting touchdown mechanisms was directionally useful, but allocation remains the limiting layer:

- target share and offensive snap share do not identify which players actually ran routes or which
  routes reached the end zone;
- a player-level Poisson intensity plus within-team normalization does not model multiple scorers,
  zero inflation, or shared personnel-package dependence explicitly; and
- the QB designed-run value is an honest but coarse proxy, not a complete play-design label.

The smallest defensible next addition is the licensed, stable-ID route-participation table specified
in the companion source audit. Until that exists, further retuning of this same channel allocation
would be parameter search against a known information gap. The fixed independent foundation remains
the research control and production TD actionability stays disabled.

## Reproduction

```bash
python scripts/operator/tournament_nfl_player_props_anytime_td_channel_hazard.py
```

The script writes checksum-bearing research artifacts and row-level probabilities to the external
tournament cache. It does not alter production readers, locked records, grades, probabilities, or
stakes.
