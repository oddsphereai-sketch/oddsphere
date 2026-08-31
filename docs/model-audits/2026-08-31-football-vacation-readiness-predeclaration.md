# Football Daily Edge vacation-readiness predeclaration

Date: 2026-08-31
Starting production base: `f7b39670a979601d185f263cff8f584707dd3870`

## Owner direction and product boundary

The owner authorized a complete production repair before vacation. The release must preserve the
existing Daily Edge vocabulary and interaction model: **Best Angle**, **Lean**, **Watchlist**, and
**No Play** only. It must not add a tier, badge, explanatory ad copy, quota, reader-side grade
override, or independent writer. The objective is more accurate and better-separated football
predictions, coherent market interpretation, reliable tracking, and unattended weekly rollover.

Backtests are evidence, not the sole acceptance gate. A candidate must also have a defensible
football/market mechanism, current-slate replay, symmetric opportunity for both sides and both
Total directions, exact-price economics, balanced promotion/demotion accounting, and fail-closed
provider behavior.

### Owner amendment: prediction accuracy and side reselection are upstream

The owner clarified that prediction accuracy is the primary objective and grades must flow from
it. Current market location, line/price movement, strict Circa evidence and lower-strength public
money-versus-bets evidence may change the score distribution and reselect the winner, Spread side,
or Total direction before the exact-price grade is computed. A prior No Play or Watchlist is not a
sticky side: a later coherent refresh may reverse it and the new side may become any existing grade
its exact economics support. No split, line, or price signal may rewrite only a reader label or
manufacture an action without a rebuilt PMF and coherent exact-price tuple. Missing splits mean no
split adjustment; they do not hold CFB, NFL, or a player-prop slate. Player props use their own
available projection, role/injury, multi-book price, and same-book movement evidence rather than a
fabricated split proxy.

## Frozen defect inventory

1. NFL T-60 tracking incorrectly requires one model and calibration release across Moneyline,
   Spread, and Total even though production intentionally uses three market-owned heads.
2. The NFL weekly writer throws on a provider game outside the 16-game Week 1 artifact, allowing
   one later-week game to abort the entire leased run.
3. CFB applies a 2022 independent-model grade calibrator to the current market-dominant PMF. The
   spread transform has only a narrow probability range and a recorded home-side skew; Total has
   no fitted calibration function; Moneyline contains a collinear residual feature.
4. NFL injuries are collected but are not a consistently versioned scoring input across the
   outcome and props paths. CFB has active-roster/QB context but no league-wide timestamped injury
   endpoint and must not infer health from absence.
5. Football readers recompute some market direction independently of the writer, the Spread
   capability is keyed through `firstInning`, held NFL rows discard a stored opening price, and
   internal release identifiers occupy an existing factors panel.
6. NFL props can publish extreme model/market divergence without an evidence-derived guard, use a
   non-monotonic grade ladder for some markets, and can miss closing price because settlement runs
   before the final pregame quote is attached.

## Frozen implementation contracts

### Owner amendment: projections remain available through QB uncertainty

The owner subsequently rejected any whole-game Hold caused only by an expected quarterback being
Out/Doubtful, an unconfirmed replacement, or an unavailable injury report. This amendment
supersedes the blocking-QB sentences below. Football now follows the existing starting-pitcher
operating pattern: use the next healthy quarterback in the timestamped depth chart when the
expected starter is Out/Doubtful; mark that replacement projected until confirmed; rerun from the
replacement's historical state when provider depth changes; and retain a projection with explicit
uncertainty when no replacement or injury report is available. Exact-price or market-integrity
failures may still make the Bet grade No Play, but they cannot erase the game projection. No player
status can manufacture a promotion.

### NFL tracking and weekly runtime

- Define one explicit versioned composite release bundle mapping each market to its approved model
  and calibration release. A normal three-head bundle is coherent; a swapped, duplicated, unknown,
  or mixed-version market head is not.
- Preserve market-scoped T-60 locks, exact evaluated quotes, one `prediction_pipeline:nfl` lease,
  idempotent tracking keys, and the official Sep. 9 tracking boundary.
- Replace the Week-1-only lookup failure with a versioned generalized weekly outcome path. A single
  malformed game is held at game scope and cannot abort healthy siblings. No fabricated projection
  may be published.

### Availability and injuries

- NFL uses the existing bounded BALLDONTLIE weekly injury report and roster/depth collection inside
  the sole writer. Fresh `Out`/`Inactive`/IR statuses for the expected QB are blocking; other
  verified player impacts are position- and depth-weighted and capped before recomputing the joint
  distribution. Questionable/doubtful statuses use smaller uncertainty-weighted effects.
- CFB accepts only timestamped, source-attributed official availability. Conference reports may be
  used only for the games/status windows they cover. No report means unknown, never healthy.
  Expected-QB removal is blocking. Other verified starters use bounded positional effects (QB,
  RB/WR/TE, OL, DL/LB, DB) and update expected margin/Total before rebuilding the one authoritative
  PMF. The existing market/sharp/public inputs remain intact and can reflect information for games
  without a direct report.
- Stale, post-evaluation, ambiguous-team, or unverified availability cannot move a projection.

### CFB calibration

- Measure the production baseline by market, side/direction, grade, probability span, EV, edge,
  hold reason, and current exact tuple before selecting the replacement.
- Refit each market only if its baseline proves the stale transform materially compresses or biases
  the current PMF. Preserve current grade thresholds initially; do not manufacture plays with an
  arbitrary slope or target board count.
- Report promotions, demotions, side changes, home/away and Over/Under symmetry, actionable count,
  and CLV where same-book closing evidence exists. Absence of settled/closing evidence is reported,
  not imputed.

### Market interpretation and presentation

- Existing panels consume canonical writer-owned movement/split evidence. The reader must not run a
  competing directional algorithm.
- Recognize football Spread's `firstInning` storage key, preserve stored NFL opening prices, remove
  internal release identifiers from member-facing factor chips, and fix the non-soccer empty-state
  prefix. No new labels or copy are authorized.

### NFL props

- Derive any divergence guard from the current read-only distribution; do not assume an 8pp cutoff.
- Grade thresholds must be monotonic by construction. Verified player availability can demote or
  hold immediately; it cannot manufacture a promotion.
- Capture the latest same-book pregame price before settlement and retain it for CLV.

## Publication and rollback

All behavior-bearing releases and the production registry change together. Required validation is
focused unit/replay coverage, `npm run verify:model-change`, TypeScript, focused lint, production
build, current-main ancestry, overlap safety, protected PR checks, exact-tree merge proof, deployment
success, and natural-cycle read-only verification. Rollback is redeployment of the preceding
protected main commit plus verification that the prior complete release tuple is live.
