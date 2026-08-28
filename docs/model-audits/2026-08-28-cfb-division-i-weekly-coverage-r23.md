# CFB Division I weekly coverage r23

Date: 2026-08-28

Status: validated release candidate

## Root cause and correction

The board window already covered Thursday through Monday, but
`eligibleCfbWeeklyGames` excluded every game with two FCS teams. That is why all seven Friday,
August 28 games were absent while Saturday's eight FBS/FBS-or-FCS/FBS games were present.

The release now discovers every NCAAF event in the weekly window, then admits the game only when
both provider team identities resolve unambiguously to the existing qualified 256-team artifact.
It never neutral-imputes an unknown matchup into the public betting board and never backfills a
prediction after kickoff. Previously captured games retain their immutable lifecycle.

## August 28 coverage

Six of Friday's seven matchups have two qualified profiles and are eligible for the next natural
writer cycle:

- Colgate at Fordham
- William & Mary at Villanova
- New Hampshire at UAlbany
- Rhode Island at Merrimack
- Weber State at Northern Colorado
- Idaho at Cal Poly

Marist at New Haven is excluded because the qualified artifact cannot resolve both teams. The
Thursday games are not retroactively predicted after completion; the expanded rule covers future
Thursday/FCS-only games when discovered pregame.

## Board and model impact

- Existing Saturday baseline: 8 games / 24 markets / 23 exact decisions.
- Existing grade counts remain 2 Best Angle, 3 Lean, 8 Watchlist, 10 No Play.
- Existing changes: 0 tuples, 0 promotions, 0 demotions; 8/8 coherence passes.
- New Friday games are board additions, not grade promotions. Their forecasts, prices, splits,
  movement, and grades must come from the existing natural provider/writer cycle.
- The independent score coefficients, residuals, probability releases, r18 primary outcome,
  r11 exact-price policy, T-60 rules, tracking, and settlement are unchanged.

## Validation

- Pure-FCS qualified identity accepted; unknown identity rejected
- post-kickoff first discovery rejected; prior immutable row retained
- generalized weekly engine, CFB decision, member production, Sharp odds/splits, r18 PMF,
  and shared cross-market coherence tests pass
- TypeScript `--noEmit`
- `npm run verify:model-change`
- Next.js 16.2.6 webpack production build, 105/105 static pages
- `git diff --check`

Natural-cycle 14-game upcoming board coverage and signed-in live rendering remain the required
post-deploy checks.
