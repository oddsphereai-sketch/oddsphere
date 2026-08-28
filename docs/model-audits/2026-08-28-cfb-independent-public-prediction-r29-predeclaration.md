# CFB independent public prediction r29 predeclaration

## Owner requirement and defect

The public CFB reader currently promotes the canonical market anchor to the
primary score/winner forecast while exact-price decisions remain bound to the
football-only joint PMF. That can publish a genuine same-line contradiction,
such as SJSU-USC showing a primary Over 61.5 score outlook beside an Under
61.5 Best Angle. The owner has explicitly required that predictions remain
OddSphere model predictions rather than a sportsbook-line reconstruction.

## Frozen candidate

1. `decisions.forecast`, the released football-only joint PMF, becomes the sole
   public source of expected score, representative score, winner probability,
   Moneyline prediction, Spread prediction, and Total prediction.
2. When an exact-price decision exists, the displayed prediction is the same
   PMF evaluated at the identical target sportsbook line. Its probability is
   `independentProbability`; the separately labeled Bet probability, EV, and
   grade retain the existing calibrated/consensus exact-price math.
3. When no exact tuple exists, the independent PMF outlook may remain visible
   at a fresh, explicitly contextual line. It never acquires a price or grade.
4. The market-informed anchor remains stored as market context for audit and
   comparison. It is no longer published as an OddSphere prediction or a
   second score forecast.
5. A release gate must reject any exact-price decision whose selected side is
   opposite the independent PMF side at the identical line, or whose displayed
   score direction conflicts with that same-line prediction. It must not
   relabel the contradiction. Expected-score differences within 0.25 points of
   the line are the predeclared discrete-score quantization zone: the full PMF
   direction remains authoritative there, rather than inferring a side from a
   one-decimal mean that is effectively on the line.

## Invariants

- Exact sportsbook tuples, calibrated probabilities, consensus fair
  probabilities, EV, thresholds, grades, T-60 locks, tracking records, stakes,
  movement, splits, provider budgets, sole writer, and shared MLB reader
  behavior do not change.
- No reader-side promotion or demotion is authorized. Expected board impact is
  zero grade promotions and zero grade demotions.
- Football never publishes Toss-Up. Missing price evidence remains a
  market-scoped public No Play while the independent prediction stays visible.
- The candidate must preserve one score distribution for score, winner, and
  directional market predictions and pass Hawaii, Virginia, SJSU-USC, and
  UC Davis-Portland State regression checks.

## Advancement gates

- Current 38-game / 114-market SELECT-only replay has zero prediction/score
  direction failures and byte-identical exact-price tuples and grades.
- Focused CFB decision, production, weekly, directional-PMF, market-informed
  shadow, and shared football-coherence tests pass.
- `npm run verify:model-change`, TypeScript, webpack, integration safety, and
  protected-PR checks pass from a fresh current-main worktree.
- After merge, an untouched natural writer cycle publishes one atomic current
  wave and signed-in desktop/mobile QA confirms aligned score/winner/Spread/
  Total predictions with exact prices and no Toss-Up or market-anchor score
  copy.
