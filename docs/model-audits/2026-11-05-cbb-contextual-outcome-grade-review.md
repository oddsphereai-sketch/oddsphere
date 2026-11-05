# CBB contextual outcome grading review — November 5

Status: local candidate; not activated. This review does not certify prediction
accuracy or authorize a minimum number of actionable picks.

## Confirmed restrictions

The candidate's interpreted grade policy still requires 3% exact-price expected
value for Lean and 8% for Best Angle. Best Angle additionally requires either
an 8% professional reference advantage or a narrowly defined active professional
book pressure/price response. These are categorical restrictions, separate from
the contextual forecast. Returning opposing evidence in a receipt does not by
itself constitute uncertainty-aware grading.

An independent review evaluated the final V5 artifact on the same frozen,
unsettled 43-game /129-market evidence and original execution offers. It reused
no prior predictions and performed no model fitting or provider/DB writes.

| Market | Positive estimated EV | Positive but below 3% | Lean | Best Angle |
| --- | ---: | ---: | ---: | ---: |
| Moneyline | 9 | 8 | 1 | 0 |
| Spread | 15 | 11 | 4 | 0 |
| Total | 34 | 4 | 30 | 0 |

All 30 Total Leans are Under. Eighteen Total selections have estimated EV of at
least 8%, yet none passes the additional confirmation requirement. Fifteen of
those eighteen also have a negative professional price reference; twelve retain
an opposing path and eleven an opposing composition. These overlapping facts
must not become source votes or a unanimous-agreement requirement. Nor does
removing the current gate justify automatically promoting those selections.

The model/grade diagnostic is private, SHA256
`f86b05cccca7501ba61d0c04b89ef464a7e6ec36a55ece21ac302ec0623f0d24`.
Model file SHA256:
`fe3f2f70f45f9a0894c3828753ee98367074bdaf10e183a5b4e7a50c489bed0c`.
Calibration file SHA256:
`e71948bb0caf22ac298cf827bdaa96b4aed2129eda3b4a2295fd6ad594589c1e`.

## Required product correction

The owner rejects fixed model/book blends, arbitrary score increments, signal
checklists, grade quotas and fixed EV reserves as the interpretation method.
The independent forecast remains a fallible input. The existing contextual
forecast must own the final coherent score law and probabilities; grading cannot
create a second forecast or change the selected side for its offered value.

A replacement grade policy must distinguish estimated betting advantage from
uncertainty about that advantage. Predictive game-score SD includes irreducible
game randomness and cannot be presented as an error bar on estimated EV. The
available source-location and GP-function posterior variances condition on fitted
parameters; they omit hyperparameter and model-misspecification uncertainty.

Any posterior-value extension needs an explicit covariance partition, positive
semidefinite components, valid-score conditioning and an integration check
against the authoritative law. Re-evaluating shifted means with the full
predictive SD would double-count uncertainty. An explicit decision-risk policy
is still necessary to map continuous evidence to distinct ordinal labels; its
boundaries cannot honestly be described as scientifically learned from the
existing fit or as literal threshold-free judgment.

## Owner clarification and replacement

The owner subsequently clarified that top confidence means confidence in the
selected outcome winning, alongside a worthwhile price, rather than posterior
confidence that EV is positive. A new posterior-risk forecaster is unnecessary
for that product definition. The previous uncertainty discussion identifies
limits; it is not a new runtime requirement.

Interpreted decision R6 /decision R6 /grade R5 replaces the former reserves and
confirmation gate with positive exact-price value eligibility. Best additionally
requires at least 62% unconditional selected-win probability and price -200 or
better; otherwise positive-value picks may Lean. This is a transparent product
policy, not a learned CBB accuracy guarantee. Expensive positive-value favorites
remain eligible for Lean. Existing score-law error estimates and floating-point
roundoff must resolve positive value; arithmetic dust does not qualify.

Raw probabilities, pushes, prices and forecast sides remain authoritative. A
price-only change cannot choose a different winner, even at a model tie. Actual
professional action and opposing evidence remain attributed independently of
labels. Contextual grade codes now encode Best and Lean consistently with their
explicit verdicts; Watch remains informational, including break-even and
numerically unresolved prices. Legacy locked DTOs remain unchanged.

Before publication, record the final same-input per-market promotions/demotions,
concentration and all lock-sensitive reader/writer checks. Forward outcomes remain separate evidence.
