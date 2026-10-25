# NBA exchange-source exclusion

## Predeclaration

The October 25 full Daily Edge health audit found one critical rolling-board
defect outside the healthy current-day NBA slate. The October 26 Chicago at
Boston card treated a Polymarket binary spread contract as a sportsbook quote:
Boston +2.5 at -1649 opposite Chicago -2.5 at +464. The same event's Boston
Moneyline was -647, proving that the quoted +2.5 contract was not a coherent
conventional main spread. It was stored repeatedly in `lines`, `line_history`,
and the canonical observation lane, then selected by the unlocked member
pipeline.

For future unlocked NBA rows, prediction-market exchanges Kalshi, Polymarket,
and Robinhood remain available as raw audit observations but cannot own a
member price, market consensus, opening/current trail, market-reader signal,
grade, probability, or score correction. Existing globally blocked books
remain blocked. Conventional sportsbook data, provider fallbacks, cadence,
independent features, model equations, correction rules, and grade thresholds
are unchanged.

The required same-input audit must prove:

- the October 25 seven-game board has zero pick, score, probability, price,
  grade, actionable-promotion, or actionable-demotion changes;
- the unlocked October 26 Chicago-Boston card no longer displays or consumes
  the -1649 Polymarket spread or its exchange-only trails;
- the correction fails closed to unavailable market evidence until a valid
  sportsbook pair arrives; it cannot fabricate a replacement quote;
- stored locked snapshots retain byte-identical reader precedence;
- at least one focused test proves all three exchange names are rejected while
  normal sportsbooks remain eligible.

Runtime releases advance to NBA model r21, market marriage r22, internal reader
r7, and daily refresh r18. Grade policy and locked-snapshot schemas do not
change. Rollback applies only to future unlocked rows and cannot rewrite or
reinterpret any stored lock.

## Result

The exact October 25 seven-game candidate retained all 21 two-sided market
prices, 21 public-consensus sections, 21 complete sharp-book sections, and 20
of 21 three-stop two-sided trails. Its board stayed 3 Best Angle, 17 Watchlist,
and 1 Lean: zero pick, score, probability, price, grade, actionable-promotion,
or actionable-demotion changes.

The exact October 26 Chicago-Boston candidate removed Polymarket from every
member/model source list, removed the -1649/+464 spread and exchange-only
trails, and changed `BOS +2.5` to `BOS (line tbd)`. It retained the exact
independent projection of Boston 124.3047 to Chicago 107.2721 and retained all
three No Market grades, so promotions and demotions are zero. Public consensus
remains visible because it is a separate verified split source. The candidate
does not synthesize a sportsbook price.

Separate candidate deep audits for October 25 through October 31 found zero
critical odds issues on every date. October 25 had zero warnings. Later dates
reported only expected `missing_display_price` warnings on No Play/model-only
future cards whose conventional sportsbook markets were not yet stored. The
configured local environment does not contain `THE_ODDS_API_KEY`, so a direct
fallback-provider probe could not be performed here; production publication
must still prove the next sole-writer refresh, current release identifiers, and
member snapshot.

Focused source-eligibility, current-board, professional-reader, immutable
locked-snapshot, rolling-board, and refresh-cycle tests pass. The complete
`verify:model-change` suite passes, as do focused ESLint and TypeScript. The
local dependency directory omitted the already-declared `unpdf` package, so
TypeScript was run with a temporary ambient declaration for that unchanged
module and no declaration was retained. Integration safety, protected-PR, and
post-deploy verification remain publication gates.
