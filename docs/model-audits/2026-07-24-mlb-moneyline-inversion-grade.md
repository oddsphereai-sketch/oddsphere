# MLB moneyline final-side inversion grade audit — 2026-07-24

## Decision

Release `mlb_daily_edge_decision_2026_07_24_r3` adopts one authoritative
inversion-grade contract:

1. The inversion must survive every downstream side selector and change the
   final published side.
2. The final side must have a real price better than `-220`.
3. Data quality must be `high` and the row must not be provisional.
4. The inversion recommendation probability must exceed the final-side market
   probability by at least `0.5pp`.
5. Expected value at the final offered price must be positive.
6. A qualifying inversion is exactly `Lean`.
7. A failing inversion may retain the corrected final side for transparency,
   but is `No Play` with a specific hold reason.
8. Inversion status alone can never produce `Best Angle`. Best Angle remains
   unavailable to the inversion branch and continues to require the ordinary
   moneyline Best Angle gates.

This is implemented in the single `predictionRecordService` decision path.
It adds no writer, cron, provider call, query, retry, or refresh. The existing
MLB `prediction_pipeline` lease remains authoritative.

## Probability and value semantics

An inversion deliberately selects the side rated lower by the base model.
Therefore the raw opposite-side base-model probability and edge are retained
as audit fields; requiring them to be positive would make every inversion
impossible by definition.

The public inversion recommendation probability is the correction layer's
bounded `55%`–`60%` probability substrate. Release r3 uses that same displayed
probability consistently for:

- the final-side inversion edge;
- expected value at the offered price;
- the Lean actionability gate.

The raw opposite-side base-model probability remains clearly labeled
`audit_only`. The correction probability is not sufficient for Best Angle.

## Frozen historical reconstruction

Source: locked `prediction_records` joined to `prediction_grades`.

Inclusion:

- sport `mlb`;
- market `moneyline`;
- `locked_at IS NOT NULL`;
- settled `win` or `loss`;
- `snapshotHasTrueMoneylineInversion(snapshot_json)`;
- excludes launch-day and held rows.

Release grouping uses, in order:

1. `snapshot_json.decision_pipeline.release_id`;
2. `snapshot_json.model_layer_versions.decision_release_id`;
3. `legacy_unstamped`.

All 18 settled historical rows are `legacy_unstamped`. They must not be called
performance of r2 or r3.

### Aggregate

| Release | Bets | Record | Profit | ROI | Odds range | Median odds | Avg break-even |
|---|---:|---:|---:|---:|---:|---:|---:|
| `legacy_unstamped` | 18 | 11–7 | +1.9034u | +10.57% | -170 to +145 | -118 | 54.05% |
| `mlb_daily_edge_decision_2026_07_23_r2` | 0 settled | — | — | — | — | — | — |
| `mlb_daily_edge_decision_2026_07_24_r3` | 0 settled | — | — | — | — | — | — |

The point result is genuine. Its uncertainty is large:

- win rate: 61.11%;
- Wilson 95% interval: 38.62%–79.69%;
- game-cluster bootstrap ROI 95% interval: -31.02% to +50.81%;
- bootstrap probability of non-positive ROI: 30.55%.

There is one inversion per game, so the game-cluster and row bootstrap are
identical here.

### Probability, edge, EV, and grade fields

Across the 18 legacy rows:

| Field | Average |
|---|---:|
| Raw opposite-side base-model probability | 48.01% |
| Displayed inversion recommendation probability | 57.09% |
| Final-side market probability | 51.84% |
| Raw opposite-side edge | -3.84pp |
| Raw opposite-side EV | -11.06% |
| Displayed inversion-probability EV | +7.42% |

Original model grades were 4 Best Angle, 12 Lean, and 2 Provisional. The
legacy lock schema did not preserve a final public grade for any of the 18.
Six rows are currently marked No Bet. Therefore the defensible statement is
“18 settled genuine final-side inversion outcomes were 11–7,” not “18
release-stamped public inversion Leans were 11–7.”

### Every settled genuine final-side inversion

