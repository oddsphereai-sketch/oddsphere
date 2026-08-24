# NFL Week 1 grading tiers — r3

Date: 2026-08-24

## Release decision

Ship the predeclared, non-actionable moneyline Watchlist and reject the Best Angle candidate.
The qualified r10 discrete joint forecast, representative scores, moneyline/spread/total
probabilities, r6 exact-price model, r6+r10 Lean direction guard, price selection, stakes,
tracking boundary, writer, lease, and provider calls are unchanged.

New release identifiers:

- grade policy: `nfl_v1_grade_policy_2026_08_24_r3`;
- decision: `nfl_v1_daily_edge_decision_2026_08_24_r3_grading_tiers`;
- member: `nfl_v1_member_release_2026_08_24_r3_grading_tiers`;
- member fixture: `nfl_week_one_member_fixture_2026_08_24_r4_grading_tiers`.

The r6 and r10 model/calibration/artifact releases remain unchanged because this release changes
only the grade taxonomy around their already-stored coherent tuples.

## Frozen chronology and fields

The matching predeclaration was committed before outcome inspection. The r6/r10 models retain
their existing 2021–22 development. Grade rules were selected on 2023, then opened once on 2024
and 2025. Inputs were limited to the timestamped exact opening offer, r6 probability/EV/edge and
fair comparator, and r10 PMF winner. Results and closing line were evaluation-only. No final
starter, injury, weather, split, or outcome leaked into a rule.

These years were inspected by earlier NFL research, so the test is a disciplined tiering audit
over fixed live models rather than a pristine alpha discovery.

## Best Angle: rejected

The 2023 selector chose the uncapped subgroup `EV >= 2%` and `edge >= 4pp`, always inside the
existing bounded direction-coherent Lean cohort.

| Period | Actions | Record | Units | ROI | Mean CLV | CLV+ |
|---|---:|---:|---:|---:|---:|---:|
| 2023 selection | 44 | 32-12 | +9.219u | +20.95% | +0.485pp | 54.55% |
| 2024 confirmation | 37 | 24-13 | +3.887u | +10.50% | +0.635pp | 48.65% |
| 2025 confirmation | 66 | 42-24 | +2.396u | +3.63% | +0.012pp | 36.36% |
| 2024–25 pooled | 103 | 66-37 | +6.282u | +6.10% | +0.236pp | 40.78% |

Both seasons remained positive after removing the largest win. However, the predeclared
week-cluster uncertainty gates failed: probability of positive units was only 84.31%, and the
95% ROI interval was -5.77% to +18.32%. The required gates were 90% and a lower bound above
zero. Therefore:

- Best Angle promotions: **0**;
- Lean demotions: **0**;
- no Best Angle stake or label is authorized.

## Watchlist: qualified as monitoring only

The 2023 count-only selector chose the narrowest frozen boundary: r6/r10 direction disagreements
plus direction-coherent r6 tuples with both `EV >= -1%` and `edge >= -1pp`. Every public side is
the r10 PMF winner, and every displayed public tuple is timestamped and inside `-300` through
`+300`. Existing Leans and true data Holds are excluded.

| Period | Rows | Result if blindly bet | Units | ROI | Mean CLV | CLV+ |
|---|---:|---:|---:|---:|---:|---:|
| 2023 selection | 48 | 24-24 | -6.357u | -13.24% | +0.542pp | 52.08% |
| 2024 confirmation | 59 | 37-22 | +5.223u | +8.85% | +0.169pp | 47.46% |
| 2025 confirmation | 44 | 22-22 | -2.853u | -6.48% | +0.003pp | 36.36% |
| 2024–25 pooled | 103 | 59-44 | +2.371u | +2.30% | +0.098pp | 42.72% |

