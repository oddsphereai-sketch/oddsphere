# Football review reconciliation — predeclaration

Date: 2026-08-28

Base: `debcf28e34b8b6dff4d69a20c5f8f71ff5d2f972` (production `origin/main` after PR #241)

## Purpose

Reconcile the external review prepared against pre-PR-241 commit `919e0061` with the
current NFL Daily Edge, CFB Daily Edge, and NFL Player Props production contracts. The
goal is predictive and product coherence, not a larger board by fiat.

## Current authorities

- NFL outcome/grade/member: discrete joint outcome r2, actionable decision/policy r10,
  member r7, sole leased writer r11 under `prediction_pipeline:nfl`.
- CFB outcome: market-informed joint PMF contract r18 primary; football-only PMF r1
  secondary. Exact-price grade/decision remains r11 under the sole leased CFB writer r12
  and `prediction_pipeline:cfb`.
- Shared football publication boundary: cross-market coherence r1. It checks PMF mass,
  score/winner identity, representative-score direction, quote/side/EV identity,
  positive value for actionable grades, three market dispositions, and the mathematical
  Moneyline/Spread event relationship.
- NFL Player Props: distribution/calibration/decision r2, member r7, sole sequential NFL
  writer stage r8, tracking r4, settlement r3.

## Read-only current baselines

- CFB: 240 immutable rows read, 8 games / 24 markets, 21 exact-price decisions and three
  unavailable SJSU-USC markets; 1 Best Angle / 3 Leans / 7 Watchlists / 10 evaluated No
  Plays.
  All eight games pass the shared coherence boundary. No provider calls and no writes.
- NFL: 928 immutable rows read, 16 games / 48 markets; 3 Best Angles / 11 Leans /
  7 Watchlists / 27 No Plays. Spread and Total both have live actionable lanes. The
  current replay has zero tuple changes, promotions, or demotions. No provider calls and
  no writes.

## Production candidate scope

This candidate is deliberately grade-neutral:

1. Make each football prediction surface follow its primary joint score distribution,
   independent of sportsbook completeness. Exact-price selection and Bet grade remain
   separately labeled and cannot overwrite winner, Spread, or Total predictions.
2. Make the reader explain a valid Moneyline/Spread grade difference with the exact
   probability, price, fair probability, and EV instead of implying both contracts must
   receive the same grade.
3. Explicitly label an underdog Moneyline value evaluation below 50% as “value at price,
   not the predicted winner.” Preserve the primary score/winner forecast as the outcome
   prediction.
4. Replace the CFB decision loop's quote-clock-skew exception with a market-scoped
   unavailable reason. Programmer/artifact invariant failures continue to throw.
5. Split CFB unavailable reasons into stable machine-readable codes without weakening
   the existing target-excluded, same-line, two-comparison-book price standard.
6. Preserve every verified main-market sportsbook observation returned by the paid
   BALLDONTLIE and SharpAPI routes for display, including a one-sided offer. Complete
   target/benchmark pairs remain mandatory for grading. Playbook remains consensus
   context and cannot be relabeled as a target quote.
7. Present any internal price-recovery exception as a live prediction plus a reasoned
   No Play Bet grade. The internal recovery flag remains active; “Held” is not exposed
   as a football prediction or Bet grade.
8. Clarify the NFL Player Props ownership boundary in tests and documentation and wire
   the existing historical/leakage contract test into `verify:model-change`.
9. Make homepage supported-sport copy consume the Daily Edge sport registry, and label
   the manual 26,992-pick record as a dated legacy archive distinct from the current
   official since-launch ledger. Do not claim units/ROI where the legacy source lacks
   standardized prices and stakes.

No model projection, probability, calibration coefficient, grade threshold, evaluated
market side, grading price, action count, tracking eligibility, stake, writer ownership,
lease, provider-call ceiling, or T-60 boundary is authorized to change in this candidate.
The member prediction DTO and display-only sportsbook coverage are explicitly authorized
to change as described above.

## Review recommendations not authorized for production

- Do not set the CFB Spread intercept/slope to guessed values. A forced `0 / 0.35`
  calibration is not a fit and would change both sides and board volume without held-out
  evidence.
- Do not apply a placeholder -600 FCS Elo offset. PR #241 already prevents the primary
  member forecast from presenting the known FCS/FBS scale inversion by using the
  corroborated market-informed joint PMF. The independent football-only engine still
  needs a historical FBS-vs-FCS refit before its grade probabilities can change.
- Do not widen the CFB Moneyline band or reduce target-excluded comparison coverage from
  two books to one merely to manufacture action. Both change the qualified candidate
  population and require chronological evidence plus promotion/demotion accounting.
- Do not raise NFL Player Props model weight from the optimizer-selected 0.20 floor to
  0.50 by judgment. The review itself notes that the optimizer preferred the market.
- Do not multiply prop conditional performance probability by participation probability.
  A normal player-prop DNP is void rather than an Over loss/Under win; participation is
  therefore an availability/promotion gate unless the exact sportsbook settlement
  contract says otherwise.
- Do not add a CFB weather promotion gate while the production provider exposes no
  verified venue-weather feed; that would silently suppress every Total.

The larger CFB refit (FCS/SOS, winner-relative Elo MOV, feature de-collinearity,
heteroskedastic residuals, and calibration refits) remains a versioned research candidate
until its chronological artifacts and old-versus-new decision replay exist.

## Acceptance gates

- Current CFB 8/24 and NFL 16/48 replays remain byte-stable in sides, probabilities,
  quotes, grades, and actionable counts.
- A future-dated CFB quote affects only its own market disposition and cannot unwind a
  game or slate.
- Reader tests prove the primary predicted winner is not relabeled when a sub-50%
  underdog Moneyline has positive price value.
- Paid-source tests prove one-sided target-book evidence remains visible without becoming
  a no-vig market probability, Bet selection, grade price, or tracking tuple.
- Member football tests prove internal recovery states render as prediction plus No Play,
  never as a Held prediction.
- `npm run verify:model-change`, focused NFL/CFB/props tests, TypeScript, webpack build,
  integration safety, protected PR checks, natural-cycle evidence, and signed-in
  desktop/mobile QA pass before production completion is claimed.
