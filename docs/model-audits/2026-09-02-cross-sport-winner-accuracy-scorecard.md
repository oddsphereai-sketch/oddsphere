# Cross-sport winner-accuracy scorecard

Status: behavior-neutral, local-only reporting candidate. It does not change a
prediction, settlement, grade, stake, writer, lease, API, cron, or member page.

## Why this is separate from the current tracker

The member/admin tracker is a recommendation-performance surface. Its headline,
Yesterday, Week, and Month aggregates combine eligible rows across release eras,
then show release only as a secondary `byModelVersion` dimension. That dimension
is not a complete release identity for MLB. Its canonicalization also prefers the
strongest stored play grade when more than one row represents a game/market. That
is appropriate for the existing product record, but it is not a valid rule for a
forecast-quality scorecard.

The legacy weekly calibration job reads `prediction_results`, joins mutable
prediction confidence fields, and groups by sport/market/time window without a
model-release key. It must not be described as release-pure winner calibration.

## Frozen scorecard contract

Contract: `winner_accuracy_scorecard_v1_release_pure_locked_window_2026_09_02`.

- Only immutable, locked, settled winner markets are eligible: MLB/NFL/CFB/WNBA
  Moneyline and EPL Match Result.
- Calendar selection uses `locked_at` in `America/New_York`, never `slate_date`
  or the time a result happened to settle.
- Every group has one sport-specific release tuple. Same-game rows from different
  releases remain separate. An exact game/release/lock duplicate fails closed.
- MLB release identity includes decision release, Moneyline probability head,
  and calibration release from `snapshot_json.model_layer_versions`.
- CFB uses the immutable model/decision/calibration tuple plus tracking-record
  release. WNBA uses model/distribution/grade/record-contract releases. EPL uses
  model and calibration releases. NFL uses its immutable model/decision/
  calibration tuple plus official tracking-record release when records exist.
- Two-way Brier/log loss use the stored selected-side probability and its exact
  complement. EPL uses the complete locked home/draw/away vectors and reports the
  multiclass Brier sum plus multiclass log loss.
- The market benchmark is the locked two-way favorite or EPL three-way plurality.
  Ties and incomplete vectors are unavailable, never guessed.
- Favorite/underdog selection and hit rates, upset precision/recall, EPL draw
  precision/recall, and model-versus-market disagreement outcomes are reported
  independently of play grade.
- Exact-price one-unit ROI is a betting-economics metric. It is reported for all
  priced directional calls and separately for actionable Best Angle/Lean rows.
  It never changes winner accuracy.
- CLV is reported only when the locked row contains an explicit comparable
  `closing_line_value.clv_pct`. Coverage is always displayed; missing closing
  evidence is not replaced with a current or different-book price.

## Production inventory at audit time

The SELECT-only inventory found 1,328 locked and binary-settled winner records:
MLB 1,129, CFB 6, WNBA 173, EPL 20, NFL 0. There were two historical MLB
game/market identities represented by different releases and zero duplicates at
the exact release-plus-lock identity.

Examples of why release separation matters:

- The newest MLB r79 release had six locked Moneylines but no settled rows yet.
  The September 1 results were split across r76, r77, and r78; combining those
  into one "current model" result would be false.
- The only settled CFB winner cohort was 4-2 while the locked market favorite was
  5-1. The sample is six and cannot support a broad performance claim.
- The current WNBA exact-tuple cohort was 22-7 versus 21-8 for the market favorite.
- EPL r16/v21 was 12-8 versus 11-9 for market plurality. It selected no draws
  while four of the 20 matches ended drawn, so draw recall was 0/4.
- NFL has no official settled game-level winner rows; the correct output is an
  empty state, not a historical or research backfill.

These figures are descriptive checks of stored immutable records, not model
selection evidence. Small samples stay visible and are never pooled merely to
produce a more reassuring percentage.

## Smallest safe production path

Keep the scorer pure. The operator script performs bounded, paginated SELECTs and
can run a current-day (`nightly`) or prior-day (`morning`) locked cohort. Before a
member or admin presentation is added, review this contract and decide whether
the report should remain operator-only or be exposed through a new authenticated,
read-only endpoint. Do not add a new settlement writer or materialized report
table merely to schedule it; the scorecard can be derived from the existing
immutable rows and cached outside the prediction pipeline.