`Final grade = unavailable` means the legacy immutable snapshot did not store
the member-facing final grade. No grade is reconstructed or invented.

| ID | Locked date | Matchup | Final side | Odds | Raw final P | Inversion P | Market P | Inversion EV | Original grade | Final grade | DQ | Result |
|---:|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|
| 31456 | 2026-06-22 | CLE@CWS | home | -105 | 42.04% | 59.70% | 48.92% | +16.56% | Best Angle | unavailable | high | W |
| 31465 | 2026-06-22 | BOS@COL | home | +105 | 42.54% | 58.00% | 46.75% | +18.90% | Provisional | unavailable | low | W |
| 34355 | 2026-06-23 | MIL@CIN | away | -118 | 50.16% | 55.60% | 51.74% | +2.72% | Lean | unavailable | high | W |
| 38546 | 2026-06-24 | KC@TB | away | +125 | 39.30% | 59.40% | 42.55% | +33.65% | Best Angle | unavailable | high | L |
| 45023 | 2026-06-26 | TEX@TOR | home | -112 | 43.03% | 58.20% | 49.68% | +10.16% | Best Angle | unavailable | high | L |
| 45029 | 2026-06-26 | HOU@DET | home | -110 | 44.08% | 57.70% | 51.99% | +10.15% | Lean | unavailable | high | W |
| 45049 | 2026-06-26 | COL@MIN | away | +145 | 40.00% | 57.10% | 41.29% | +39.89% | Provisional | unavailable | low | L |
| 46111 | 2026-06-26 | KC@CWS | home | -134 | 47.70% | 55.60% | 55.07% | -2.91% | Lean | unavailable | high | W |
| 47082 | 2026-06-27 | NYY@BOS | home | +105 | 42.93% | 57.70% | 46.75% | +18.28% | Best Angle | unavailable | high | W |
| 63046 | 2026-07-04 | PHI@KC | away | -160 | 53.56% | 55.80% | 59.12% | -9.32% | Lean | unavailable | high | W |
| 68201 | 2026-07-06 | HOU@WSH | home | -130 | 50.38% | 56.30% | 53.68% | -0.39% | Lean | unavailable | high | W |
| 70028 | 2026-07-07 | ATL@PIT | home | -170 | 50.18% | 55.50% | 60.18% | -11.85% | Lean | unavailable | high | W |
| 76495 | 2026-07-10 | HOU@TEX | away | -145 | 55.24% | 56.90% | 56.34% | -3.86% | Lean | unavailable | high | L |
| 80100 | 2026-07-11 | CLE@MIA | home | -155 | 56.80% | 56.00% | 57.76% | -7.87% | Lean | unavailable | high | L |
| 83778 | 2026-07-12 | CHC@CIN | away | -135 | 53.41% | 55.10% | 54.68% | -4.09% | Lean | unavailable | high | W |
| 83785 | 2026-07-12 | SEA@TB | home | -135 | 53.39% | 55.30% | 54.68% | -3.74% | Lean | unavailable | high | L |
| 91274 | 2026-07-20 | BAL@BOS | away | +123 | 41.79% | 59.60% | 42.90% | +32.91% | Lean | unavailable | high | L |
| 94161 | 2026-07-22 | NYM@MIL | home | -160 | 57.73% | 58.10% | 59.12% | -5.59% | Lean | unavailable | high | W |

### Price distribution

| Final odds bucket | Bets | Record | Profit | ROI |
|---|---:|---:|---:|---:|
| `<= -150` | 4 | 3–1 | +0.8382u | +20.96% |
| `-149 .. -110` | 8 | 5–3 | +1.0128u | +12.66% |
| `-109 .. +99` | 1 | 1–0 | +0.9524u | +95.24% |
| `+100 .. +129` | 4 | 2–2 | +0.1000u | +2.50% |
| `>= +130` | 1 | 0–1 | -1.0000u | -100.00% |

The buckets are too small to justify a tuned price cutoff. Release r3 therefore
uses the existing ordinary Lean price floor (`> -220`) as a safety invariant,
not a fitted historical threshold.

## Candidate-rule replay and board impact

