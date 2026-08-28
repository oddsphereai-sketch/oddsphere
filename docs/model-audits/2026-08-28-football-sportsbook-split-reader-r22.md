# Football sportsbook split reader r22

Date: 2026-08-28

Status: validated release candidate

## Result

NFL's existing leased writer now requests named-book split rows in fixed Circa, DraftKings,
BetMGM order and accepts only a complete, unambiguous exact league/team/date match covering all
three markets. CFB reuses its already stored exact-match Circa/DraftKings rows. The member reader
retains the established Public Consensus and Sharp Book Splits cards: Circa has first priority,
and the complete named-book fill-in occupies the Sharp Book Splits card until Circa replaces it.
The fill-in remains outside prediction and exact-price grade inputs.

The NFL Moneyline prediction subtitle no longer says “no sportsbook line” when the exact-price
panel visibly contains a quote. It now states that the exact-price grade is separate.

No provider client, cron, writer, lease, table, timer, or reader section was added.

## Current-board invariants

- NFL: 16 games / 48 markets; 3 Best Angle, 11 Lean, 7 Watchlist, 27 No Play.
- NFL replay changes: 0 sides, 0 probabilities, 0 fair probabilities, 0 EVs, 0 quotes,
  0 promotions, 0 demotions; 16/16 primary forecasts coherent.
- CFB baseline: 8 games / 24 markets; 23 exact decisions; 2 Best Angle, 3 Lean,
  8 Watchlist, 10 evaluated No Play, and one unavailable SJSU-USC Moneyline tuple.
- CFB replay changes: 0 tuples, 0 promotions, 0 demotions; 8/8 games coherent.
- SJSU-USC Spread and Total remain recovered named-book decisions. Moneyline remains prediction-
  live and member-facing No Play because the stored wave has no complete named target-book pair;
  a sibling-market absence cannot suppress Spread or Total.

## Validation

- NFL/CFB split matchers, member fixtures, writers, compact snapshots, decision and PMF tests
- shared football cross-market coherence
- Daily Edge experience: 180 passed, 0 failed
- TypeScript `--noEmit`
- `npm run verify:model-change`
- Next.js 16.2.6 webpack production build, 105/105 static pages
- `git diff --check`

Natural-cycle split coverage and signed-in live rendering remain the required post-deploy checks.
