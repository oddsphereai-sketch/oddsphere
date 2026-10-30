# CBB loss census and uncertainty audit (private, no model changes)

Owner request: examine losses and harmful flips to distinguish recurring errors
from result variation before another predictive tuning round. Audit the frozen r2
and rejected r8 on all 5,721 paired diagnostic games. No filtering losses out of
the record, changing predictions/grades, or claiming that a postgame cause was
known pregame. All outcomes were opened previously; this is exploratory diagnosis.

Predeclared pregame cuts: r2 selected-side confidence [50,60),[60,70),[70,80),
[80,90),[90,100]; predicted absolute margin <3,3–6,6–12,12+; minimum prior
current-season team games 0–4,5–14,15+; verified home/neutral/unverified venue;
selected home/away; projected pace <65,65–72,72+; predicted Total <135,135–150,
150+; equal/rest-difference >=2 days; month. These cuts are descriptive, not gates,
promotion rules or a search for the best hindsight subset.

For each common cohort report all wins/losses, expected losses from each model's
own probability, signed score errors, MAE, probability scoring and candidate
corrections/harms. Resample calendar dates (2,000 fixed-seed replicates) for paired
gains and confidence calibration; also report gain concentration and leave-one-
date/team-out sensitivity. Date blocks do not eliminate all team dependence or
selection bias. A confidence-bin mismatch is not proof of a single causal defect.

Postgame-only descriptive cuts: final margin <=3, overtime, larger actual losses.
Always retain the full record. Actual pace/shot rates may be used only in labeled
counterfactual error accounting, never as features or validated model performance.
Pace-only positive rescaling cannot change the predicted winner's sign.

Reproduce exact-quote-time r2/r8 forecasts for both previously fixed quoted cohorts
(353 three-market games and 635 Totals, overlapping). Save the paired forecasts
for the census; group by baseline distance to the line and baseline confidence,
not by which model won. Audit all eight dates, not only candidate changes.
Retain orientation/timestamp and opening-versus-movement limitations. No claim
that unavailable verified movement/splits/injury history was read or ignored.

No model fitting/selection or production/provider writes. Zero source calls are
needed; use existing cached boxes, game, quote and model artifacts. The requested
"variance reduction" means quantifying uncertainty and finding repeatable
pregame errors, not deleting inconvenient results or promising deterministic wins.

Methodological references: Gneiting & Raftery (2007),
https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf ;
scikit-learn's data-leakage guidance,
https://scikit-learn.org/stable/common_pitfalls.html .