| Rule | Historical retained | Record | Profit | ROI | Demoted vs all-inversion Lean |
|---|---:|---:|---:|---:|---:|
| Every genuine inversion is Lean | 18 | 11–7 | +1.9034u | +10.57% | 0 |
| Require positive raw-model edge and EV | 0 | — | — | — | 18 |
| Require positive inversion edge/EV + high DQ + normal price | 7 | 4–3 | +0.7589u | +10.84% | 11 |
| High DQ + normal price, no value gate | 16 | 10–6 | +1.8534u | +11.58% | 2 |

Requiring positive raw-model value is incoherent: it eliminates the inversion
branch by definition and has no promotion counterpart. It is rejected.

The official rule uses inversion-specific positive edge/EV plus safety gates.
The historical point ROI remains similar, but the 7-row subset is not claimed
as independent validation because it comes from the same legacy cohort used
to compare rules.

On the frozen July 24 r2 board:

- moneyline rows: 11;
- actionable moneylines: 3 (2 Best Angles, 1 Lean);
- genuine inversions: 1;
- r3 promotions versus the ordinary non-inversion grade: 1 (TOR–BOS to Lean);
- r3 demotions versus the public r2 board: 0;
- net current-board change: 0.

The demotion branch is paired with the tested promotion branch: a
high-quality, positively priced genuine inversion is promoted to Lean even
when the ordinary post-correction grade is non-actionable. Unit coverage also
proves low-quality and negative-EV inversion candidates remain No Play.

## TOR–BOS locked audit

Locked record `95762`:

- slate: `2026-07-24`;
- lock: `2026-07-24T22:16:11.916+00:00`;
- r2 decision release: `mlb_daily_edge_decision_2026_07_23_r2`;
- calibration: `mlb_public_calibration_v4_2026_07_23`;
- original side: Toronto (`away`) at +110;
- final side: Boston (`home`) at -130;
- genuine final-side change: yes;
- raw Boston base-model probability: 52.90%;
- Boston market probability: 54.27%;
- raw Boston edge: -1.4pp;
- raw Boston EV: -6.41%;
- inversion recommendation probability: 58.10%;
- inversion edge: +3.83pp;
- inversion EV at -130: +2.79%;
- data quality: high;
- provisional: false;
- final r2 public grade: Lean;
- Best Angle: false.

Boston was Lean because r2 treated a genuine final-side inversion as its own
validated action class. It was not Best Angle because inversion status
explicitly blocks Best Angle. Release r3 makes the missing part explicit:
Boston clears the inversion-specific positive-edge, positive-EV, price, and
data-quality Lean gates. A similar inversion that fails those gates is No Play.

## Locking, tracking, and reader coherence

- `predictionRecordService` is the sole Daily Edge decision writer.
- `tracking-refresh`, `slate-cycle`, and the T-60 `pregame-sweep` use the shared
  MLB `prediction_pipeline` lease.
- T-60 computes the expected record, verifies stored-row coherence, then locks.
- Locked rows are skipped by later writer upserts.
- `member_facing_at_lock` freezes side, price, grade, and model-layer versions.
- Daily Edge resolves the locked grade from that frozen substrate.
- Tracking uses the same `member_facing_at_lock` grade before stored fallbacks.
- r3 stamps the grade-rule decision, edge, EV, raw audit probability, and exact
  failure reason into `ml_inversion_grade_resolution`.

## Strategy boundary

This release changes only model-grade coherence. It does not change the
separate betting-strategy release or the `0.25u / $6.25` inversion stake.

The strategy evidence should be described conservatively: the 11–7 result is a
legacy, unstamped final-side outcome cohort with wide uncertainty, not settled
performance of r2 or r3. Any future strategy/stake change must be a separate,
release-versioned decision after r3 accumulates locked settled evidence.

## Rollback

Rollback decision release: `mlb_daily_edge_decision_2026_07_23_r2`.

Rollback if production shows mixed decision releases on the current unlocked
slate, an inversion Best Angle, missing grade-resolution audit, lock/reader
disagreement, writer overlap, or unexpected actionable-board collapse.
