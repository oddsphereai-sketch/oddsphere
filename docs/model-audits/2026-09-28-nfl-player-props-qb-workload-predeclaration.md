# NFL player props quarterback workload marriage — predeclaration (2026-09-28)

## Scope and production base

- Production base: `eb93e91a8aebb0edaea386375a5f166ac5df8e39`.
- NFL player props only: passing attempts, passing completions, and passing yards for a verified
  current projected/confirmed starter.
- The existing sole player-props writer and `prediction_pipeline:nfl` lease remain authoritative.
  No provider call, timer, writer, stake, member copy, label, or layout is in scope.

## Production finding

The current-role r11 release correctly repaired Case Keenum's identity, availability, and passing-
yard forecast, but the live post-deploy audit showed that passing attempts and completions still
used the reserve-history independent point heads. Keenum therefore remained at a nonsensical 1.4
displayed attempts against 28.5 even while the same current multi-book passing catalog established
him as the starter. This is a cross-market role-coherence defect.

## Candidate

Apply the already-established expected-starter architecture consistently to all quarterback
passing-workload markets:

1. retain the portable independent role projection as source-separated evidence;
2. convert target-excluded current multi-book prices/lines into a market-implied center in that
   market's own empirical residual distribution;
3. combine 90% target-excluded current workload consensus with 10% recent independent role for a
   verified starter, matching the existing passing-yard policy;
4. transport cross-line target-excluded probabilities to the exact evaluated line;
5. use each evaluated sportsbook only for exact-price economics and same-book movement; and
6. publish projection, side, probability, EV, and grade from one posterior.

Cross-line independent evidence repairs the point estimate and is transported through the frozen
market-specific distribution, but it does not satisfy the existing same-line action gate. That
keeps this current-role correction from silently introducing an unvalidated promotion rule. One
book cannot confirm itself. Missing or ambiguous starter identity remains non-actionable.

## Acceptance

- Case Keenum attempts/completions/yards must all be starter-scale and direction/probability
  coherent on the same fresh Week 3 capture.
- Preserve all member markets and prior immutable locks.
- Report promotions, demotions, actionables, member rows, held rows, and provider-call ceiling.
- Reject on any current-release coherence mismatch, target-book leakage, provider-call growth,
  board collapse, mixed unlocked release, or writer/reader failure.
- Required gates: focused tests, complete no-write replay, `npm run verify:model-change`, production
  build, latest-main integration safety, protected PR, deployment, sole-writer run, and live proof.
