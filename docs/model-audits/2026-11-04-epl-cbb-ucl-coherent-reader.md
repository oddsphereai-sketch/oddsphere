# EPL coherent relative-path reader and soccer/CBB provenance

## Scope and release tuple

- Rebased production base: `6193a178652f950e7b0539da62dc2f1036713021`.
- EPL model: `epl_goals_coherent_2026_11_04_r24_relative_path_joint_pmf`.
- EPL outcome: `epl_coherent_market_outcome_2026_11_04_r4_relative_path_joint_pmf`.
- EPL draw calibration: `epl_draw_calibration_2026_11_04_r2_joint_pmf_order_constraint`.
- EPL grade: `epl_grade_policy_2026_11_04_v29_relative_path_joint_pmf`.
- CBB adapter: `cbb_member_adapter_2026_11_04_r23_truthful_market_read_provenance`.
- UCL lifecycle: `ucl_member_snapshot_lifecycle_2026_11_04_r26_evidence_role_provenance`.

## Method

EPL keeps its statistical independent score distribution as the prior. Eligible Draw handling is a
minimum-information constraint on that distribution. Complete, chronological, same-book market
episodes may then update the law only through the normalized before/current source-profile density
ratio already used by UCL. The evaluated execution book is removed from the evidence vectors for
its market. Current market levels are never blended with the forecast, and a quote with no complete
prior capture is context only. Conflicting identity, clock, contract, or paired-price evidence fails
closed. One resulting PMF owns all public soccer markets and score fields.

The CBB and UCL changes are provenance-only. CBB future-unlocked breakdowns report the semantic
already stored on the selected top market; UCL future-unlocked provenance reports the coherent
outcome's evidence role. Neither changes numerical decisions.

## Safety and locks

No provider, collector, writer, schedule, or lease is added. EPL continues through the existing
soccer prediction pipeline and its `prediction_pipeline:soccer` lease; CBB continues through its
existing pipeline and `prediction_pipeline:cbb` lease. EPL and UCL locked readers prefer the exact
stored market, projection, and provenance payload. CBB's stored member-game reader returns the
captured locked DTO. New semantics are gated to future-unlocked construction and future locks clone
what members actually saw.

## Tests and board impact

Focused tests cover target exclusion, exact event/time identity, future evidence rejection,
same-book conflict rejection, home/away symmetry, Draw-in-PMF coherence, and derivation of every
market and expected score from the final joint law. Existing lock tests cover stored payload
precedence. CBB tests prove unlocked semantic truthfulness and unchanged legacy locked presentation;
UCL tests prove the evidence-role contract.

The paired grade rule is unchanged: the same existing exact-price thresholds can promote or demote
after the final PMF changes. No hidden demotion-only rule was added.

The read-only operator `scripts/operator/audit-epl-current-release-impact.ts` closed the current-board
gate at `2026-11-05T00:33:58.464Z`. It built the current statistical slate once, SELECTed stored line
history and the member snapshot once, and captured each of the ten current fixture inputs once. It
then replayed those exact captured fixtures and the same decision clock through the retained
r23/outcome-r3/grade-v28 law and candidate r24/outcome-r4/grade-v29 law. Input fingerprint:
`41252f7b745d41bf0a075346c1b499e813ab4dcaa01f46f28147da65c63e29fa`. Provider telemetry recorded
one Owls board request, zero The Odds API catalog or paid requests, zero credits, and zero writes.

Exact 10-game / 40-market board impact:

- promotions: 2;
- demotions: 3;
- actionable removals: 0;
- selected-side changes: 0;
- games with score changes: 10;
- markets with probability changes: 40;
- actionables: 6 before, 6 after, net 0.

The five grade changes were:

- COV@EVE BTTS No: 53.4521% Watchlist to 52.7955% No Play;
- MNC@NFO BTTS No: 53.6146% Watchlist to 52.9212% No Play;
- BRE@BHA Match Result BHA, market favorite: 50.0175% Watchlist to 49.6810% No Play;
- LIV@CRY Match Result LIV, market favorite: 49.2050% No Play to 50.2117% Watchlist;
- BOU@IPS Double Chance BOU or Draw: 74.9229% No Play to 76.1548% Watchlist.

All five retained their selected side. Each change came from the one coherent PMF after a qualified
target-excluded Match Result relative path; no current market level was adopted as a forecast target.
The full operator output includes every game's market side, favorite/draw/underdog role, before/after
score, probability, grade, source, applied market axes, and transition flags. The current-board
release gate is therefore resolved rather than reported as an invented zero.

## Rollback

Restore the preceding EPL r23/outcome r3/grade v28 runtime together for future-unlocked rows, the
CBB adapter r22 presentation, and UCL lifecycle r25 presentation. Never rewrite or reconstruct a
locked payload during rollback.
