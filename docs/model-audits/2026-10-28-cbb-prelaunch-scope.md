# College basketball prelaunch scope — 2026-10-28

Owner request: build and research men's Division I college basketball for the November 1
opener, using the purchased BALLDONTLIE product and OddsSphere Daily Edge standards.
No production activation, member publication, scheduled collection, database writes, or merge
is authorized. Prepare a reviewable candidate and report actual validation and remaining gates.

Starting remote main: `b7aef3267bdd2bf492cf5f4f437119967fc78242`.
Isolated branch: `codex/cbb-prelaunch-20261028`.
Current CBB champion: none. Member availability, official tracking registry and confidence
publication remain disabled. Existing NBA/NFL/CFB/MLB/WNBA/NHL/soccer releases are unaffected.

Affected candidate markets: full-game Moneyline, Spread, Total, and probability/settlement
queries at alternate lines. One coherent score distribution supplies every market. Prices
and play grades are distinct from forecasting the winning side. Existing locks are never read
or rewritten by this development tooling.

Implementation boundary: sport-owned pure provider normalization, opponent-adjusted scoring
and tempo, chronology-safe historical evaluation, source-qualified market evidence contract,
local preview and activation readiness report. No route, cron, provider factory, database
writer, shared reader, sport flag, official tracking entry or production environment is changed.
Future publication must use one authoritative `prediction_pipeline:cbb` leased writer and the
current shared market-reader contract; no independent refresh/writer is introduced here.

Research basis:

- https://ncaab.balldontlie.io/ — schedule, game box scores, player/season stats,
  active roster, current and opening odds; seasons use the starting year.
- https://kenpom.com/blog/ratings-glossary/ — opponent-adjusted points per possession,
  tempo per 40 minutes, average opposing possession estimates; D-I versus D-I cohort.
- https://kenpom.com/blog/help-with-team-page/ — Four Factors, venue, schedule strength.
- https://kenpom.com/blog/preseason-ratings-now-with-transfers/ — roster turnover and
  transfers matter to preseason expectations; historical team priors alone are insufficient.
- https://arxiv.org/abs/1412.0248 — possession efficiency and bookmaker information have
  complementary predictive information; evaluate probabilities using proper scoring rules.
- https://www.villanova.edu/university/events/eternal-city-tip-off.html — November 1,
  2026 Notre Dame/Villanova neutral-site opener in Rome.

Predeclared validation: 2022 warmup, 2023 model development and uncertainty fitting,
2024 model selection, 2025 single chronological confirmation. Every forecast uses only earlier
completed games, with same-day results withheld together. Venue identity must be verified;
the nominal home listing is not evidence of home-court advantage. Box-score and outcome
archives support historical simulation, not a claim that every payload was captured pregame.
Unknown historical injuries, roster announcements and intraday odds/splits are never inferred
from the final result or current roster. Opening/current endpoints do not establish an
intermediate professional-book path or causal sharp action.

Report winner W-L, score/margin/Total MAE, Brier/log loss/calibration, interval coverage,
early-season results and exact-line W-L-P where actual timestamped prices exist. Do not invent
historical prices, units, comparisons with competitors, injury clearance, or prediction flips.
Candidate grades remain explicitly unapproved until chronological exact-price calibration.
