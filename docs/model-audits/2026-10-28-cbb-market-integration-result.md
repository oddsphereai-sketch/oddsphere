# CBB private market-reader integration r5

## Outcome

Private integration, source qualification, chronological experiments and
score-coherence checks are implemented. **No predictive improvement is yet
established and no market head replaces r2.** No production activation, grade,
stake, cron, lease, stored prediction or locked record changes.

Reader research identifier:
`cbb_candidate_2026_10_28_r5_coherent_market_reader`.
The independent authority remains private r2. The shared Market Brain's CBB
inference path is not registered by this work; no NFL learned parameters or
qualification are transferred to CBB.

## What is integrated

- Owls current full-game ML/Spread/Total pairs match exact team names and
  fixture time, including reversed neutral-site listings. Pair completeness,
  opposing Spread lines, common Total thresholds, prices/hold, provider and
  receipt clocks, duplicate conflicts, stale/live/exchange rows are checked.
- The private reader excludes the target book and its family from references.
  It separates no-vig ML information, Spread and Total line-plus-juice centers,
  cross-market disagreement, dispersion and independent-strength interactions.
- Learned heads can change the outright winner, Spread side and Total. One
  margin and Total determine both team scores and every market probability.
  Tests prove winner crossings are allowed; there is no hard winner-preserving
  cap or fixed manual market blend. No reference evidence means no correction.
- Individual market outcomes, corrected losses, newly harmed wins, conditional
  W/L log loss/Brier and hypothetical exact-price units are evaluated together.
  Actual site grades/stakes remain unapproved and unchanged.

## Chronological opening-price test

Existing eight-Saturday BDL opening receipts were reused. Fourteen bounded
Owls catalog requests independently corroborated fixture orientation; this is
not exact selection-level named-book proof. Conflicting or ambiguous fixture
orientations were rejected, never guessed or swapped based on the outcome.
The resulting research cohort has 353 games: 151 fitting, 162 selection and
40 later evaluation. It is narrower than the earlier 635-game Total-only
benchmark because all three target markets, earlier target-excluded references,
complete statistics and corroborated fixture orientation are required.

The 2025-season outcomes were previously opened in earlier work. These are
retrospective tests, not pristine holdout claims. Each reference had to exist
by the selected target's opening timestamp and be at most 48 hours old.
Independent forecasts were rerun at that same timestamp, with the six-hour
result holdback. No post-cutoff head or training label could enter inference.

Three score-error ridge heads worsened aggregate selection picks by 16, 7
and 2 decisions. Two tree candidates were skipped because 151 games do not
satisfy the existing 200-game fitting guard; that guard was not weakened.

Next, three joint-probability heads were trained on exact conditional ML,
Spread and Total log loss. They also failed the predeclared all-market
selection criterion. Component ablations showed the penalty-10 Total-only
correction gained two Total decisions without moving ML/Spread. It was selected
before inspecting the later results. Its later 40-game comparison was:

| Market | Independent r2 W–L–P | Selected experimental head W–L–P |
| --- | ---: | ---: |
| Moneyline | 24–16–0 | 24–16–0 |
| Spread | 28–12–0 | 28–12–0 |
| Total | 18–22–0 | 18–22–0 |

Later Total MAE changed 12.7653 to 12.7478; conditional Total log loss changed
0.69106 to 0.69008. Those tiny probability/score changes produced no additional
correct decisions. They do not establish an improved reader and do not justify
replacing r2. The fitting objective and selection data were reused during
research, which adds selection uncertainty. The report retains every trial.

These are all-game opening-price decisions, not Best Angles, live locked
tracking, closing-line comparisons or guaranteed returns. Opening snapshots do
not show money flow, within-book movement, reversals or causal leadership.

## Genuine movement-path recovery

Eight discovery calls inspected current odds, splits and archives. The source
explicitly marks many older capture clocks unknown. Those timestamps are not
converted from a falsely UTC-looking string or inferred from game results.

Twenty-one bounded sequential archive calls recovered 80,607 raw rows across
nine actual late-season fixtures with known starts. After exact identity,
explicit UTC, T-60, supported-market/book, paired-side and source-quality
checks, 457 valid price pairs remained across seven games. Two games had no
eligible pairs. Every exclusion count is retained; 80,607 is not an inference
sample size, and repeated book polls are not independent games.

The normalized paths retain each actual point/price change and observed
window; they do not claim the first retained row is the true opener or that
the earliest observed change proves causal sharp leadership. Documented
misattributed Circa rows are excluded. This seven-game set establishes source
and coherence plumbing, not sufficient evidence to fit or certify a nuanced
movement resolver. It has zero prediction-changing authority in the preview.

The next unresolved predictive step is qualification of a genuinely
movement-conditioned CBB resolver on a materially larger provably pregame
cohort. Rebranding retail opening prices or unknown-clock rows as sharp
movement would not solve that requirement. The present result is not a claim
that market reading cannot improve the model.

## Current private preview

`/private/tmp/oddsphere-cbb-data/preview-market-2026-11-01.html`
and adjacent JSON are separate from the original r2 preview. Current receipts
were refreshed once (two more Owls requests) and retained as timestamped raw
snapshots. No SharpAPI request was made.

The capture returned fresh retail quotes but no actual Circa/Pinnacle quotes
and zero splits for this preseason slate. Global `availableBooks` metadata is
not treated as evidence that those books returned a price for these fixtures.
The first card has 12 qualified book/market pairs; the second has three.
Missing reference coverage cannot manufacture a score change. All scores remain
r2 and `marketInference.applied=false`; the separate view is an integration
audit, not a new winning-model release.

Reproduction:

```sh
npx tsx --env-file=.env.local scripts/operator/probe-cbb-market-history.ts --current --refresh-current
npx tsx scripts/operator/evaluate-cbb-market-reader.ts
npx tsx scripts/operator/evaluate-cbb-joint-market-objective.ts
npx tsx scripts/operator/replay-cbb-movement-cases.ts
npx tsx scripts/operator/preview-cbb-prelaunch.ts --candidate=r5
```

Numerical evidence and hashed local receipts:
`lib/cbb/artifacts/evaluation-market-r5.json`.
Source semantics: https://owlsinsight.com/docs (Historical Data API).

## Verification

Focused CBB tests verify source identity/reversal, UTC/T-60 boundaries, unknown
clock and live exclusion, exact target identity, target-family exclusion,
archive-versus-live receipt policy, duplicate handling, chronological training,
deterministic fitting/serialization, W/L/P, coherent winner/Spread flips and
equal team-score changes for a Total-only correction. Existing r1/r2/r3 tests
remain green. TypeScript, lint and full model-change regressions are required
before updating the draft branch. No production deployment is authorized.
