# Daily Edge unified market interpretation predeclaration

Date: 2026-10-25

Status: frozen product-wide architecture and evaluation contract before candidate fitting

Starting production base: `8b36aa644ea12afd9b517b6e9eec99c2e349cb39`

## Owner direction and defect

The owner rejected a product in which an independent forecast is followed by a ladder of manually
chosen market thresholds that independently decides whether to confirm, resist, or flip a side.
The intended product is one sport-specific prediction system: the independent model produces the
pregame prior, a market interpreter estimates the independent model's remaining error from the
complete time-ordered market story, and one final coherent distribution produces the score,
Moneyline, handicap, Total, probabilities, and play grades.

NFL exposed the defect, but the contract applies to every active Daily Edge game and player-prop
model: NFL, CFB, NBA, NHL, MLB, WNBA, EPL, UCL, NFL player props, NBA player props, and MLB player
props. The sports must be evaluated and released separately. A result from one sport cannot select
another sport's feature set, coefficients, correction scale, or grade behavior.

## Non-negotiable architecture

1. The independent sport model remains market-free and produces the initial joint forecast.
2. Evidence eligibility may use hard integrity rules only: exact event/participant/market identity,
   decision-time and pregame chronology, freshness, complete paired prices, source-family lineage,
   target-book exclusion, and locked-record precedence.
3. Once evidence is eligible, forecast influence may not be selected by a hand-written directional
   threshold ladder. A versioned sport-specific interpreter must estimate a continuous residual or
   posterior from the complete eligible evidence vector.
4. The vector must retain, when available, opening and current no-vig probability/number, trajectory,
   timing, persistence, velocity, reversal, buyback, cross-book dispersion, sharp/retail sequencing,
   money-minus-ticket flow, cross-market relationships, time to start, and verified availability/news
   timing. Missing values remain explicitly missing; they are not zero, neutral, or fabricated.
5. The interpreter begins from the independent distribution and may preserve, strengthen, soften,
   reshape, or reverse it. There is no automatic market-follow, automatic fade, favorite/underdog
   rule, fixed score nudge, or universal market weight.
6. The interpreted margin and Total regenerate one coherent final distribution. Winner, handicap,
   Total, projected score, displayed probability, alternate-line direction, and grade must be derived
   from that same distribution.
7. Exact evaluated price determines economics after the final forecast. It may not validate itself,
   choose the forecast side, or enter twice through both the interpreter and grade layer.
8. Play grades may use calibrated reliability and exact-price value, but may not independently
   contradict or reverse the final forecast.
9. Locked records retain their exact stored payload and reader precedence. New semantics apply only
   to future unlocked decisions after a sport-specific production release qualifies.

## Frozen evaluation protocol

Each sport is a separate chronological tournament with no outcome-informed manual exceptions.

- Fit, selection, and confirmation periods are strictly ordered by decision timestamp.
- Candidate families and feature groups are frozen before confirmation outcomes are opened.
- Repeated observations from one game are grouped; player props are additionally clustered by
  game and player.
- Compare the independent forecast, deployed reader, and unified interpreter on identical rows.
- Report winner/side/Total accuracy, alternate-line accuracy where applicable, team/margin/Total or
  prop MAE, Brier score, log loss, calibration, exact-price units/ROI, and source coverage.
- Report every final side change as a correction or harm and every grade change as a promotion or
  demotion. Report board count and market mix; a flatter board is not evidence of improvement.
- Require score/market coherence and both directional outcomes. A candidate cannot qualify by
  predicting only favorites, only underdogs, only Overs, or only Unders.
- Baltimore and San Francisco are supporting defect reproductions only. They cannot select the NFL
  candidate and do not count as untouched confirmation evidence.
- A sport with insufficient chronological evidence receives no production behavior change. Rejected
  candidates are removed rather than left as a dormant second writer or member-visible shadow model.

## Release sequence

The implementation order is NFL, CFB, NBA, NHL, MLB, WNBA, EPL, UCL, NFL player props, NBA player
props, and MLB player props. Each qualifying sport receives its own model/calibration/decision/reader
release bumps, registry update, focused tests, same-input current-board comparison, rollback record,
latest-main integration proof, protected pull request, and post-deployment live verification.

No product-wide production claim is permitted until the inventory names the active release and
verification result for every listed model. A sport-specific release may proceed earlier only when
its own gates pass and it does not change another sport's runtime behavior.
