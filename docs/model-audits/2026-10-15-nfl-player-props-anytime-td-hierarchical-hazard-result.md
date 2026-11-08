# NFL player props Anytime TD hierarchical hazard result

Date: 2026-10-15  
Decision: **reject unchanged; do not release**  
Scope: research only; production Anytime TD actionability remains disabled

## Candidate evaluated

The frozen candidate was a market-independent hierarchy:

1. predict team offensive touchdown intensity;
2. estimate player participation and conditional offensive snap share;
3. fit position-specific scoring-intensity models for QB, RB/FB, WR, and TE from strictly lagged
   football opportunity;
4. normalize eligible-player intensities to the team touchdown budget as competing hazards; and
5. convert intensity to an anytime probability with `1 - exp(-lambda)` and preceding-season
   calibration.

No sportsbook price, line, no-vig probability, movement, spread, or total entered the candidate.
The exact market ledger was downstream evaluation only. No route-run field was available in the
checksum-pinned input manifest, so shifted offensive snap share was the declared role/route proxy.

## Gate results

| Evaluation | Fixed independent foundation | Hierarchical candidate | Result |
|---|---:|---:|---|
| 2024 Brier | 0.073056 | 0.073687 | worse |
| 2024 log loss | 0.238165 | 0.242242 | worse |
| 2024 AUC | 0.864300 | 0.857738 | worse |
| 2025 Brier | 0.072230 | 0.073003 | worse |
| 2025 log loss | 0.237939 | 0.241621 | worse |
| 2025 AUC | 0.857856 | 0.851114 | worse |
| Frozen Week 5 Brier, 45 rows | 0.108720 | 0.114012 | worse |
| Frozen Week 5 log loss | 0.329791 | 0.344607 | worse |
| Frozen Week 5 AUC | 0.959893 | 0.943850 | worse |
| Frozen Week 5 calibration gap | 0.143912 | 0.159193 | worse |

The 2025 game-clustered candidate-minus-foundation Brier delta was **+0.000773**, with 95% interval
**[+0.000187, +0.001355]**. All four chronological segments were worse, with deltas ranging from
+0.000058 to +0.001462. This is evidence of a real degradation rather than an inconclusive tie.

The failure was also broad by position. On untouched 2025, the candidate worsened Brier, log loss,
and AUC for QB, RB, TE, and WR. The largest calibration problems were QB (gap 0.024561 versus
0.005928) and RB (0.027885 versus 0.015273).

## Frozen-ledger economics

The candidate's independent probabilities produced five positive-EV rows at the exact locked
prices, going 2-3 for **+1.900 units**. The fixed foundation produced 12, going 4-8 for
**-1.581 units**. The candidate's top ten by claimed EV went 5-5 for +4.617 units.

Those small-sample economics do not override the probability gates: the same candidate was worse
on both full historical seasons, statistically worse on the untouched confirmation season, worse
on all four confirmation segments, and worse on all four Week 5 probability metrics. After the
existing downstream market-residual reader, both systems remained materially negative on the
45-row board: candidate -6.166 units on 28 positive-EV rows versus foundation -6.835 units on 31.

## Diagnosis and next structural move

The hierarchy itself is not enough when its player allocation signal is weaker than the fixed
foundation. The current implementation likely loses information in two places:

- offensive snap share is an incomplete proxy for routes, route participation, formation, and
  designed red-zone usage; and
- normalizing every eligible player to a team Poisson budget forces one coarse team scoring process
  across rushing, receiving, quarterback rushing, and return/fumble touchdown mechanisms.

The next TD candidate should therefore remain structural but split the team budget into mutually
coherent scoring channels (team rush TD, pass TD, and quarterback rush TD), then allocate each
channel using its own position/role opportunity model. It should use true prelock routes and
red-zone/goal-line participation if those fields can be sourced; otherwise the missing fields must
remain explicit and the model must not fabricate them. The same frozen 2024 selection, untouched
2025 confirmation, position, clustered-stability, and Week 5 gates remain mandatory.

## Reproduction

Run:

```bash
python scripts/operator/tournament_nfl_player_props_anytime_td_hierarchical_hazard.py
```

The script writes a checksum-bearing research artifact and row-level probabilities to the external
tournament cache. The production reader, locked records, grades, probabilities, and stakes are not
changed.
