# NFL spread and total exact-price grading audit r1

Date: 2026-08-24
Tournament: `nfl_spread_total_grading_tournament_2026_08_24_r1`
Decision: reject both actionable lanes; preserve the existing board
Production promotions / demotions: 0 / 0

## Outcome

The separate Spread and Total exact-price pass did not validate an actionable
grade. Spread produced no 2023 rule that cleared the frozen selection gates.
Total selected one rule on 2023, then lost in both 2024 and 2025 and failed six
of the nine frozen confirmation gates. Neither market produced a semantically
qualified Watchlist cohort or a selection-qualified Best Angle subgroup.

The active r10 forecasts remain useful member-facing predictions. This result
means only that the tested exact-price betting layer cannot honestly turn those
predictions into Leans or Best Angles. All 16 spreads and all 16 totals remain
No Play. Moneyline's seven Leans, three non-actionable Watchlists, and six No
Plays remain exactly as released in r3.

No model, calibrated probability, score, selected side, writer, provider call,
lease, stake, lock, tracking record, reader layout, or production release is
changed by this audit.

## Frozen protocol and data

The protocol was committed before outcomes were inspected in
`2026-08-24-nfl-spread-total-grading-predeclaration.md`.

- Policy selection: 2023 only.
- Confirmation: 2024 and 2025, reported separately and pooled.
- 805 unique games and 5,410 target-book market offers across the three years.
- Exact target opening line and two-sided price from one sportsbook.
- Target sportsbook excluded from a same-line no-vig consensus of at least two
  other conventional sportsbooks.
- Qualified r10 discrete PMF supplied cover/Over probabilities and push mass.
- Prices were bounded -130 through +130, target price had to be at least as
  favorable as the other-book consensus, and exact EV preserved push outcomes.
- Fixed Spread key-number and Total-zone cushion penalties were applied.
- Opening timestamps had to precede kickoff. Historical closing movement was
  evaluation-only CLV and never a selection input.
- No quota, forced minimum, outcome backfill, final injury report, or closing
  line entered the decision policy.

The historical feature and opening cache checksums and the qualified r10 source
are stored in the ignored deterministic JSON report.

## Spread result

The 36-rule frozen grid produced zero selection-eligible rules. Even its least
bad largest-win-independent candidate failed decisively:

| 2023 rule | Bets | Units | ROI | Units excluding largest win | Mean CLV | CLV+ |
|---|---:|---:|---:|---:|---:|---:|
| EV 3%, edge 1pp, cushion 1.0 | 82 | -4.849u | -5.91% | -5.849u | -0.085pt | 23.2% |

Because there was no selection-qualified Lean rule, Spread had no eligible
Watchlist parent lane and no Best Angle subgroup. Spread authorization is zero.

## Total result

The frozen selector chose EV at least 4%, leave-one-book-out edge at least 1pp,
and base cushion at least 0.5 point.

| Period | Bets | W-L-P | Units | ROI | Units excluding largest win | Mean CLV | CLV+ |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2023 selection | 66 | 33-29-4 | +1.528u | +2.32% | +0.548u | +0.333pt | 50.0% |
| 2024 confirmation | 68 | 33-35-0 | -4.437u | -6.53% | -5.389u | +0.243pt | 47.1% |
| 2025 confirmation | 109 | 54-55-0 | -4.523u | -4.15% | -5.503u | +0.138pt | 22.9% |
| 2024-25 pooled | 177 | 87-90-0 | -8.960u | -5.06% | -9.940u | +0.178pt | 32.2% |

Weekly-cluster bootstrap over the 36 confirmation weeks:

- probability of positive units: 25.43%;
- 95% unit interval: -35.850u to +17.585u;
- 95% ROI interval: -20.08% to +10.16%.

The rule passed count, mean-CLV, and multi-book checks. It failed positive pooled
units, positive units in each season, largest-win independence, CLV+ frequency,
bootstrap probability, and bootstrap ROI floor. Total Lean is rejected.

The non-actionable Watchlist widths produced only 13, 14, and 15 selection rows;
the frozen minimum was 18. No Total Watchlist is authorized. All twelve frozen
Best Angle subgroups failed the selection gates; no confirmation subgroup was
opened and no Best Angle is authorized.

## Latest authoritative Week 1 replay

One read-only production SELECT returned 64 immutable rows and the exact latest
16 games through `2026-08-24T11:06:13.297Z`. The current member release remained
`nfl_week_one_member_fixture_2026_08_24_r4_grading_tiers`. There were zero cron,
provider, writer, or database mutations.

| Game | Spread prediction / exact quote | Total prediction / exact quote |
|---|---|---|
| NE@SEA | NE +3.5, 54.5%, FanDuel -108 | Over 44.5, 59.1%, FanDuel -115 |
| SF@LAR | LAR -3.5, 51.5%, FanDuel -115 | Under 48.5, 53.4%, FanDuel -110 |
| NYJ@TEN | NYJ +2.5, 53.7%, FanDuel -115 | Over 39.5, 56.4%, FanDuel -118 |
| TB@CIN | TB +3.5, 53.3%, FanDuel -105 | Under 51.5, 59.1%, FanDuel -110 |
| NO@DET | NO +7, 58.1%, FanDuel -110 | Under 49.5, 54.5%, FanDuel -120 |
| BAL@IND | IND +3.5, 50.1%, FanDuel -115 | Under 48.5, 56.7%, FanDuel -110 |
| ATL@PIT | PIT -3, 52.0%, FanDuel -110 | Over 41.5, 57.6%, FanDuel -115 |
| CHI@CAR | CAR +2.5, 51.2%, FanDuel -102 | Under 47.5, 59.5%, FanDuel -106 |
| CLE@JAX | JAX -7.5, 56.9%, FanDuel -115 | Over 40.5, 60.6%, FanDuel -118 |
| BUF@HOU | BUF +1.5, 56.7%, FanDuel -120 | Over 44.5, 57.5%, FanDuel -112 |
| MIA@LV | MIA +3.5, 70.5%, FanDuel -104 | Over 40.5, 58.9%, FanDuel -110 |
| GB@MIN | MIN -1.5, 55.2%, FanDuel -102 | Under 45.5, 59.3%, FanDuel -114 |
| WSH@PHI | WSH +5.5, 53.0%, FanDuel -110 | Under 46.5, 58.6%, FanDuel -115 |
| ARI@LAC | ARI +10.5, 65.4%, FanDuel -114 | Under 46.5, 55.9%, FanDuel -110 |
| DAL@NYG | NYG +2.5, 52.0%, FanDuel -102 | Under 48.5, 59.0%, FanDuel -110 |
| DEN@KC | DEN +2.5, 61.1%, FanDuel -104 | Under 43.5, 65.3%, FanDuel -118 |

All 32 rows remain visible predictions with exact prices and No Play grades.
The complete 48-market board remains 7 Lean / 3 Watchlist / 38 No Play / 0
Held / 0 Best Angle. Applied promotions, demotions, and net action change are all
zero.

## Decision and next evidence

Do not loosen thresholds or relabel these high directional probabilities as
bets. The tested r10 exact-price Spread lane could not even pass selection, and
the selected Total lane failed both confirmation seasons.

Continue collecting the existing immutable opening, unlocked, and T-60 evidence
under the single leased writer. A materially different future candidate must be
predeclared and should add genuinely timestamped availability/movement evidence
or improve the underlying spread/total probability calibration; it must not
reuse this rejected policy under a new name.
