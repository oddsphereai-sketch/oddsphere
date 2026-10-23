# NBA player-props rebound transition candidate predeclaration

Date: 2026-10-23  
Status: offline research only; no member or writer change authorized

## Owner objective

Directional correctness and projection accuracy are the primary objectives.
Price and expected value remain secondary grading context and may not rescue a
weaker forecast. Existing locked snapshots remain immutable.

## Diagnosis available before the candidate test

The October 22 locked slate showed a distinct failure in standalone rebounds:
the active robust count model was 10-12 independently with 3.01 MAE and a
-1.58 rebound bias. The same slate's Points + Rebounds forecast was 12-4,
while the independent Rebounds + Assists and PRA forecasts were 13-3 and
16-3. This rules out one blanket adjustment to every rebound-bearing market.

The active robust rebound estimator uses a role-minutes regression whose
training support is late-season. Its `same_team_games_10` input is centered
near ten games with very little variance, while the opening-week slate is near
one. Replacing only that role-minutes regression with the already frozen
generic minutes regression improved the October 22 standalone-rebound
direction from 45.45% to 54.55% without changing any composite-market model.

## Frozen candidate

Evaluate one new standalone-rebound candidate:

- retain the active robust rebound opportunity/count coefficients;
- replace only their role-minutes input with the already fitted generic
  minutes regression;
- do not alter Points + Rebounds, Rebounds + Assists, PRA, points, assists,
  threes, any market line, or any outcome;
- do not numerically blend toward the sportsbook line or impose a side quota;
- do not modify market arbitration, probabilities, grades, stakes, provider
  cadence, writer topology, member presentation, or locked records in this
  test.

The candidate name is `robust_generic_minutes_counts`.

## Evidence and gates

The existing two-season dataset and the separate opening-season dataset are
development/diagnostic evidence because their outcomes have already been
opened. They may establish whether the candidate is broadly plausible but may
not be described as a new untouched release confirmation.

The candidate is eligible for a future-unlocked runtime rehearsal only if:

1. standalone-rebound direction is not worse than the active robust candidate
   on either dataset by more than 0.5 percentage points;
2. it improves direction or MAE on each dataset and does not create a material
   one-sided collapse;
3. the October 22 same-input comparison improves direction without worsening
   MAE by more than 0.10 rebounds;
4. every non-rebound forecast remains byte-for-byte unchanged;
5. the current-board impact includes paired promotions and demotions and does
   not flatten the board;
6. the next release-pure forward slate supplies final qualification before any
   public model claim.

Failure of a gate keeps the candidate offline. No result-aware manual player
override, fixed rebound addition, forced Over share, or locked-row rewrite is
permitted.

## Development addendum after the first candidate failed

`robust_generic_minutes_counts` lowered MAE in both historical datasets and
improved the October 22 direction, but it reduced opening-season confirmation
direction by 0.87 percentage points. It therefore failed gate 1 and is not
eligible for release.

Before another test, one successor is declared:

- fit the active role-minutes/robust-count path and the generic-minutes/robust-
  count path independently;
- calculate role support continuously from the fitted role model's own
  `same_team_games_10` mean and scale using a Gaussian support weight;
- blend the two complete rebound forecasts with that support weight;
- use no sportsbook line, side, result, player identity, manual addition, or
  tuned cutoff in the weight.

This candidate is `robust_support_weighted_minutes_counts`. The original gates
remain unchanged. Because the first candidate's outcomes are now development
evidence, only later release-pure forward results can provide final
qualification.

## End-to-end market-reading addendum

Passing the independent-projection gates does not qualify the member-facing
forecast. Before reviewing market-aware outcomes, two fixed arbitration
variants are declared around `robust_support_weighted_minutes_counts`:

- `support_weighted_market_read_2pp_disagreements` changes side only when the
  archived opening consensus disagrees with the independent forecast and is at
  least 2 percentage points from 50%;
- `support_weighted_market_read_5pp_disagreements` applies the same rule at 5
  percentage points.

Both variants preserve the independent projection's absolute distance from
the canonical line when a flip is called for. They do not blend the projection
toward the market, change an agreeing forecast, search player identities, use
outcomes, or alter grades. The two cutoffs are existing tournament policies,
not result-tuned thresholds.

The market-aware candidate advances only if its final direction is better than
the support-weighted independent forecast in both the two-season and separate
opening-season confirmation windows, does not materially worsen MAE, and does
not create a one-sided prediction collapse. Historical archives can validate
opening-consensus arbitration only; same-book movement, late price discovery,
and target-excluded live evidence still require release-pure forward scoring.
