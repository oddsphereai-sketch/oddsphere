# NBA player props professional foundation — predeclaration

Date: 2026-10-20
Production base: `aeb154bbbc60dc4080a389d12287828ce9d8951d`

## Scope and non-live boundary

- Build a sport-specific NBA player-props research pipeline toward the existing
  OddSphere player-props product. Do not enable a route, league pill, member
  board, cron, database writer, public tracking surface, grade, stake, or pick.
- Reuse the existing product shell and lifecycle patterns, not NFL/MLB model
  coefficients. NBA markets receive independent models and validation.
- Preserve every existing NBA Daily Edge, MLB/NFL player-props, locked record,
  writer, lease, schedule, label, and member-facing behavior.
- Initial modeled families are Points, Rebounds, Assists, Threes, PRA, PR, PA,
  and RA. Blocks, Steals, Stocks, Turnovers, Double-Double, Triple-Double, and
  period markets remain research-only until their own distributions qualify.

## Established architecture

The repository already contains leakage-safe NBA game/player box history,
advanced tracking, team/player point-in-time features, official outcomes,
injuries, current/opening game odds, and a sport-specific Daily Edge market
reader. It also contains mature MLB/NFL player-props lifecycle, immutable lock,
settlement, internal tracking, evidence, and reader patterns.

The missing product is the player-level NBA layer: canonical prop observations,
role/minutes distributions, market-specific outcomes, joint simulation for
combined props, exact-price market evidence, release-pure settlement, and an
NBA member transport. Those are new work, not aliases of Daily Edge or NFL.

## Provider contract

1. **BALLDONTLIE primary:** NBA schedule, active players, injuries, official box
   outcomes, advanced statistics, current props, and provider-native opening
   props. Current and opening prop calls are game-scoped and return the game's
   complete response without pagination.
2. **The Odds API secondary:** target-excluded reference books, coverage gaps,
   and bounded historical point-in-time replay. Current event odds cost one
   credit per returned market per region-equivalent book group. Historical
   event odds cost ten credits on the same basis; therefore historical pulls
   require a declared sample/budget and cannot run as a normal refresh.
3. **SharpAPI optional secondary:** use only after current account-specific NBA
   prop coverage and exact event/player identity are proven. No synthetic sharp
   evidence is allowed.
4. **Playbook context-only:** do not assume a player-prop price contract that is
   not documented or proven. Existing injury/context features may be used only
   through time-stamped, pregame-safe paths.
5. No member request may call a provider. One future leased writer will capture
   observations and publish one compressed snapshot after validation.

## Independent model candidates

1. Participation probability and a full expected-minutes distribution precede
   every stat projection. Current lineup/injury/active-roster evidence may alter
   player participation and redistribute minutes/usage; an old status cannot
   override newer authoritative evidence.
2. Per-minute event rates use hierarchical partial pooling by player, role,
   team, opponent, and season regime. Recent form is recency-weighted but may
   not replace the stabilized prior.
3. Points are decomposed into shot/three/free-throw opportunity and efficiency;
   Rebounds use rebound chances and expected misses; Assists use touches/passes,
   potential assists and teammate conversion; Threes use attempt volume and
   make probability. Low-count stocks require Poisson, negative-binomial,
   hurdle, and zero-inflated candidates.
4. PRA/PR/PA/RA and achievement markets are derived from one correlated joint
   simulation. Marginal probabilities may not be added or multiplied as if the
   component outcomes were independent.
5. Team pace, expected possessions, game total, spread/blowout risk, rest,
   travel, coaching/rotation regime, opponent scheme, and teammate availability
   may enter only when they can be reconstructed strictly before tip and are
   available to the live scorer.

## Market-reading marriage

- The independent distribution is the forecast starting point. Consensus is
  never a substitute for the model center.
- Select one canonical listed line per player/market for the member surface;
  alternate ladders remain internal evidence.
- De-vig complete same-book, same-line Over/Under pairs. Exclude the evaluated
  target sportsbook from fair-price/reference evidence.
- Preserve source-separated opening, prior, current, T-180, T-60, T-15, and lock
  observations. Treat line movement and price movement as different signals.
- A market state may confirm, resist, adjust, or flip the final side only after
  chronological market-specific evidence shows that rule improves direction,
  Brier/log loss, and calibration without materially worsening projection error.
  No fixed cosmetic nudge, generic cross-sport rule, or public-only flip is valid.
- Projection, side, probability, price, EV, and grade must come from one coherent
  final distribution.

## Chronological validation and acceptance gates

- Use rolling-origin seasons and dates. A target game's outcome, closing line,
  final injury news, or later game cannot enter its own feature vector.
- Report per-market MAE, RMSE, median absolute error, prediction-interval
  coverage, Over/Under hit rate, Brier score, log loss, calibration, CLV, ROI,
  player/game cluster counts, DNP/void rates, and provider coverage.
- Compare independent-only, market-only diagnostic, and final married model.
  A final candidate must improve the applicable frozen confirmation window and
  may not hide a weaker raw model behind market anchoring.
- Grade changes need exact executable prices, promotions paired with demotions,
  counts by market/side/grade, and proof the board was not flattened.
- DNP, late scratch, traded-player, postponed-game, overtime, and stat-correction
  policies must be explicit and tested before any internal result is trusted.
- No production release is eligible until the provider capture, player identity,
  point model, probability distribution, calibration, market arbitration,
  settlement, private tracking, request budget, compressed transport, and reader
  have each passed focused tests and `npm run verify:model-change` on latest main.

## Initial release status

- Schema/observation/model/calibration/decision releases are explicitly unfit
  and local-observe-only.
- Production writer, member route, navigation, schedules, grades, and public
  tracking are disabled by contract.
- Existing provider and site behavior is unchanged.

## Foundation implementation result

The first non-live implementation now includes provider normalization, explicit
cross-provider player identity, bounded opening-history retrieval, leakage-safe
player features, a research-only participation/minutes/component model, joint
residual combination probabilities, canonical main-line selection,
target-excluded market evidence, and chronological confirmation reporting.

The implementation remains intentionally unfit and non-actionable. It does not
yet contain a qualified injury/rotation redistribution model, opponent and
lineup matchup coefficients, a validated market arbitration rule, calibrated
grade policy, settlement writer, production snapshot, member transport, or
reader. Those remain acceptance requirements rather than silently substituted
defaults.
