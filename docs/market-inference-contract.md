# Daily Edge market inference contract

The owner-directed product standard applies to every sport and to moneyline,
spread and total. Sport-specific outcome laws and data contracts remain explicit.
This document defines required behavior; it does not assert that every current
runtime already implements it.

## Evidence and interpretation

- Retain the original book, provider, native contract, line, both prices, source
  timestamp and actual availability bound. Multiple providers of one physical
  book do not become independent confirmations.
- Interpret absolute current levels alongside the opening, full retained path,
  latest movement, reversals, resistance, source quality and time to start.
  A latest buyback does not erase the net move; a net move does not erase buyback.
- Keep money and ticket observations specific to their book, market, line and
  available time. Cumulative shares do not establish new-money volume or bettor
  identity. A price held after observed pressure can be relevant, but a missing
  contemporaneous quote cannot establish that response.
- Read moneyline and spread together as different contracts on the margin axis,
  and totals with relevant margin/game context. Cross-market context cannot
  silently suppress valid own-market evidence merely because an unrelated
  optional source is absent.
- The independent forecast and its contemporaneously known quality are fallible
  evidence. It is not a protected answer or a competing pick to retain by default.
- Missing splits do not prohibit price-only interpretation. A genuine ingestion
  or matching defect remains a repair item; unknown evidence is never invented.

## Numerical decision and publication

Native line and paired price describe one economic contract. Equivalent locations
must not become several independently extrapolated point drivers merely because
line, log-odds and probability encode the same quote. Relative-coordinate methods
must make their observed origin and missing-source behavior explicit.


- The inference method must turn admitted evidence into a justified outcome
  distribution, including uncertainty. Storing a signal or describing it is not
  evidence that it changed or was correctly considered by the forecast.
- Do not assign preset model-versus-market forecast shares, arbitrary point
  bumps, mandatory signal-vote checklists, or play/side-count targets. Statistical
  numerical relationships must be identified honestly rather than relabeled
  source blending. A meaningful zero effect is allowed and must be distinguishable
  from a disconnected input or unsupported model capability.
- One coherent sport-specific law owns final scores and the probabilities used
  for moneyline, spread and total decisions. Confirmation, same-side strengthening,
  weakening, substantial revisions and flips are all legitimate contextual outcomes.
- Grades use that same forecast, its uncertainty and the exact offered contract
  and price. Probability of winning and value at the price remain distinct.
  Strong sharp evidence can affect grades through the numerical forecast and
  uncertainty; it is not an automatic Best Angle label or proof of named bettors.
- Preserve the existing product labels and intentional price preferences. Category
  boundaries must be explicit product policy, never disguised as natural laws.

## Verification and rollout

- Compare identical native evidence before and after a repair across all three
  markets, including both promotions and demotions, uncertainty and runtime costs.
  Check actual contextual counterevidence, numerical magnitude and retained/changed
  decisions; coherent downstream wiring alone does not certify good inference.
- Apply the same contract league by league. Sharing evidence normalization and
  decision interfaces does not justify transplanting a scoring model or parameters.
- Preserve the sole sport-scoped leased prediction writer and exact stored locked
  records, including reader precedence. New semantics apply to unlocked/future rows.
- Publish through the mandatory clean fresh-main protected PR path. Confirm actual
  production identity, normal writer, data coverage and stored member decisions.
- Functional source/decision checks do not guarantee accuracy. Forward results must
  remain separated by release and lock time; do not claim all possible signals or
  all future edge cases have been certified.

## Current scoped CBB delivery and remaining work

The proposed R7 release replaces the Total inference head only. It preserves the
exact existing R1 raw Margin head; that head's source-allocation limitation remains
an open moneyline/spread repair. A fresh joint calibration can still change final
conditioned margin probabilities, so all three markets require impact checks.
No claim that this Total-only delivery finishes CBB or all Daily Edge readers is
permitted. No recurring paid AI inference or new provider requests are introduced.
