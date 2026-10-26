# NBA player-props latent-component redesign predeclaration

## Owner direction

On 2026-10-26 Daniel Mengel rejected 49.86% Rebounds and 53.26% Rebounds +
Assists as acceptable endpoints and directed Oddsphere to pursue genuine
prediction improvement toward 60% without becoming artificially selective.
The already released r9 target-book-excluded reader is the exact baseline. This
audit does not reinterpret or rewrite any locked decision.

## Problem statement

The active runtime has two structural gaps that a market-reader correction
cannot solve:

1. Explicit `Out` players are removed from the offered population, but the
   resulting minutes, rebound chances, touches, and passes are not reassigned to
   the remaining rotation.
2. Each prop market may select an independent underlying head. Combination
   markets can therefore disagree with the component expectations that should
   generate them.

The audit tests whether a shared latent player state (participation, minutes,
role and opportunities), sport-specific component heads, and a combination
residual layer improve both outcome direction and numeric projection accuracy.

## Frozen evaluation design

- The historical population, outcomes, lines, prices, and chronological game
  order are immutable inputs.
- Candidate selection, residual/reliability fitting, grade-policy fitting, and
  final confirmation remain separate chronological windows.
- All transformations are fit without the target game or any later game.
- Market evidence is target-book-excluded and remains downstream of the
  independent forecast.
- The current r9 runtime is the baseline. A simple market consensus, market-line
  projection, realized minutes, or realized teammate participation cannot be
  used as an independent feature.

## Predeclared candidate families

1. **Shared minutes and role state.** Predict conditional minutes once and use
   the same result for Points, Rebounds, Assists and Threes. Candidate features
   are prior minutes at multiple windows, minutes dispersion/quantiles,
   participation, team tenure, rest, home/away and point-in-time rotation
   continuity.
2. **Rebound opportunity decomposition.** Predict offensive and defensive
   rebound chances, then predict capture efficiency with shrinkage across recent
   and season windows. Pace, team/opponent rebound environment and player role
   may affect opportunities; they may not directly inject the offered line.
3. **Shared component combinations.** Build P+R, P+A, R+A and PRA from one set
   of P/R/A components, then fit only a training-window residual correction for
   stable, repeatable interaction error. Direct combination heads remain a
   challenger because prior evidence shows that naive summation can regress.
4. **Nonlinear residual challenger.** Fit bounded, low-complexity residual
   structure after the component forecast to capture role and opportunity
   interactions that a single ridge surface misses. Complexity is selected
   before confirmation and compared with the linear candidate.
5. **Availability/rotation challenger.** Use only genuinely point-in-time
   availability or rotation evidence. If historical availability cannot be
   reconstructed without hindsight, this candidate is reported as untestable
   and cannot receive production authority.

## Acceptance criteria

A candidate may advance only if it:

- improves Rebounds and Rebounds + Assists directional accuracy on the untouched
  chronological confirmation block, with no material degradation in projection
  MAE;
- improves or preserves the all-market release-pure result;
- reports every market, side mix, role/history segment, changed decision,
  correction and harm;
- keeps one coherent projection/side per row and zero invalid forecasts;
- evaluates actionable promotions and demotions together and does not obtain a
  higher percentage merely by flattening the board;
- reproduces on the exact current-board rehearsal without touching locked rows;
  and
- passes the focused suite, TypeScript, `npm run verify:model-change`, and the
  repository integration-safety gate before any release is proposed.

The 60% goal is evaluated honestly. It is not a release threshold that permits
data leakage, retrospective exclusions, or reporting only favorable markets.
If the untouched evidence does not reach 60%, the audit reports the achieved
gain and the remaining error rather than manufacturing the target.

