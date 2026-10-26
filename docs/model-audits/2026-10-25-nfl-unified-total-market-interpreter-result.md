# NFL unified Total market interpreter — result

Date: 2026-10-25  
Predeclaration: `2026-10-25-daily-edge-unified-market-interpretation-predeclaration.md`  
Tournament: `nfl_unified_market_interpreter_tournament_2026_10_25_r1`

## Decision

Promote the continuous target-excluded Total residual at the verified T-60 boundary only. Do not
promote the tested Margin/winner residual. The independent score remains the prior; the promoted
Total reader interprets target-excluded consensus level, no-vig price, named and retail movement,
persistence, reversal, buyback, public and sharp money-minus-ticket flow, signal agreement, and
time to start as one regularized residual. It does not use a directional threshold ladder.

The timing feature is eligible only from 0.8 through 1.0 hours before start. This is an evidence
integrity boundary, not a directional betting rule: all 56 fit rows were 0.8139–0.9807 hours before
start and all 18 confirmation rows were 0.8140–0.9807. Earlier unlocked forecasts keep the existing
reader because extrapolating this artifact to an early-week board was not tested.

## Evidence

The checksum-verified replay contained 74 complete locked games: 39 training, 17 selection, and 18
confirmation. Every rolling-forward game was scored only from earlier dates. The evaluated
sportsbook family was excluded from the market anchor and chronology.

| Evaluation | Candidate Total MAE | Independent MAE | stored-era MAE | Candidate O/U W-L accuracy | stored-era O/U W-L accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| rolling forward, 49 rows | 9.5080 | 10.5303 | 9.8139 | 68.75% | 64.58% |
| confirmation, 18 rows | 9.2020 | 9.8792 | 9.3827 | 76.47% | 76.47% |

Rolling Total MAE improved against the independent and stored-era forecasts on three of four dates
and was effectively tied with stored-era on 2026-10-04 (9.3713 versus 9.3678). Confirmation did not
trade away directional correctness and improved both comparison MAEs.

The tested Margin/winner residual was rejected: the strongest rolling candidate improved Margin MAE
only from 7.4695 to 7.4148 while reducing winner accuracy from 68.75% to 64.58%, with zero corrected
winners and two harmed winners. No Margin/winner coefficient from this tournament has production
authority.

Artifact:

- release: `nfl_unified_total_market_interpreter_artifact_2026_10_25_r1`
- model: `nfl_unified_total_market_interpreter_2026_10_25_r1`
- ridge alpha: 100
- artifact SHA-256: `8eaf3ef7c7bb303af0789441587984f8d2f36b935b5d315fc0fd5682ce4b6e82`
- audit source SHA-256 at result freeze: `620d07307be2d1d570de79c5bda07a05a5d7e515da5b83f61cbd0e31f8f1c961`

## Coherence and board impact

The reader re-centers the complete Total distribution. Expected team scores, representative score,
Over/Under probabilities, pick, and unchanged grade policy are then derived from that same final
distribution. It preserves the already-qualified home Margin, so it cannot silently change the
Moneyline winner or Spread side.

The 2026-10-25 current-board rehearsal was SELECT/provider-only and wrote zero rows. The one current
game was unlocked, so the T-60 artifact correctly remained neutral. Impact was 0 promotions, 0
demotions, 0 side changes, and 0 probability changes across the 14-game retained board. Future T-60
promotions and demotions use the same symmetric Total grade policy; no demotion-only rule or board cap
was added.

## Locked-record and continuity safety

Locked payloads are never recalculated or rewritten. The r42/r50/r35/r38 two-source snapshot tuple
is retained as the immediate read-only/startup predecessor. The new reader runs only while producing
a new unlocked or future T-60 payload under the new release tuple. Reader precedence continues to
render each legacy locked payload exactly as stored.

## Rollback

Rollback means restoring the r35 two-source release tuple and disabling the unified Total call for
new payloads. Do not delete, mutate, or reconstruct any r36 locked record. Preserve the new evidence
and artifact for audit even if runtime authority is rolled back.
