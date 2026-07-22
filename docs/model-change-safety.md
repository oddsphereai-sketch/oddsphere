# Model change safety protocol

This is the required release checklist for any change that can affect predictions, model
inputs, probabilities, projections, grades, promotions/demotions, calibration, prices used,
or stakes. It exists to prevent mixed model eras, competing writers, accidental board
flattening, and load spikes.

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
- Missing required evidence creates a visible hold/data-health finding, not an ordinary
  model `NO_PLAY`.

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
