# UCL professional market-reader audit — r7 retained

Date: 2026-10-10  
Runtime/model release retained: `ucl_goals_coherent_2026_10_06_r7_target_excluded_opening_market_score`  
Grade release retained: `ucl_grade_policy_2026_10_06_r7_opening_market_score_inputs`

## Decision

Retain r7 unchanged. The audit found no honest, out-of-sample-supported UCL
rule that improves the released reader. In particular, it rejects a mechanical
same-book movement switch and any rule that treats absent public splits as
negative evidence. This is a zero-write audit: no locked record, probability,
projection, side, grade, stake, provider cadence, or member snapshot changed.

## UCL-specific professional standard

- Every forecast and wager is a regulation-time result. Advancement, aggregate
  score, extra time, and penalties are competition context and cannot silently
  replace the 1X2 outcome.
- The independent club PMF remains primary. Market evidence may alter the
  forecast only when it is target-excluded, multi-book, chronologically valid,
  and has demonstrated predictive improvement.
- The exact evaluated quote is downstream economics. It cannot validate its own
  forecast, and Best Angle/Lean requires positive expected value at that exact
  price.
- A complete same-book board is de-vigged before interpreting direction. Raw
  American-price movement by itself is not a probability signal.
- Pinnacle/Circa precede retail books when a complete board is available. A
  retail fallback remains explicit rather than being described as sharp.
- Match Result, Double Chance, Total, BTTS, expected goals, and displayed score
  must come from one coherent PMF. Match Result and Double Chance therefore move
  together when opening-market arbitration changes the likely regulation result.
- Public splits are secondary corroboration only. `unavailable` is neutral, not
  opposition. No split percentage can overcome incomplete pricing, incoherence,
  a nonpositive exact-price EV, or a data hold.
- Same-book movement is retained as contextual evidence until a UCL-specific
  chronological confirmation block validates a promotion/demotion pair. It is
  not an automatic flip or grade switch.
- Stage, leg, venue, and aggregate-before context stay visible. They do not
  convert a regulation-time market into a qualification market.

These boundaries follow the empirical soccer literature rather than treating
ticket/handle differences or late movement as universally predictive. European
football work finds meaningful favorite-longshot bias and book heterogeneity,
while multi-book research finds that both average and best offered prices carry
information. The implementation therefore preserves de-vigging, book identity,
price economics, and target exclusion instead of assigning a generic weight to
"sharp money." Sources:

- Angelini and De Angelis, *Efficiency of online football betting markets*:
  https://www.sciencedirect.com/science/article/pii/S0169207018301134
- Franke, *Do market participants misprice lottery-type assets? Evidence from
  the European soccer betting market*:
  https://www.sciencedirect.com/science/article/pii/S1062976917301254
- Deschamps, *Betting Markets Efficiency: Evidence from European Football*:
  https://www.ubplj.org/index.php/jgbe/article/view/525
- UEFA 2026/27 Champions League regulations, Article 21:
  https://documents.uefa.com/r/Regulations-of-the-UEFA-Champions-League-2026/27/Article-21-Knockout-system-extra-time-and-penalty-shoot-outs-Online

## Evidence

### Released opening-market arbitration

The exact released r7 replay remains reproducible on 58 priced historical
matches: 38 chronological selection and 20 untouched confirmation.

- Selection Match Result: 20-18 independent to 23-15 candidate; four flips,
  three corrections, zero regressions.
- Selection Brier: 0.202889 to 0.199603; log loss: 1.017579 to 1.002929;
  per-team score MAE: 1.130246 to 1.127154.
- Confirmation Match Result: 10-10 for both. The rule made no confirmation-side
  flip, while Brier improved 0.198784 to 0.195149, log loss 0.988708 to
  0.974952, and score MAE 1.170749 to 1.160122.
- Runtime parity with the selected target-excluded two-book / five-point lead /
  30% log-pool implementation was exact.

The confirmation block supports probability and score calibration, but does not
claim an unobserved side-correction win. That limitation remains explicit.

### Exact locked forward loss review

The only settled UCL member release contains 72 locked rows across 18 fixtures.
Fifty-six priced rows settled and 16 were actionable:

| Market | Actionables | Record | Flat-stake units |
|---|---:|---:|---:|
| Match Result | 3 | 3-0 | +2.182u |
| Double Chance | 0 | 0-0 | 0.000u |
| Total | 5 | 4-1 | +1.698u |
| BTTS | 8 | 6-2 | +1.580u |
| **All** | **16** | **13-3** | **+5.461u** |

All 16 actionables had positive exact-price EV. The three losses were:

- Arsenal at Napoli, BTTS Yes: -108, model 55.50%, +6.89% exact EV; Pinnacle
  no-vig probability moved 2.13 points against the pick.
- Roma at Fenerbahce, Over 2.5: -165, model 64.53%, +3.64% exact EV; the SX Bet
  same-book probability moved 8.23 points toward the pick.
- Bodo/Glimt at Manchester United, BTTS Yes: -160, model 65.27%, +6.06% exact
  EV; Pinnacle moved 1.61 points against the pick.

Movement-toward actionables went 9-1, movement-against went 1-2, and flat went
3-0. This is descriptive evidence, not a validated threshold.

The required paired counterfactual rejected a live movement rule. Demoting the
three movement-against actionables would remove two losses and one winner, but
the broad positive-EV/movement-toward promotion pool was only 3-3. The narrower
Double Chance subset was 3-1 across only four observations and is insufficient
for a production threshold. No board-flattening demotion is shipped.

### Current board and provider state

The live readiness replay returned 18 fixtures / 72 markets, 16 actionables,
zero nonpositive-EV actionables, and zero incoherent rows. It had 49/72 selected
current prices and 125/180 complete outcome prices; missing markets remained
held. The exact snapshot read minutes earlier contained 15 actionables because
one later refresh changed quote availability, not because of a release change.

The splits endpoint is connected but returned zero UCL rows on both the settled
and current board. Missing splits therefore contribute neither support nor
resistance. Same-book trails and all complete sportsbook boards continue to be
persisted by the existing UCL line-history path.

## Remaining limitation and revisit gate

The grade hierarchy remains an explicitly provisional UCL-owned transfer because
the historical provider offers no calibration-period prices and only one forward
matchweek has settled. Calling those 16 plays a UCL-specific calibration would
be overfitting. Revisit only after a release-pure chronological block contains
enough priced UCL locks to test promotion and demotion rules separately by
Match Result, Double Chance, Total, and BTTS. Until then, r7 is the professional
choice: use the validated UCL opening correction, enforce exact-price economics,
preserve coherent projections, and decline unsupported movement/split switches.

## Reproduction

- `scripts/operator/audit-ucl-opening-market-score-arbitration.ts`
- `scripts/operator/audit-ucl-professional-market-reader.ts`
- `scripts/operator/audit-ucl-readiness.ts`
- `scripts/operator/audit-ucl-current-board-impact.ts`

