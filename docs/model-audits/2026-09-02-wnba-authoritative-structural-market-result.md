# WNBA authoritative structural market candidate result

Original candidate base: `4f84cf57d8e664ac78897f1fcd7820bc639efdf4`

Final protected-main base: `1b053d447d182bf7b61aa87fba49f71d26a112fe`
Base tree: `a454d9d29a5550afb3ea1f96bd4eb1adac2527f0`

The base includes the live EPL r18/v23, MLB r80, MLB props r41, MLB weather
provenance, and MLB lock-coherence r3 releases and their registry entries; the
WNBA integration preserves all of them unchanged.

Rebased predeclaration commit: `0f4bdb79c38ab3f525dd1779a966647d5fd071d4`
Evaluation time: 2026-09-02T21:18:13.551Z

## Result

The coefficient-free structural implementation is complete locally. It is not
published and this report does not claim natural-slate or outcome qualification.

The candidate removes evaluated-book self-validation from Moneyline, Spread and
Total, accepts only fresh complementary same-book pairs, and uses exact offered
price solely after the forecast distribution is fixed. Missing, tied, stale,
future, incomplete, singleton-authority, or correlated alternative evidence does
not move the forecast. A lone complete pair can still supply a real evaluated
quote and exact break-even/EV calculation.

The source-review amendment freezes each evaluated book and line once from the
independent forecast and deterministic quote policy, before computing a single
target-excluded posterior. A posterior side change is repriced from the
complementary side of that same fixed pair. No set of leave-one-out posteriors is
ranked by evaluated price, and a price perturbation that preserves fixed identity
has exactly zero forecast effect.

Source classification is explicit and conservative: Circa, Pinnacle and
Bookmaker are originator families; known named books are retail; all SharpAPI
non-originators share one unverified-lineage family. Two retail labels therefore
cannot create market authority. Qualified market context requires at least two
books and two independent families, such as an originator plus retail. The old
retail-as-sharp labels are removed.

The final score contract is one joint construction. Total is the independent
normal total head. Margin is the frozen maximum-entropy sign-tilted distribution
that preserves expected margin, incumbent variance, and target-excluded Moneyline
win probability. Spread probabilities are CDF evaluations of that same margin
distribution. Infeasible constraints use the exact independent normal fallback.
Expected home and away scores are unrounded algebraic decompositions of final
total and margin means.

## Authentic evidence inventory

The select-only audit made zero provider calls, zero cron calls, and zero writes.
For the natural 2026-09-02 slate it found:

- Moneyline records/captures: 0 / 0
- Spread records/captures: 0 / 0
- Total records/captures: 0 / 0
- Exact evaluated quotes: 0
- Complete pairs and target-excluded alternatives: 0
- Locked and settled capture rows: 0
- Release-stamped forward captures across all queried WNBA rows: 0

This is scheduler/no-op health, not a natural-board comparison: no scheduled row
exists from which to form a board. The returned inventory counts are 0 Best Angle /
0 Lean / 0 Watchlist / 0 Caution / 0 No Play in every market, with no computable
promotion, demotion, side, projection, or probability deltas.
No game, price, capture, result, or betting split was invented. Brier score, log
loss, projection MAE/RMSE, ROI, and calibration gap are null, not zero.

Existing pre-candidate records cannot reproduce the new target-excluded cold-start
Moneyline path because no forward capture rows exist. Even if an older capture
appears later, its independent feature bundle must be checked for evaluated-book
contamination before replay. Historical outcomes remain opened diagnostics and
cannot be called untouched qualification.

## Structural non-flat gate

Frozen, outcome-free fixtures prove both directions without a quota:

- Promotion fixture: one qualified Moneyline target plus five complete Spread and
  Total books. Target exclusion leaves four alternatives. Positive exact-price
  edge and EV produce 3 Best Angle / 0 Lean / 0 Watchlist / 0 Caution / 0 No Play:
  Moneyline, Spread and Total are all Best Angle, with Spread and Total providing
  the two promotions above their former blanket Watchlist caps.
