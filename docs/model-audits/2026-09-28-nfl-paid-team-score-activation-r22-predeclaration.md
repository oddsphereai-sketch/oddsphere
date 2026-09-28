# NFL Paid Team-Score Activation R22 Predeclaration

## Scope

This release changes NFL Daily Edge only. It promotes the already captured pregame BALLDONTLIE
weekly team-score projection from internal evidence into the weekly score center. It changes no
member copy, labels, layout, stakes, provider cadence, database table, prediction writer, cron,
or lock schedule.

The starting production base is commit `a341d796a038e23a662730ea81946463038cc562`.
The sole writer remains `nflForwardEvidenceWriter` under the shared
`prediction_pipeline:nfl` lease. Existing immutable T-60 and started-game evidence remains
unchanged under its original release identifiers.

## Frozen architecture

1. A complete pregame paid projection supplies the away and home score centers directly from
   the opposing D/ST `points_allowed` rows. The separately constructed player-component score is
   retained only as an internal provider-health cross-check.
2. The final joint score distribution is centered on those two team scores. The former 90%
   target-excluded market margin and 75% market Total center do not overwrite a complete paid
   projection.
3. Strictly same-book opening-to-current Spread direction and the existing bounded fresh Circa
   and line-matched public margin signals remain the market-reading correction. Provider opening
   rows may replace a later `first_observed` opening only when sportsbook identity and chronology
   are valid.
4. Total movement and Total split gaps remain captured but have zero mean-shift weight in this
   release because the frozen Week 3 movement diagnostic was 6/15 versus 8/15 for the direct paid
   Total.
5. Moneyline winner, Spread side, Total side, probabilities, expected scores and representative
   score are regenerated from the same final PMF. Exact price affects line-specific economics and
   grade only.
6. Missing or failed paid projections use the preceding coherent weekly football model. The
   writer never partially publishes a slate or clears the last coherent member snapshot.

## Pre-change evidence

The settled common cohort is 47 exact pregame snapshots across 2026 Weeks 1-3; PHI-CHI remains
unsettled and is excluded. Relative to the preceding independent signal:

| Metric | Preceding independent | Direct paid team score |
|---|---:|---:|
| Winner accuracy | 27/47 (57.45%) | 31/47 (65.96%) |
| Spread direction, pushes excluded | 17/44 (38.64%) | 21/44 (47.73%) |
| Total direction | 21/47 (44.68%) | 26/47 (55.32%) |
| Team-score MAE | 8.4826 | 8.2301 |
| Margin MAE | 11.1221 | 10.6887 |
| Total MAE | 12.0518 | 11.5406 |

Strict same-book provider-opening movement is available for the 15 settled Week 3 games. Spread
movement was correct in 9/13 non-push moved games; Total movement was correct in 6/15. A diagnostic
direct-score plus Spread-movement construction reached 22/44 Spread direction while retaining
31/47 winners and 26/47 Totals, with team-score / margin / Total MAE of 8.1556 / 10.5402 / 11.5406.
The movement cohort is small and is not represented as a guaranteed future win rate.

## Release gates

- Preserve all scheduled games and all three prediction categories per game.
- Report before/after grade counts, promotions, demotions, actionable counts and selected-side
  changes on the exact same current board.
- Prove PMF, expected-score, representative-score, winner, Spread and Total coherence.
- Keep provider calls slate-level and within the existing maximum page budget.
- Run focused NFL tests, `npm run verify:model-change`, TypeScript, scoped lint, production build,
  latest-main integration safety, protected PR checks and live release/readback health.
- No existing immutable T-60 row may be rewritten.