The week-cluster diagnostic was intentionally not a Watchlist profitability gate: probability
of positive units was 61.25%, and the 95% ROI interval was -13.44% to +18.36%. This is why the
lane is `Watchlist`, never Lean/Best Angle. It passed the declared semantic gates: sufficient
rows in each season, zero Lean overlap, bounded complete tuples, and 100% r10 public-side
fidelity.

The resulting confirmation taxonomy is exhaustive across the 271 priced decisions per season.
Best Angle is zero because its gate failed; its 37/66-row candidate remains included inside the
live Lean rows.

| Season | Live tier | Rows | Record | Units | ROI | Mean CLV | CLV+ |
|---|---|---:|---:|---:|---:|---:|---:|
| 2024 | Best Angle | 0 | 0-0 | 0.000u | — | — | — |
| 2024 | Lean | 72 | 54-18 | +16.080u | +22.33% | +0.482pp | 45.83% |
| 2024 | Watchlist | 59 | 37-22 | +5.223u | +8.85% | +0.169pp | 47.46% |
| 2024 | No Play | 140 | 97-43 | -3.435u | -2.45% | +0.588pp | 53.57% |
| 2025 | Best Angle | 0 | 0-0 | 0.000u | — | — | — |
| 2025 | Lean | 104 | 67-37 | +2.295u | +2.21% | +0.019pp | 36.54% |
| 2025 | Watchlist | 44 | 22-22 | -2.853u | -6.48% | +0.003pp | 36.36% |
| 2025 | No Play | 123 | 84-39 | -17.366u | -14.12% | +0.133pp | 44.72% |

No Play returns are shown only to prove the taxonomy partition. A high favorite win count does
not make those exact prices profitable or actionable.

## Latest authoritative Week 1 replay

A read-only production SELECT examined 64 immutable rows and replayed the exact latest row for
all 16 games, captured through `2026-08-24T11:06:13.297Z`. It made no writer, cron, provider, or
database mutation.

- full board: **7 Lean / 3 Watchlist / 38 No Play / 0 Held / 0 Best Angle** across 48 markets;
- moneyline: 7 Lean / 3 Watchlist / 6 No Play;
- spread: 16 No Play;
- total: 16 No Play;
- actionable promotions: 0; actionable demotions: 0; net actionable change: 0.

Exact Watchlists:

- NE@SEA: SEA, DraftKings -185 (near exact-price boundary);
- BUF@HOU: BUF, FanDuel -106 (r6 value / r10 winner disagreement monitoring);
- DEN@KC: DEN, FanDuel +130 (r6 value / r10 winner disagreement monitoring).

Exact current Leans retained:

- LAR -180 Fanatics; TEN -138 FanDuel; BAL -180 DraftKings; CHI -145 BetMGM;
- MIN -110 BetRivers; PHI -205 DraftKings; DAL -146 FanDuel.

Natural price/model movement explains why the latest board contains seven rather than the prior
eight Leans. The tier release did not demote one: it replayed the latest authoritative tuples.

## Runtime and failure behavior

The existing leased `/api/cron/nfl-forward-evidence` writer remains the only writer. On its next
due capture it stamps the new decision/member release into the same append-only payload. Member
reads still make zero provider calls.

Moneyline grade order is now:

1. healthy bounded r6 qualifier aligned with r10 winner: Lean;
2. healthy bounded direction disagreement or selected near-boundary tuple: Watchlist;
3. coherent nonqualifier: No Play;
4. real identity, quote, quarterback-history, injury, or market-completeness failure: Held.

Projected-but-coherent quarterbacks and unavailable SharpAPI splits remain visible context, not
automatic Holds. Spread and total predictions remain visible No Plays. No Best Angle, stake,
tracking row, team/game identity write, manual backfill, or cron invocation is part of r3.

## Rollback

Restore the r2 decision/member identifiers and r3 member fixture behavior (Lean/No Play/Held).
Do not alter immutable forward-evidence rows. The r10 forecasts and r6 exact-price tuples require
no rollback because this release does not change them.
