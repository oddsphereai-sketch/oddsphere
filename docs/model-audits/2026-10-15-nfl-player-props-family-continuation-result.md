# NFL player props family-by-family continuation result

Date: 2026-10-15
Scope: independent point and probability models, 2026 exact locked replay, and separate market reading
Decision: retain the released family models; ship no unqualified challenger

## Outcome

This continuation did not stop at Rushing Attempts. It tested each supported player-prop family
under the same rule: the independent model must improve without line, price, book, consensus, or
movement features; market reading is evaluated afterward as decision evidence, never used to
train or choose the point prediction.

| Prop family | Independent-model continuation | Current-season evidence | Release decision |
| --- | --- | --- | --- |
| Passing Attempts | Five distinct challengers: factorized opportunity, game state, role survival, distribution recalibration, and hierarchical partial pooling | 16 exact scopes; no challenger cleared chronological and current gates | Retain released model |
| Passing Completions | Rechecked released attempts × exposure-weighted completion-rate architecture | 6 exact scopes; no new Week 5 offered rows | Retain released model |
| Passing Yards | Receiver-room bottom-up aggregation; residual diagnosis separates volume from efficiency | 16 exact scopes; candidate 66.80 MAE vs 66.43 incumbent | Reject challenger |
| Receptions | Team-completion budget × complete-roster normalized reception share | 58 exact scopes; historical stability interval crossed zero | Reject before current gate |
| Receiving Yards | Targets × completed air per target + targets × catch rate × YAC per reception | 72 exact scopes; point MAE 34.33 → 34.04, but Brier/log loss worsened and 11 actions demoted | Reject challenger |
| Rushing Attempts | Rechecked robust conditional-on-participation release and external expected-role alternative | External candidate improved RMSE but worsened MAE | Retain released model |
| Rushing Yards | Ordinary-run plus explosive-run yard decomposition | 30 exact scopes; historical RMSE improved but MAE worsened in both years | Reject before current gate |
| Anytime TD | Rechecked bounded role/red-zone rare-event challenger | No exact W1–4 retained ATD actions; prior candidate failed frozen Week 1 confirmation | Retain released model |

## What the five-week replay says

The exact ledger replay now covers 211 canonical locked scopes across 49 games through Week 5.
There are zero malformed locked payloads, zero unmatched outcomes, and zero ledger/outcome
disagreements. It is diagnostic rather than a clean release-pure model trial because the locked
archive contains several historical decision releases.

Across that archive, the stored independent probabilities are materially overconfident: Brier
`0.31599` and log loss `0.85846` on 187 scopes with a retained independent probability. The
same-scope market readings are `0.24915` and `0.69147`; published blended probabilities are
`0.25217` and `0.69771`. That does not justify training projections on the market. It establishes
the opposite release discipline: independent point and probability calibration must earn their
own promotion, while the market remains a separately labeled risk and timing signal.

## Market-reader track

The production reader now collects exact line and price observations, same-book opening-to-current
movement, source-aware reference offers, and qualified-reference support without changing locked
records. The five-week replay has complete opening line and price coverage for its 211 canonical
scopes. Measured movement supporting the locked pick won 55.26%; movement against it won 47.83%,
but the game-clustered interval for that difference crosses zero. Therefore movement remains a
threshold/caution signal rather than authority to flip a prediction.

The projection layer and market-reader layer are intentionally separate:

1. The independent model produces usage, opportunity, efficiency, and distribution estimates
   without sportsbook inputs.
2. The market reader records line, price, source, time, breadth, and movement.
3. The decision layer may hold, demote, or flag disagreement; it does not rewrite the independent
   projection and cannot mutate a locked public record.

## Next research queue

The largest remaining Receiving and Passing Yards error is workload/game-script volume, not a lack
of another yards-per-target formula. The next predeclared family work should therefore prioritize:

1. player availability and in-game role survival using only information known before lock;
2. team play volume and neutral/expected pass rate conditioned on score-state distributions;
3. offensive-line/pass-protection versus front pressure and coverage-shell matchup components;
4. route participation, alignment, and defender assignment when stable identifiers and honest
   pregame coverage exist;
5. prospective full-board retention, so future challengers can measure both promotions and
   demotions instead of only the locked-action subset.

No rejected candidate changes production predictions, probabilities, grades, or stakes.
