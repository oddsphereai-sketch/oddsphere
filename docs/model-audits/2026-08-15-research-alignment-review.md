# Fresh research alignment review — 2026-08-15

## Question

Does Oddsphere's champion architecture align with the strongest available
evidence on probabilistic sports forecasting, market information, and betting
decisions? This is a fresh review. It does not import prior Oddsphere research
candidates or use old audit conclusions as model inputs.

## Primary evidence reviewed

- Walsh and Joshi, *Machine learning for sports betting: should model
  selection be based on accuracy or calibration?* The study preserves
  chronology and finds calibration-selected NBA models materially outperform
  accuracy-selected models in its betting experiment. It also explains why
  accuracy alone is insufficient when probabilities drive price comparisons
  or Kelly sizing: https://arxiv.org/abs/2303.06021
- Hubáček, Šourek, and Železný, *Exploiting sports-betting market using machine
  learning*. Their system treats correlation with bookmaker forecasts as a
  distinct concern and reports better betting performance when the model
  preserves independent information instead of merely reproducing the market:
  https://doi.org/10.1016/j.ijforecast.2019.02.001
- Štrumbelj, *On determining probability forecasts from betting odds*. The
  cross-sport comparison finds that how vig is removed matters and that
  bookmaker sources differ in forecast quality; simple normalization is not
  automatically the best probability conversion:
  https://doi.org/10.1016/j.ijforecast.2014.02.008
- Simon, *Inefficient Forecasts at the Sportsbook: An Analysis of Real-Time
  Betting Line Movement*. Across 3,681 MLB games and four sportsbooks, market
  forecasts were mostly reliable, but forecast quality did not improve
  monotonically toward game time and line changes showed negatively
  autocorrelated overreaction: https://doi.org/10.1287/mnsc.2022.00456
- Clegg, Song, and Cartlidge, *A market-calibrated accelerated failure time
  model for in-play football forecasting*. Although it studies football rather
  than MLB, its model comparison directly supports market calibration as a
  strong baseline and the addition of sport-specific residual information that
  the market has not absorbed: https://arxiv.org/abs/2605.16066
- Hegarty and Whelan, *Forecasting soccer matches with betting odds: A tale of
  two markets*. More than 80,000 matches show that market probabilities are
  informative but retain structure-dependent favorite-longshot bias, warning
  against treating a market number as literal truth:
  https://doi.org/10.1016/j.ijforecast.2024.06.013

The sports and market structures differ, so conclusions are architectural
constraints rather than borrowed MLB thresholds.

## Resulting architecture

1. **Outcome truth first.** Score and side forecasts are evaluated against
   settled outcomes at immutable locked timestamps.
2. **Market as a strong prior, not an oracle.** De-vigged paired prices and the
   exact offered price are distinct inputs. Market-only performance is always
   reported as a benchmark.
3. **Incremental sport model.** Baseball inputs should predict the residual
   beyond the market-implied expectation. A residual that cannot beat the
   market anchor out of sample is rejected even when its story is plausible.
4. **Coherent probability head.** Selected side, probability, line, and price
   move together. Brier score and log loss protect against an accuracy gain
   produced by worse probabilities.
5. **Separate market diagnosis.** Movement, tickets, money, source quality,
   and book count explain state; none automatically means bet, fade, or flip.
   Movement is not assumed to become smarter merely because it is later.
6. **Separate action decision.** A correct-side forecast is not a value bet.
   Action requires probability versus actual break-even price, robustness, and
   board-impact evidence. There is no global -120 or -200 ceiling.
7. **Chronological validation.** Fit, calibration, validation, latest, and
   rolling-origin windows preserve time. Exact locked prices are required for
   economic claims.
8. **Versioned release and rollback.** Every changed head and policy receives
   an immutable identifier; changed sides cannot inherit an old grade.

## Alignment verdict

The r48 design is aligned with the research on the important boundaries:

- it uses the MLB market as an explicit benchmark and, for totals, models
  actual-total residual beyond the locked line;
- it reports side accuracy, projection RMSE/MAE, Brier, log loss, exact-price
  action results, rolling folds, and board impact separately;
- it rejects the MLB moneyline baseball residual because it degraded the
  stronger market anchor;
- it does not interpret a sharp/public/movement condition as an automatic bet;
- it prevents newly changed r48 sides from inheriting r47 actions.

## Remaining gaps

- Paired market probability extraction should eventually compare basic
  de-vigging with a validated favorite-longshot-aware conversion and report
  source/book-specific quality. This is a future challenger, not authorization
  to change r48.
- MLB opening/current/closing market trails still need better source-complete
  capture. Without it, movement overreaction and price timing cannot be
  diagnosed as reliably as the underlying side forecast.
- The r48 moneyline cohort is small and post-hoc. It clears the local gate but
  should remain narrow, no-bet on changed rows, and explicitly labeled; it is
  not evidence for a blanket market flip.
- The runtime totals residual improves RMSE slightly but worsens MAE slightly.
  Both metrics remain visible, and the release claim is limited to the tested
  guarded side selector and probability scores.
- No forward shadow run is required or planned. Future confirmation uses new
  immutable settled rows, release-separated reporting, and repeatable
  chronological replays—not an operational shadow queue.

## Decision

Proceed with the narrow r48 MLB raw-prediction heads and retain the r47 action
system on unchanged rows. Stand down every newly changed side until a separate
exact-price action candidate clears the board-preserving action gate. Continue
the same market-prior/residual/probability/action decomposition for the other
four markets rather than searching for a universal flip rule.
