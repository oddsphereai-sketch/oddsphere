# NBA current execution-quote coherence r12

Date: 2026-10-21  
Status: accepted candidate for future unlocked rows; production proof still required

## Scope

- Sport and markets: NBA Moneyline, Spread, and Total.
- Starting production releases:
  - model / prediction record: `nba_professional_unified_2026_10_20_r11_heavy_tail_margin_calibration`;
  - market marriage: `nba_market_marriage_2026_10_21_r14_bounded_high_water_market_evidence`;
  - grade policy: `nba_grade_policy_2026_10_16_r5_market_specific_accuracy`.
- Candidate releases:
  - model / prediction record: `nba_professional_unified_2026_10_21_r12_current_execution_quote`;
  - market marriage: `nba_market_marriage_2026_10_21_r15_current_execution_target_exclusion`;
  - grade policy: `nba_grade_policy_2026_10_21_r6_current_execution_economics`.
- The sole writer remains `createNbaPredictionRecords` under the shared
  `prediction_pipeline:nba` lease. No provider call, timer, writer, stake,
  independent-score coefficient, residual distribution, categorical reader
  threshold, or lock rule changes.

## Production finding

The append-only `lines` table was correctly loaded past PostgREST's 1,000-row
ceiling, but the NBA DTO's execution-price selector still searched every loaded
historical row. A book that stopped updating could therefore win price shopping
with an old numerically favorable price. At the 2026-10-21 12:53Z audit:

- the board contained 11 games, 33 markets, 12,889 split observations, and more
  than 20,000 canonical price observations;
- professional reader flows were fresh and the reader changed the coherent
  score on CHA-BKN and UTAH-MEM;
- four of five actionables used quotes about 40 minutes old;
- CHA-BKN Moneyline Lean used SX Bet +112 captured on 2026-10-17, even though
  current 2026-10-21 quotes existed;
- several Watchlists also selected old historical Moneyline prices.

This was a current-price/grade-economics defect, not evidence that the independent
score or professional market reader had stopped running.

## Candidate behavior

Before consensus, target-book exclusion, exact-price grading, member display,
and tracking consume the `lines` rows, the candidate:

1. retains only the newest row for each sportsbook / market / side;
2. anchors each game-and-market board to its freshest retained quote;
3. rejects a sportsbook side whose newest quote is more than 120 minutes older
   than that game anchor.

The freshness window is relative to the game's market-specific collected board so a coherently
collected far-future rolling-board game remains usable, while a four-day-old
abandoned book cannot outrank actively refreshing books on today's game.

The same filtered board owns feature-snapshot market context and the final DTO.
The evaluated sportsbook excluded from professional-reader evidence is therefore
the same current sportsbook whose exact price owns grade economics and display.

The production pipeline also no longer computes or persists the rejected
independent-score shadow. The reproducible offline challenger and its failed
gate remain in source/audit history, but future production snapshots contain
only the authoritative model, consistent with the standing no-production-shadow
rule. This removal changes no public output.

## Same-input current-board result

The zero-write production-data rehearsal at 2026-10-21 12:58Z returned:

- games / markets: 11 / 33 before and after;
- grades: 3 Best Angles, 2 Leans, 28 Watchlists before and after;
- promotions: 0;
- demotions: 0;
- prediction-side changes: 0;
- projected-score changes: 0;
- professional-reader correction changes: 0;
- stale selected prices over 180 minutes: 10 before, 0 after;
- stale actionable prices: 1 before, 0 after.

CHA-BKN Moneyline remains BKN / Lean with the same 55.6857% probability and the
same validated Spread-driven score correction. Its selected price changes only
from stale SX Bet +112 (October 17) to current Hard Rock +110 (45 minutes old).
All other actionables retain their side, grade, probability, and current quote.

## Settled opening-night context

The exact current r11 release produced nine locked rows over the three games on
2026-10-20:

- all markets: 6-3;
- Moneyline: 1-2;
- Spread: 2-1;
- Total: 3-0;
- Best Angle: 1-0;
- Leans: 1-3.

The final score MAE on that three-game sample was approximately 7.04 points per
team, 9.65 on margin, and 12.07 on Total. One qualified Spread correction helped
the OKC-SA winner/Spread and one hurt BOS-DET; PHI-NY received no reader score
correction. This is descriptive prospective evidence, not enough observations
to tune reader thresholds or independent-model coefficients. The two-season r11
confirmation remains the applicable broad validation baseline.

## Verification and rollback

Required before publication:

- current-line, candidate, reader, projection, grade, member/writer, lock, and
  immutable-snapshot focused tests;
- TypeScript and `npm run verify:model-change`;
- latest-main integration safety and protected pull-request checks;
- post-deploy proof of r12/r15/r6, 11 games / 33 markets, zero stale selected
  prices on today's board, one leased writer, successful refreshes, and exact
  preservation of every existing locked r11 payload.

Rollback future unlocked generation to r11/r14/r5 if price coverage contracts,
the actionable board changes outside the reviewed tuple, a current quote is
replaced by an older quote, releases mix, the reader and evaluated sportsbook
disagree, the writer/lease overlaps, or any locked record changes.
