# NBA three-market reader correction attribution r4

Date: 2026-10-16

Status: production diagnostics clarified; forecast behavior unchanged

## Question and decision

The reader must improve the final product by correcting bad independent picks, not by applying a
small consensus weight or by calling every market movement sharp. This audit therefore measures
only decisions where a candidate market read disagrees with, and would flip, the independent side.
It reports corrections and harms separately for Moneyline, Spread, and Total.

The decision is:

- retain the frozen two-point categorical Spread correction;
- recognize and track its coherent Moneyline effect when the corrected margin crosses zero;
- do not give a separate Moneyline movement rule authority, because its selected rule failed the
  untouched confirmation season;
- do not give a Total movement rule authority, because its selected rule also failed confirmation;
- retain provider-separated Moneyline and Total observations in shadow evidence so exact-book,
  exact-time prospective results can qualify a later rule without rewriting locked forecasts.

This release changes no score, side, probability, grade, stake, action count, lock, or stored locked
payload. It changes the reader release and operator audit payload so evidence qualification is no
longer confused with forecast authority.

## Literature interpretation

The implementation follows the distinction made in the NBA betting literature:

- Gandar, Zuber, and Dare found that closing NBA totals were more accurate than openings and that
  line changes incorporated information. That supports treating movement as evidence, but it does
  not prove that blindly following every move beats the closing line.
  <https://doi.org/10.1177/152700250000100205>
- Paul and Weinbach used actual betting data from four sportsbooks and found that favorites and
  Overs attracted disproportionate betting volume; blindly fading that public sentiment was not
  profitable beyond market efficiency. Ticket share therefore cannot be labeled sharp or used as
  an automatic reversal signal. <https://doi.org/10.1177/155862350800300302>
- Baryla, Borghesi, Dare, and Dennis found an early-season totals bias in their historical period,
  but the current five-season feature audit found that the sign and magnitude did not repeat
  consistently. The production model therefore does not hard-code an early-season Under rule.
  <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2149603>
- Feddersen, Humphreys, and Soebbing found sentiment-related bookmaker shading in more than 32,000
  NBA games. This is another reason to preserve book and source identity rather than treating market
  consensus as ground truth. <https://doi.org/10.1177/1527002516656726>

## Frozen chronology and inputs

The reproducible operator is `scripts/operator/audit_nba_three_market_reader.py`.

- selection: 2024-25 regular season, 1,224 games;
- untouched confirmation: 2025-26 regular season, 1,224 games;
- model: the frozen 75-feature, ratings/schedule, margin/Total ridge scorer;
- market proxy: public multibook consensus opening and closing snapshots;
- selection gate: at least 50 flips, at least +0.50 percentage-point all-game lift, at least 52.4%
  reader accuracy on flipped decisions, and more corrections than harms;
- Spread recipe: frozen r3 incumbent, not retuned after confirmation;
- Moneyline and Total: candidate chosen on selection only and evaluated once on confirmation.

Historical consensus open/close is not an authentic replay of the stricter runtime contract. It
lacks same-book sequences, target-book exclusion, exact decision-time prices, and historical
source-specific ticket/handle snapshots. The audit is a directionality proxy, not a claim of
historical live-reader ROI.

## Direct disagreement results

| Market candidate | 2024-25 lift | 2024-25 flips | 2025-26 lift | 2025-26 corrections-harms | Gate |
|---|---:|---:|---:|---:|---|
| Direct Moneyline movement | +1.47 pp | 138 | -0.41 pp | 53-58 | Fail |
| Frozen two-point Spread movement | +1.96 pp | 374 | +4.08 pp | 194-144 | Pass |
| Direct Total movement | +3.35 pp | 305 | -0.49 pp | 125-131 | Fail |

The Moneyline and Total failures are exactly why a promising selection-season rule cannot be
promoted merely to make the reader more active. They reverse sign on confirmation.

## One-score final-product attribution

The validated Spread correction re-orients the independent residual across the current spread. It
does not average the model with the market. The final margin and unchanged independent Total then
reconstruct one home score and one away score, and those scores own all three market decisions.

| 2025-26 market | Independent | Final | Side changes | Corrections | Harms |
|---|---:|---:|---:|---:|---:|
| Moneyline winner | 68.14% | 69.28% | 88 | 51 | 37 |
| Spread | 48.86% | 52.94% | 338 | 194 | 144 |
| Total | 51.80% | 51.80% | 0 | 0 | 0 |

The Moneyline improvement is not a hidden direct Moneyline-following rule. It occurs when the
validated Spread correction moves the one coherent final margin across zero. Total remains
independent because changing it with the selected movement rule would have made confirmation worse.

Other sealed final-product metrics remain:

- winner accuracy: 69.28%;
- team-score MAE: 9.54;
- margin MAE: 11.05;
- Total MAE: 15.24;
- Spread +3: 62.01%;
- Spread +6: 70.92%.

## Runtime contract

Reader release:
`nba_professional_market_reader_2026_10_16_r3_explicit_forecast_authority`.

The runtime now records the authority boundary directly:

- Moneyline: indirect only from the validated Spread-corrected score;
- Spread: conditional categorical score correction;
- Total: observation only pending separate validation.

For every unlocked forecast the grounding audit records the independent picks, final picks, whether
the Spread read qualified, whether it actually changed the score, and the per-market effect. The
member display reader remains separate and cannot execute a prediction change. Locked member
snapshots retain unconditional precedence and are not reinterpreted.

## What still needs prospective evidence

The complete V2 evidence archive must be evaluated after settled regular-season games by reader
release and locked timestamp. The release-pure report must include:

- corrections and harms for every actual side change;
- confirmations separately from flips;
- winner, Spread, Total, +3, and +6 results;
- Brier/log loss, score MAE, exact-price ROI, and closing-line value;
- source book, target-book exclusion, observation age, reversal/buyback state, and split provenance;
- rule results with missing evidence left unavailable rather than imputed neutral.

Direct Moneyline or Total authority requires a new predeclared rule to beat the independent/final
baseline out of sample. A rule does not qualify merely because it agrees with a winning pick, moves
toward the close, or makes the reader fire more often.

## October 16 live-board rehearsal

`scripts/operator/audit-nba-reader-current-board.ts` ran the exact member pipeline read-only for
October 20-22. It found 16 games, complete evidence reads for all 16, the expected market-marriage
and reader releases, and zero qualified Moneyline, Spread, or Total reads. All 16 final decisions
therefore remained identical to their independent starting decisions. The reader is operational;
it is correctly declining to manufacture a correction four to six days before tip from short,
incomplete, disagreeing, or stale sequences.
