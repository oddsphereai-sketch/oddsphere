# MLB complete line pagination r86 — result

Date: 2026-09-05

## Decision

Publish. The candidate corrects a proven input-completeness defect without
changing model formulas, thresholds, sides, stakes, locks, or FI behavior.

## Same-slate evidence

The read-only September 5 replay loaded all 15 MLB games and retained complete
two-sided Moneyline and Total prices for 15/15. In particular:

- STL@COL: Moneyline +111/-120; Total 10.5 at -121/+105.
- WSH@LAD: Moneyline -212/+193; Total 7.5 at +113/-130.
- ATH@SEA: Moneyline -233/+210; Total 7.5 at -108/-104.

Those games were the tail rows omitted by the former one-response query. The
corrected dry writer produced ordinary evaluated tuples rather than operational
missing-price holds: STL two Provisional/Watchlist-class rows; WSH Moneyline No
Play and Total Lean; ATH two Provisional/Watchlist-class rows. The full 30-market
dry board was 2 Best Angles, 5 Leans, 12 Market Aligned, 4 Provisional, and 7 No
Plays.

Relative to the corrupted public state, which held all six final-three
full-game markets as No Play, r86 has one actionable promotion (WSH@LAD Under
7.5 Lean), zero actionable demotions, and four restored evaluated
Watchlist-class rows. The WSH Moneyline remains a genuine model No Play. No
market is promoted merely because its price became available.

## Safety result

- Deterministic 1,329-row regression: pass; three exact pages and 15 games.
- Saturated-cap fail-closed regression: pass.
- TypeScript: pass.
- Scoped ESLint: pass.
- Mandatory `npm run verify:model-change`: pass.
- Next.js 16 production webpack build: pass; 108 routes generated.
- Production query: read-only, 0 writes.
- First-inning scoped release, probability head, calibration, and tuple
  contract: unchanged.
- Stake behavior: unchanged.

The remaining mandatory repository suite, production build, latest-main
integration proof, protected PR checks, and post-deploy live writer acceptance
are publication gates rather than assumptions.
