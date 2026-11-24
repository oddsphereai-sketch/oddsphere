# C4: training-only learned shrinkage for the portable score model

Declared before C4 fitting, November24,2026, after held C3 commitff02cee6e;
production base29d6bbf1e. Offline only. No live writer, provider request, grade,
market-reading change, new feature/window, history edit or persisted shadow.
C1/C2/C3 stay held. No current accuracy repair is implied by this hypothesis.

The research A2 recipe uses a fixed ridge penalty1000 for both Margin and Total.
C4 tests whether old training games support a different regularization strength
for each target. This is a new supervised point-score model, not a residual
head selected from the components of failed C3. Existing current-production
through2025 artifact and its originally selected penalty remain unchanged.

Keep the exact75 feature names and train-only median/missing-indicator/scaling
recipe from frozen A2. Training stays2021+2022, with original verified final
publication before the first2023 prediction cutoff. Baseline is exact frozen A2
trained on the same games/design using alpha1000. The target intercept is the
training mean; standardized training columns are centered. Each output has one
isotropic Gaussian coefficient prior with learned weight variance and one
independent learned noise variance. There are exactly two positive parameters
per output, four total. Predict with the ordinary ridge posterior mean and
alpha=noiseVariance/weightVariance. No feature-specific relevance search,
interaction, nonlinear basis, sample weighting or source-semantic substitution.

Fit by restricted Gaussian marginal likelihood on the centered training space:
C=noiseVariance*I + weightVariance*X*X'. Integrate the flat intercept by dropping
the constant direction; use a numerical SVD, retaining singular values above
machine-epsilon*max(n,p)*largestSingularValue. For eigenvalues d and projected
centered targets z, NLL is half of:

    (n-1)*log(2*pi) + sum(log(noise+weight*d))
    + (n-1-rank)*log(noise)
    + sum(z*z/(noise+weight*d)) + orthogonalTargetSS/noise

This is an exact algebraic reduction, not a regularization/window knob. Verify
it against a dense orthogonal-contrast covariance and finite-difference gradients;
verify coefficient/prediction parity with the existing fixed1000 baseline.

One L-BFGS-B solve per target in unbounded log parameters, max200 iterations,
ftol1e-10 and gtol1e-6, with analytic gradients. Initial noise is training sample
variance and initial weight variance=noise/1000. No grid, restarts, validation-
season optimization or post-result adjustment. Non-convergence/nonfinite source
or parameter/state holds the model. Source/missingness/scaler statistics cannot
read evaluation games. Do not fit C3 and C4 together or choose a winning output
component after results. Freeze both coefficient vectors and hashes before replay.

Evaluate all source-supported2023/2024 games as reopened development;2025 is
already-opened replication, not an untouched holdout. Keep the same primary gate:
>=0.10 team-score MAE improvement, positive95%week-block lower bound, neither
Total nor Margin MAE worse. Use1,000 Eastern Monday-week draws, seed20261123.
Report each season, bias, winner direction and all original source refusals.
Replication must improve team MAE and not worsen either marginal error. Failure
holds the joint model; no partial-component release. Original target/future
mutations cannot alter training or a different game's point forecast. Preserve
old source artifacts and all failed attempts. No new sports-data request.

Passing is permission only for the next validation stage: current-incumbent/
source consistency, genuinely new forward projections, calibrated probability,
exact-price full-market grading with paired actionable promotion/demotion counts,
full tests, version/lease/fresh-base protected release and ordinary live proof.
Point MAE is not a market hit rate or priced wager. No forced board expansion,
blind flip, grade-floor loosening or locked-history reconstruction.

The Gaussian linear weight-space identities and Gaussian marginal likelihood are
in Rasmussen/Williams, GPML [chapter2](https://gaussianprocess.org/gpml/chapters/RW2.pdf)
and [chapter5](https://gaussianprocess.org/gpml/chapters/RW5.pdf). The restricted
contrast reduction, NBA transport and validation gates are explicitly this
experiment's choices, not basketball conclusions from those references.
