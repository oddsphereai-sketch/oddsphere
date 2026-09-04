# Daily Edge confidence / execution separation predeclaration

Status: outcome-blind architecture candidate; first inning is excluded.

## Product contract

Best Angle, Lean, Watchlist, and No Play describe forecast confidence, not the economics of one
sportsbook quote. A verified named-book quote remains attached to every executable recommendation.
The exact quote, book, timestamp, break-even probability, and EV remain visible, but a quote crossing
one hard price or EV threshold may not erase an otherwise coherent confidence grade.

Unlocked boards may apply a small score hysteresis at the final display boundary so a fractional
input change does not make a Lean disappear and reappear on consecutive refreshes. Hysteresis is
price-blind and cannot preserve a grade through a material confidence move or an integrity hold.

Execution is a separate state:

- **Bet**: a fresh coherent quote is present and the model's expected return at that quote is
  non-negative.
- **Shop**: the forecast can remain Best Angle or Lean, but the displayed quote has negative expected
  return; it is excluded from stakes, ROI, and actionable-wager tracking.
- **Unavailable**: no fresh coherent quote exists. This remains a data-quality hold and cannot be
  presented as a wager.
- Integrity, contradiction, stale-input, lock, or required-evidence failures may still hold the
  prediction. They are not price-portability changes.

There is no fixed sportsbook assumption. The evaluator retains the existing fresh/coherent
best-price selection, while the member can use the confidence grade to shop another available book.

## Scope and exclusions

The implementation inventory covers every Daily Edge sport and market even when no game was played
on September 3. Model behavior will change only in a sport-specific release after a frozen
current-board comparison. MLB first inning is owned by a separate task and receives no model or
grade change here.

The rejected September 3 marginal-EV proposal is superseded. It replaced one cliff with several new
hard thresholds and is not a publishable design.

The shared shadow-only implementation is
`daily_edge_confidence_execution_contract_2026_09_04_r1`. It supplies price-independent confidence
bands, optional unlocked-display hysteresis, and a separate exact-quote execution state. Each sport
must still provide and validate its own continuous confidence score before production use.

## Acceptance gates

Each changed model must report confidence-grade promotions and demotions separately from executable
Bet/Shop/Unavailable counts. A Best Angle/Lean at negative EV must preserve its quote while remaining
excluded from stakes, ROI, and actionable-wager tracking. Missing/stale price must remain unavailable.
Every sport needs a new release identifier, focused tests, `npm run verify:model-change`, a clean
latest-main integration-safety pass, and live release/coverage verification after protected merge.