- Demotion fixture: the exact same forecasts with selected-side prices changed to
  negative-EV quotes remain numerically identical but both grades become
  Watchlist (two exact-price demotion paths).
- Legacy-Spread demotion fixture: eleven complete books satisfy the old
  projection/rest Lean prerequisites after ten target-excluded alternatives, but
  the exact quote has negative EV. The candidate correctly prevents that old
  promotion and leaves Watchlist.
- Missing-evidence fixture: a singleton complete quote and a board with no market
  alternatives have identical Moneyline probability, margin, total and scores.
  The singleton still produces real sides and exact-price economics, including a
  Best Angle Moneyline from the independent probability and exact offered quote;
  it has no forecast authority and does not flatten the sport-model play.
- Authoritative Moneyline, Spread and Total probabilities, expected scores,
  margin and total remain full-precision finite decimals in the writer-facing
  snapshot and current tuple inputs. Formatting remains a reader/UI concern.
- Provenance fixtures show retail-only alternatives falling back to the exact
  independent forecast, originator-plus-retail alternatives qualifying, and
  opposed Circa/Pinnacle leave-one-out sides unable to select the authoritative
  forecast because the target is frozen first.
- Recency fixtures show a newer valid pair with nonzero skew defeating an older
  zero-skew pair from the same sportsbook.

These fixtures prove that the implementation has both promotion and demotion
mechanics and is not structurally flat. They are not represented as a natural
slate or performance evidence.

## Verification status

Passing:

- `scripts/test-wnba-target-excluded-market-decision.ts`
- `scripts/test-wnba-core-model-calibration.ts` (75/75)
- `scripts/test-wnba-forward-evidence-capture.ts`
- `scripts/test-wnba-incoherent-total-context.ts`
- `scripts/test-wnba-action-promotion-stability.ts`
- `scripts/test-wnba-daily-refresh-telemetry.ts`
- `scripts/test-wnba-final-score-ingest.ts`
- `scripts/test-wnba-price-trail.ts`
- `scripts/test-prediction-record-service.ts`
- `scripts/test-automodel-model-version.ts`
- `scripts/test-official-tracking-markets.ts`
- ESLint on every task-owned source and test
- `scripts/test-mlb-pipeline-safety.ts` (65/65)
- `scripts/test-daily-edge-experience.ts` (187/187)
- TypeScript (`tsc --noEmit`)
- `npm run verify:model-change`
- `npm run verify`
- Next.js production build with webpack (105 pages)
- integration safety on the last fully gated protected base

The candidate includes the coordinated WNBA release assertions and registry hunk.
The `preverify:model-change` lifecycle also invokes the target-excluded decision
suite and incoherent-total/legacy-lock suite, so the mandatory gate cannot omit
the new forecast, grade, or locked-reader invariants. No UI, route, provider,
cron, capture-schema, lease, or new writer path is changed.

## Operational invariants

- `runWnbaModel.ts` remains the sole model writer.
- The scheduled route still requires `prediction_pipeline:wnba`.
- Locked `game_predictions` are skipped before payload construction.
- Locked tracking market records are excluded from replacement.
- Legacy v1 locked decision tuples retain unconditional reader precedence.
- Unlocked fallback accepts only the current v5 record/current v3 tuple release.
- Forward capture stays behavior-neutral v1 and embeds the new release identifiers.
- Forward action evidence moves to a release-pure v2 key; older observations remain
  stored and are not blended into the new release.

The coordinated MLB lock-coherence r3 prerequisite and the subsequent football
reader release are present in the final base.
Publication requires the affected and full gates plus integration safety on this
exact tree and proceeds only through the protected PR path. With no natural WNBA
slate, deployment can prove release and scheduler health only; the first genuine
slate remains the automatic tuple/capture and outcome-quality checkpoint.
