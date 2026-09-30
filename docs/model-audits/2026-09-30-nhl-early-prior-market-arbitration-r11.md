# NHL early-prior market arbitration r11 — 2026-09-30

## Release decision

Release `nhl_regular_2026_r11_early_prior_market_arbitration`, calibration
`nhl_regular_calibration_2026_r11_early_prior_market_arbitration`, and decision
`nhl_regular_decision_2026_r11_early_prior_market_arbitration` for future
unlocked regular-season rows. The independent score model remains unchanged.
The ordinary Moneyline marriage remains the validated 20% market sanity input.

R11 adds one symmetric, prior-regime-only arbitration path. It raises the
Moneyline market weight to 60% only when all of the following are true:

- the game is regular season and the provider feature season is older than the
  slate feature season;
- current-season opponent-adjusted state is not yet available;
- the independent winner conflicts with a no-vig market at least four points
  from 50%;
- at least two complete books support the market estimate;
- a continuous same-book probability move of at least one point confirms that
  market direction; and
- a complete medium/high-confidence money-and-ticket observation also confirms
  that direction.

Missing or conflicting evidence leaves the existing 20% path unchanged. A
split alone, movement alone, or public popularity alone cannot trigger a flip.
The rule automatically expires when current-season opponent-adjusted evidence
is available. Total behavior is unchanged. No member copy, labels, layout,
stake, provider call, schedule, writer, lease, or lock rule changes.

## Chronological evidence

The predeclared audit regenerated the complete BALLDONTLIE 2023-25 regular
history and opening-price archive, restored official settled scores, and used
only pregame rolling inputs. A supportive fixed-model diagnostic found that in
first-30-day independent/market conflicts the market side won 57.89% in 2023
(57 games), 62.07% in 2024 (29), and 67.39% in 2025 (46). This diagnostic was
not used alone to select production behavior.

The release selector used the professional score architecture and its 2025
chronological market cohort. Among the 17 first-30-day conflicts where the
market was at least 54%, the incumbent 20% marriage was 52.94% with Brier
0.248903. The 60% candidate was 58.82% with Brier 0.248214. Relative to the
incumbent, it changed 11 sides and produced six corrections versus five
regressions. A blanket rule was rejected: the broader 41-game conflict cohort
did not establish an accurate unconditional market flip. Historical split and
continuous-movement provenance was not complete enough to claim a pristine
confirmation of the full live conjunction, so the result is provisional and
strictly narrower than the tested 54% price condition.

## September 30 paired current-board impact

The read-only production-input replay retained all three games and all nine
official markets with zero errors.

- PIT at PHI: no side, score, or grade change.
- NYI at TOR: the prior-only independent margin was NYI by 0.44 goals while the
  current market was TOR 54.85%, the same-book home probability had moved
  +2.38 points, and the complete Playbook observation was 75% tickets / 76%
  money on TOR. R11 changes the coherent score from NYI 3.28–TOR 3.05 to NYI
  3.14–TOR 3.19 and the Moneyline winner from NYI to TOR. TOR Moneyline is a
  Watchlist at -137 rather than a price-insensitive promotion; NYI +1.5 also
  becomes Watchlist at -256. The Total remains Over 6 Lean.
- LAK at COL: the independent model and market already agree on COL, so the
  score and all three decisions are unchanged. The sharp puck-line split alone
  cannot manufacture a COL -1.5 flip without confirming price movement.

Board impact is five to three actionables: zero promotions, two demotions, one
Moneyline side change, zero Total or puck-line side changes, and no missing
game or market. Both demotions are the same invalidated prior-conflict game.
The existing symmetric exact-price promotion paths remain active and tested;
no suppressive threshold or quota was added. The owner explicitly prioritized
prediction integrity and avoiding a bogus featured pick over preserving those
two contradicted grades. The impact is disclosed rather than hidden.

## Safety and rollback

The score pair is rebuilt from the final Total and final arbitrated margin, so
Moneyline, Total, puck line, and decimal score remain mathematically coherent.
Only unlocked r11 tuples may replace unlocked transition tuples. Existing
locked r7-r10 tuples remain immutable and tracking-eligible. The sole NHL
writer, sport-scoped `prediction_pipeline` lease, r10 T-60 refresh/lock owner,
and nightly slate lifecycle remain unchanged.

Rollback all three r11 identifiers and the conditional arbitration helper if
live evidence loses a game/market, creates mixed releases, changes a Total,
fails score/side coherence, or unexpectedly activates outside the prior-only
opening regime. Never rewrite a valid locked tuple.
