# Model change safety protocol

This is the required release checklist for any change that can affect predictions, model
inputs, probabilities, projections, grades, promotions/demotions, calibration, prices used,
or stakes. It exists to prevent mixed model eras, competing writers, accidental board
flattening, and load spikes.

## Owner-approved emergency exception: CFB PR #265 provisional release

Approval and scope: Daniel Mengel, owner/operator of OddsphereAI, approved this exception on
2026-08-29. It becomes effective only when this governance change lands on protected `main` and
applies only to the CFB market/sharp-aware candidate reviewed in PR #265 at commit
`0e86abf4b02e55b26af0516e6c5a1eecc1403bcb`, whose candidate identifier is
`cfb_market_sharp_aware_shadow_2026_08_29_r3_borderline_spread`. It does not authorize later
changes to that candidate, any other sport or market, or any reusable relaxation of this
protocol. PR #265 remains a zero-write candidate and is not, by itself, a production cutover.

The owner acknowledges that chronological, source-specific historical CFB split validation is
unavailable for this provisional release. As a narrow exception to the shadow-only requirement
in section 4, the identified candidate may advance after all gates below pass. Current canonical
market movement and strictly matched sharp evidence may influence the single authoritative joint
PMF and every value derived from it: expected scores, representative score, winner probability,
same-line Moneyline/Spread/Total probabilities, predicted sides, exact-price EV, predictions,
and play grades. Sharp evidence must retain the candidate's exact league/team/date/market identity
rules, including exact-line identity for Spread and Total; missing or mismatched evidence is
unavailable, never neutral, inferred, relabeled, or fabricated. Movement evidence must remain the
same evaluated sportsbook's exact operational opening-to-current comparison.

The authorized math is bounded to the reviewed candidate: exactly 25% market/sharp PMF weight and
75% independent-football PMF weight, with sharp anchor adjustments capped at one point of home
margin and one point of game total. The reviewed balanced promotion/demotion and bounded spread
recalibration rules may affect grades, including the tested TCU-UNC case, but cannot create or
increase a stake. This exception forbids stake inflation, fabricated or loosely matched evidence,
rewriting locked or settled records, historical backfill presented as forward evidence, parallel
prediction writers, a second refresh path, or bypass of the sport-scoped `prediction_pipeline:cfb`
lease. The sole existing CFB writer remains authoritative.

Production activation requires a new immutable and internally coherent set of every affected
model, distribution, probability, calibration, public-outcome, decision, grade, schema, collector,
member, writer, fixture, tracking, and presentation release/version identifier. Generated
snapshots and tracking evidence must stamp that set. Old rows remain immutable, and evaluation
must separate forward results by exact release set and locked timestamp; mixed-era aggregates may
not be reported as current-release performance.

Before merge, the production cutover must pass focused CFB tests, TypeScript, lint,
`npm run verify:model-change`, `npm run verify`, build, and integration safety against the latest
remote `main`. It must report before/after promotion, demotion, actionable, No Play, and coverage
counts for the same eligible board. It must use a clean, up-to-date protected PR and retain every
testing, current-main-ancestor, no-overlap, deployment, and live-proof requirement in this file
and `AGENTS.md`; this exception authorizes no bypass of branch protection or integration safety.

Prepare the preceding coherent release and reader snapshot before activation. Roll back or hold
the provisional release upon any mixed current-slate release identifiers, reader/writer release
or value incoherence, missing required price coverage presented as a normal model No Play,
writer/reader crash, overlapping writer or lease failure, stale pre-release snapshots resurfacing
during refresh, or unexpected actionable-board collapse relative to the preceding release on the
same covered cohort. After rollback, preserve all new rows as release-stamped evidence rather than
rewriting them. Live success requires production database and member-site proof of the expected
release set, one leased writer, coherent board and T-60 locks, current price coverage, reader
freshness, tracking separation, and site responsiveness.

## 1. Declare scope before editing

- Name every affected sport, market, model family, calibration layer, writer, reader, and cron.
- Record the current champion version/release identifiers.
- Identify the single authoritative write path and its sport-scoped lease.
- Check the worktree and preserve unrelated changes.

## 2. Version behavior, not filenames

- Any behavioral change requires a new immutable model or calibration release identifier.
- A release identifier must be stamped into generated snapshots and tracking evidence.
- Old rows remain historical evidence. Do not rewrite them to the new version.
- Reports must separate release eras and show the exact start time/date of each era.
- A fallback may read an older snapshot only for availability; it must remain visibly stamped
  as old and must never be counted as the active release.

## 3. Prove data and runtime coherence

- All scheduled prediction writers for a sport must use the shared `prediction_pipeline`
  lease. Do not create a second independent writer or timer.
- Odds, stats, context, model generation, publication, and locking run in that order.
- Frequent lock sweeps remain targeted to games entering the lock window; they must not turn
  into full-slate refreshes.
- Confirm provider coverage, stored-price coverage, model version, calibration version, and
  published-reader version agree before publication.
- Missing required evidence creates an internal hold/data-health finding. The
  member contract may present that exception as `NO_PLAY` only with an explicit
  incomplete-evidence reason and separate operational-exception accounting; it
  must not fabricate or count a completed model evaluation.

## 4. Calibrate with promotion/demotion balance

- Never tune on the same outcomes used for final evaluation.
- Use chronological train/calibration/holdout splits and report each separately.
- Report record, locked-price units/ROI, Brier score/log loss, calibration gap, and board count.
- Treat multiple correlated props from the same player/game as clusters when estimating
  uncertainty; row count alone overstates the independent sample.
- Every demotion rule must be paired with a tested promotion rule from an eligible candidate
  pool. Report promoted count, demoted count, net actionable-board change, and market mix.
- A promotion must improve held-out value or calibration without bypassing price, lineup,
  freshness, or data-quality gates.
- With insufficient held-out evidence, ship only shadow labels/audits—never live grades/stakes.

## 5. Bound load and failure behavior

- Reuse cached slate-level feature bundles; do not add per-card or per-user provider calls.
- Bound concurrency, pagination, snapshot size, retry count, and database writes.
- Failure must preserve the last coherent published snapshot and must not partially publish a
  new release.
- Do not clear or rewrite locked predictions as part of a model release.

## 6. Required verification

Run:

```bash
npm run verify:model-change
```

Then run focused tests/backtests for every affected model and a dry-run or shadow comparison
that reports old-versus-new decisions. Verify that unchanged markets remain unchanged.

## 7. Deployment and live proof

- Commit only intended files and deploy that exact commit.
- Verify production reports the expected release/version identifiers.
- Verify the latest writer completed under the shared lease with no overlapping writer.
- Verify odds/stat coverage, actionable counts, snapshot freshness, lock coherence, error rate,
  and site responsiveness.
- Re-run the live check after the next scheduled update and the next lock sweep.
- Do not say a change is live until production evidence proves it.

## 8. Rollback criteria

Prepare the previous release identifier and reader snapshot before promotion. Roll back or
hold the new release when any of these occur:

- mixed release identifiers on the same current slate;
- missing prices or required features presented as normal `NO_PLAY`;
- unexpected actionable-board collapse without the approved balanced replacement;
- overlapping prediction writers, timeout growth, snapshot-size failure, or reader crash;
- material disagreement between stored predictions and the member-visible snapshot.
