# NBA player props product blueprint

## Product outcome

NBA props should appear as another league inside the existing OddSphere Props
experience—not a separate product. The board keeps the current hierarchy,
grades, filters, team/player identity, and one-line-per-market behavior. The
reader uses real NBA evidence appropriate to the selected prop and never fills
space with invented metrics.

## Market-specific reader evidence

| Market family | Primary independent evidence | Matchup and game evidence |
| --- | --- | --- |
| Points | expected minutes, usage, FGA/3PA/FTA, shot zones, true shooting, role with current teammates | opponent allowed attempts/efficiency by zone and play type, pace, game total, spread/blowout risk |
| Rebounds | expected minutes, rebound chances, offensive/defensive rebound rates, lineup role | expected opponent misses, team rebound competition, opponent shot profile, size/lineup context |
| Assists | expected minutes, touches, passes, potential/secondary assists, usage and on-ball role | teammate shot conversion, opponent scheme, pace, lineup creation burden |
| Threes | expected minutes, 3PA rate, catch-and-shoot/pull-up mix, zone mix and efficiency | opponent three volume/zone allowance, closeout profile, expected possessions |
| Blocks/Steals/Stocks | expected minutes, event opportunities, deflections, rim contests, foul risk | opponent rim attempts, turnover profile, ball-handler/lineup context |
| PRA/PR/PA/RA | joint simulated components and their correlations | same game/lineup state used once across every component |
| Double/Triple Double | joint count distribution and achievement probability | minutes ceiling, role ceiling, game environment and correlated component tails |

The compact card remains prediction-first. Full evidence, the price ladder,
opening/prior/current movement, source-separated market read, projection range,
and matchup details load only when the reader opens.

## Data and model flow

1. Capture the NBA schedule and authoritative player/game identity.
2. Capture injuries, active players, expected lineup/rotation, and provider prop
   observations. Store immutable observations; never refetch from a member page.
3. Build point-in-time player/team/opponent features using only evidence known
   before the evaluation timestamp.
4. Estimate participation and minutes distributions.
5. Score independent market-specific rates and one correlated simulation.
6. Build one canonical main line plus internal alternate-line evidence.
7. Read target-excluded opening/prior/current market state and apply only a
   historically qualified NBA/market-specific arbitration rule.
8. Emit one coherent projection, side, probability, exact target price, EV and
   grade. Compress the member snapshot; defer reader evidence.
9. Freeze at the authorized lock boundary. Settle from official box scores and
   retain release IDs, evidence IDs, closing quote and DNP/void reason.

## Safe cadence and load design

- Baseline player/team histories and slower advanced aggregates: once after
  official results, then cached.
- Schedule and opening props: once per new slate, with bounded retry.
- Injuries/active lineups: game-day cadence, faster only near tip.
- Current props: per-game incremental captures, slow when far from tip and at
  T-180, T-60, T-15, and the lock boundary. Exact cadence remains disabled until
  provider timing and budget are measured on real slates.
- BALLDONTLIE supplies the broad board. The Odds API is restricted to missing or
  reference games and declared checkpoints; historical requests are operator-run
  audits with a written credit ceiling.
- One future writer uses the existing NBA prediction-pipeline lease. It performs
  one append/update transaction per run, not per card or player.
- The member board reads a prebuilt compact snapshot. The reader fetches stored
  evidence by selected player only.

## Required validation artifacts before launch

1. Provider coverage and request-cost report on several real NBA slates.
2. Player and event identity reconciliation report with zero ambiguous writes.
3. Chronological independent-model tournament per market.
4. Correlated-combination and distribution calibration report.
5. Target-excluded market-reader replay using stored timestamps.
6. Release-pure grade replay with promotion/demotion and board-count impact.
7. Official settlement, DNP/void, overtime and stat-correction tests.
8. Private tracking report split by market, side, grade, release and price band.
9. Desktop/mobile board and reader visual QA using the real OddSphere components.
10. Request budget, writer lease, rollover, lock, snapshot-size and failure-
    continuity tests before any route or schedule is enabled.

## Implemented non-live foundation (2026-10-20)

- Provider-normalized current and opening observations for BALLDONTLIE and The
  Odds API, including explicit canonical game and player identity seams.
- One-main-line selection that retains alternate ladders as internal evidence.
- Target-book-excluded, same-line no-vig evidence plus same-book opening, prior,
  and current line/price movement. This layer records evidence only; it cannot
  alter a forecast until chronological arbitration qualifies.
- Leakage-safe player features with delayed result availability, participation,
  minutes, per-minute box outcomes, usage, touches, passes, rebound chances,
  efficiency, and team shares.
- A research-only independent candidate that fits participation, conditional
  minutes, market-specific rate regressions, and empirical joint residuals for
  coherent Points/Rebounds/Assists/Threes combination markets.
- A strict chronological replay report separating projection error,
  independent direction/calibration, and market-only diagnostics. It refuses
  to manufacture a final married forecast before an arbitration rule is fit.
- Bounded provider cost/cadence planning and a read-only live coverage probe.

Nothing in this foundation enables a route, navigation item, member fetch,
writer, cron, grade, stake, public result, or production prediction.

## Research basis

- Hierarchical/regularized player and team models are the appropriate base for
  sparse and changing basketball roles; one player's recent average should not
  be treated as a complete forecast.
- Count outcomes are overdispersed, so Poisson, negative-binomial and hurdle or
  zero-inflated candidates must be compared by market.
- Minutes, pace, usage and correlated player/team outputs belong in the same
  causal forecast, while market data remains downstream evidence rather than a
  label leaked into training.
- Posterior predictive distributions—not point estimates alone—are required for
  exact Over/Under probabilities, alternate lines, combined props and grades.

Primary references:

- [Terner and Franks, *Modeling Player and Team Performance in Basketball*](https://www.annualreviews.org/content/journals/10.1146/annurev-statistics-040720-015536)
- [Williams et al., *Expected Points Above Average: A Novel NBA Player Metric Based on Bayesian Hierarchical Modeling*](https://doi.org/10.1214/25-AOAS2079)
- [Attard, Suda and Sammut, *Bayesian Hierarchical Modelling of Basketball Team Performance*](https://www.scitepress.org/Link.aspx?doi=10.5220%2F0012159100003587)
- [A multivariate copula-based Bayesian network for basketball player performance](https://link.springer.com/article/10.1007/s10479-022-04871-5)
- [Player absence and betting lines in the NBA](https://doi.org/10.1016/j.frl.2015.02.004)
- [BALLDONTLIE NBA API contract](https://docs.balldontlie.io/)
- [The Odds API v4 and historical event-odds contract](https://the-odds-api.com/liveapi/guides/v4/)
- [The Odds API NBA player-prop market catalog](https://the-odds-api.com/sports-odds-data/betting-markets.html)
