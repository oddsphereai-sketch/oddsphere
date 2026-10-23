# NHL actionability calibration r21 — predeclaration — 2026-10-23

## Scope and frozen incumbent

This audit is limited to NHL regular-season decision calibration. It does not
change the independent score model, market-reader side selection, projection,
probability, price selection, refresh cadence, writer, lease, card layout, or
any locked record.

- Model: `nhl_regular_2026_r20_verified_current_board`
- Calibration: `nhl_regular_calibration_2026_r20_verified_current_board`
- Decision: `nhl_regular_decision_2026_r20_verified_current_board`
- Reader: `nhl_daily_edge_reader_2026_10_22_r16_verified_current_board`
- Sole writer/lease: the existing NHL prediction pipeline under
  `prediction_pipeline:nhl`

The audit was requested because the public NHL board appears too actionable for
the observed accuracy. The code-level hypothesis is that the downstream
exact-price decision layer currently lets every raw Lean remain actionable,
even when its stored selected-side probability has no positive edge over its
exact selected price. A failed Best Angle also falls only to Lean. That can make
grade labels weakly ordered without changing the underlying prediction.

## Frozen evidence and chronology

The audit will use only immutable NHL regular-season locks with official
settlements and the model probability, exact selected price, market, grade,
release, and locked timestamp stored at lock. Results will be reported by exact
release first. A combined transition analysis may be shown only as a clearly
labelled decision-policy diagnostic; it is not current-release performance.

The eligible decision-policy cohort begins with r14, when the current Best
Angle probability/edge policy was introduced. Games are ordered by `locked_at`
and kept intact across markets. The first 70% of games are the selection segment
and the final 30% are the untouched chronological confirmation segment. The
active r20 release is reported separately and is never blended into a claim
about r20 performance.

The exact 2026-10-23 unlocked board is a no-write impact check only. It cannot
select thresholds or substitute for settled confirmation.

## Candidate family

The score, side, probability, market reader, and exact price are frozen. Only a
single downstream actionability function may vary. Candidate boundaries will
come from a small predeclared grid:

- minimum exact-price edge for a Lean: 0pp, 1pp, 2pp, 3pp, or 5pp;
- market-specific minimum selected-side probability for a Lean:
  - Moneyline: 52%, 54%, 56%, 58%, or 60%;
  - Total: 52%, 54%, 56%, 58%, or 60%;
  - puck line: 54%, 56%, 58%, 60%, or 62%;
- Best Angle boundaries remain the released r14 boundaries unless the locked
  evidence demonstrates strictly ordered accuracy and value at a stronger
  boundary in both chronological segments;
- a Watchlist may promote to Lean under the same market-specific probability
  and edge qualification used to demote an incumbent actionable. This is the
  required symmetric promotion path; no quota or forced play is allowed.

Candidates are selected on the first 70% only. An eligible selection candidate
must retain at least 25% of priced markets, retain actionables in every market
family, and improve both actionable hit rate and exact-price units over the
incumbent. Among eligible candidates, selection ranks exact-price units first,
then actionable hit rate, then calibration gap. Ties prefer the simpler/lower
boundary and then the higher retained actionable count. The final 30% is opened
once for confirmation.

## Acceptance gates

A production candidate must meet all of these gates:

1. Keep every score, side, probability, selected line, selected price, and
   market-reader result unchanged.
2. Improve or preserve confirmation actionable hit rate and exact-price units
   versus the incumbent, both overall and without a material regression in any
   market with at least ten confirmed actionables.
3. Show grade ordering on confirmation: Best Angle must not underperform Lean,
   and actionable plays must outperform Watchlists, subject to sample size.
4. Report Brier score, log loss, calibration gap, win/loss/push record, units,
   promotions, demotions, and before/after actionable board count by market and
   segment.
5. Retain at least one tested promotion rule for every demotion rule and avoid a
   flat board. The confirmation actionable count must remain at least 25% of
   priced markets overall and at least one market family must not disappear.
6. Preserve locked writer immutability and stored-reader precedence.
7. Pass `npm run verify:model-change`, the focused NHL tests, TypeScript, the
   exact current-board no-write rehearsal, and integration-safety verification
   against the latest `origin/main`.

If the confirmation evidence fails these gates, no live decision-policy change
will be shipped. The failed candidate and the measured incumbent problem will
be documented rather than hidden behind a flatter board.
