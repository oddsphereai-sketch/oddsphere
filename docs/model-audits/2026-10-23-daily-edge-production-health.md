# Daily Edge production health audit — 2026-10-23

## Scope

Owner-directed read-only audit of current stats, injuries, odds, lines, split
feeds, market readers, projections, predictions, release coherence, and player
props across CFB, NFL, NBA, WNBA, NHL, MLB, EPL, and UCL. Corrections were
limited to defects supported by exact source evidence.

## Corrected defects

1. **CFB Duke-Virginia sharp splits.** SharpAPI held a current complete
   DraftKings record, but exact provider label `Virginia` was rejected because
   the generic resolver also considered Virginia Tech. Exact abbreviation alias
   `UVA -> Virginia` restores the row without weakening ambiguity rejection.
2. **CFB late official availability.** The ACC published its exact
   Duke-Virginia report after the writer's successful 16:50Z pass. The existing
   bounded official-source poll now runs hourly throughout the final twelve
   pregame hours instead of only the final three. Its twelve-request ceiling,
   sole writer, and six-hour default cadence remain unchanged.
3. **Cross-sport deep-audit false positive.** The audit compared a same-book
   Pinnacle movement trail with MLB's best executable quote at another book.
   It now validates the trail against the explicit movement-reference price and
   sportsbook. This changes audit classification only, not a model or member
   card.
4. **NFL props close metadata.** Two null closing prices with exact immutable
   T-60 observer quotes were backfilled through the existing recovery path.
   Forty historical nulls without exact evidence remain null; no locked
   decision tuple was changed or reconstructed.
5. **NBA official injury fallback.** ESPN's exact Detroit-Miami summary omitted
   injury groups while the official NBA report published complete sections for
   both teams. Production now retains ESPN first and falls back to the latest
   exact-date, exact-match official NBA PDF with two-team fail-closed parsing.

## CFB impact declaration

The zero-write current-board replay covered 96 games and 288 markets. The
restored Duke-Virginia row contained all three DraftKings split markets. The
intended current-card impact was:

- Moneyline: UVA remains Watchlist.
- Spread: Duke +2.5 remains No Play.
- Total: Over 46.5 Best Angle becomes Under 46.5 Best Angle.
- Actionable promotions: 0. Actionable demotions: 0.
- The current representative score moves from 25-28 to approximately 20-22,
  coherently preserving the UVA winner and Under direction.

The official ACC report contains 38 listed unavailable players and becomes
visible evidence. Conference reports remain display-only for general injuries;
they do not apply an automatic points penalty. Only an exact expected-QB match
can enter the pre-existing verified quarterback path, and this report produced
no such new match. The Total direction change is therefore the existing market
reader responding to the restored split, not a rigid injury adjustment.

## Current production health evidence

- **CFB:** source and publication were inside the hourly contract; 96/96 games
  had predictions, current odds, active-QB context, and openings; no member
  presentation errors. All 56 FBS-involved games had prices in all three
  markets. Two FCS-only moneylines (ETSU-VMI and Murray State-South Dakota
  State) were not published by any configured provider; their other markets
  and predictions remain available and no price was fabricated.
- **NFL:** 14 games / 42 markets; no critical or warning findings, all markets
  priced with movement trails, and current injury/market evidence inside its
  freshness contract.
- **NBA:** all 12 current games had complete multi-book Moneyline, spread, and
  Total sequences. The official fallback closes the one ESPN omission, moving
  verified two-team availability from 11/12 to 12/12. The same-input audit
  changed no pick, projection, selected price, actionable promotion, or
  actionable demotion.
- **NHL:** two-game slate, all three markets priced for both games, complete
  current roster/goalie provenance, 15-book market context, and the current
  r22 release.
- **MLB:** one-game slate with 84 line rows from 18 books, complete two-sided
  markets, coherent r92/v77/v38/v61 releases, and no evaluated-price outlier.
- **WNBA:** no current slate; exported runtime identifiers match the release
  registry and no stale game was presented as current.
- **EPL:** ten current fixtures / 30 markets on the current r20/v25 release;
  the current rebuild produced zero side, promotion, or demotion drift.
- **UCL:** 18 future fixtures, 72/72 selected prices, complete current/opening
  provider readiness, no holds, no non-positive-EV actionable rows, and no
  cross-market incoherence on r11/r14. The 18/18 YES BTTS concentration remains
  a prediction-distribution diagnostic, not a feed or process outage; no
  unvalidated forced flips were made.
- **NBA props:** 12 games, 168 candidate feature rows and 1,154 decisions with
  no zero-projection rows.
- **NFL props:** current production snapshot contained 2,190 rows / 886 member
  market scopes with no duplicate line scopes and 2,188/2,190 opening coverage.
  The exact-T60 close audit now has zero recoverable missing closes.

## Verification

- Focused identity, SharpAPI split, official-availability cadence, and deep
  audit regression tests pass.
- The full CFB production suite passes.
- TypeScript passes with no emit.
- `npm run verify:model-change` passes, including the NFL, NHL, CFB, MLB, WNBA,
  EPL, UCL, tracking, and player-prop production contracts.

Deployment still requires latest-main integration proof, protected PR checks,
and post-deploy confirmation of the exact Duke-Virginia split/report plus a
zero-critical production deep audit.
