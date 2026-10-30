# CFB Owls publication dependency: normalized PMF precision

Base: `2a8e4d4322f243f6fdec7df690904c906bffbe46` (deployed ingestion #878).

Live r142 writer captured 94 new unlocked rows, including eleven fresh Owls
books for JMU/Troy, but Baylor/UCF 457406 failed an existing coherence check.
The complete-release guard correctly retained the previous full member slate.
Do NOT weaken that guard or partially publish a new forecast release.

Root cause: winner-PMF bisection compares home probability against raw PMF mass
minus home probability; the downstream validator compares against ONE minus home
probability. With mass rounding below one, p=0.5000000004999998 passes the first
1e-9 direction boundary but fails the second. Align the bisection with the same
normalized unit-mass probability complement as the validator. Preserve the
existing winner, total-bucket masses, expected total, smallest-margin objective,
thresholds, grading policy and all coherent non-crossing forecasts.

Scope: CFB near-tie PMF numerical implementation and its publication handoff only.
No market-reader evidence/weights, sportsbook policy relaxation or independent
model training. Advance coherence implementation r2, calibration r29,
decision/tuple r56/r43, writer r143 and fixture/snapshot/reader r97/r57/r42.
Keep model/distribution/probability r26/r24/r28 and policy r28: their mathematical
definitions and trained artifacts do not change. The new immutable calibration
and directional-alignment releases identify the numerical repair. Preserve exact
r55/r54 and earlier stored locked payloads and writer exclusion. One sole writer
and unchanged `prediction_pipeline:cfb` lease; no new scheduled job or shadow data.

Validate a deterministic failing boundary fixture, full downstream coherence,
unchanged total masses, exact coherent-input identity, legacy lock writer/reader
precedence, focused CFB/full model suites and a zero-write full-writer rehearsal
with zero capture failures. Main/fresh worktree/PR protection/integration checks
and actual live writer/member freshness verification remain mandatory.

Numerical correction is not outcome-tuned; compare grades and actionable counts,
do not use a changed grading policy to hide an ingestion or publication failure.
If anything beyond floating-point tolerance changes, stop for separate review.
