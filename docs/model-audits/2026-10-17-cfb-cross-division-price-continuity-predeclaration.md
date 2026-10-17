# CFB cross-division price continuity predeclaration

Date: 2026-10-17

## Owner direction and observed defect

Daniel Mengel directed OddSphere to close the remaining CFB evidence gaps and
repair every safely repairable Daily Edge data defect. The current 95-game
board contains two FBS-hosted games against FCS opponents—Charleston Southern
at Clemson and The Citadel at Texas A&M—whose Moneyline evaluations remain
held because no complete two-sided current quote reached the writer. Spread
and Total forecasts remain present. This is a price-availability defect, not
permission to synthesize an extreme favorite Moneyline.

The existing paid fallback queries The Odds API's dedicated 2026-27 FCS sport
catalog, but both the writer and provider adapter discard every cross-division
game before exact-event matching. The provider's current documentation assigns
FCS games to `americanfootball_ncaaf_fcs`; excluding a game merely because its
opponent is FBS prevents the existing strict matcher from checking the catalog.

## Frozen scope before editing

- Sport and markets: CFB Moneyline, Spread, and Total price evidence for games
  with at least one FCS participant; no player props.
- Independent model, joint PMF, probability, representative score,
  calibration, grade thresholds, stakes, and market-reader coefficients remain
  unchanged.
- Current forecast family remains the October 15 full-product coordinator
  compatibility family: runtime r26, model r25, distribution r23, probability
  r27, reachable score r23, calibration r26, grade policy r28, decision r52,
  production reader r40, evidence r47, member r64, fixture r92, compact snapshot
  r52, reader r37, tracking r49, and sole writer r125.
- The only authoritative writer remains `runCfbForwardEvidenceWriter` under
  `prediction_pipeline:cfb`; no route, timer, or lease is added.
- Provider order remains BALLDONTLIE, SharpAPI, CollegeFootballData where
  eligible, then The Odds API. The lower tier can fill an absent named book but
  cannot replace the same book from a higher tier.

## Candidate contract

1. The paid FCS catalog may be queried and exact-matched for an upcoming game
   only when at least one participant is FCS and the higher-priority hierarchy
   still lacks a complete market.
2. Exact away/home orientation, canonical team identity, kickoff proximity,
   unique provider event, complete two-sided market pairs, supported named-book
   identity, provider timestamp, and pregame chronology remain mandatory.
3. A missing FCS-catalog event or missing two-sided Moneyline remains an
   explicit held market. No probability, price, or bookmaker is fabricated.
4. Request cadence, one sport-level request, weekly ceilings, credit reserve,
   hourly/T-60 behavior, and response-size/timeout bounds remain unchanged.
5. Stored locked payloads retain exact precedence and are never migrated,
   regraded, or rewritten. Only unlocked and future captures may use the
   expanded eligibility.

## Required evidence before publication

- Focused tests must prove cross-division eligibility, strict matching,
  higher-priority same-book precedence, FBS-vs-FBS exclusion, and locked-reader
  immutability.
- A credential-backed zero-write board replay must report before/after paired
  price coverage, held markets, every side/price/grade change, promotions,
  demotions, net actionable count, and provider request/credit use.
- `npm run verify:model-change`, CFB production tests, TypeScript, latest-main
  integration safety, and protected PR checks must pass.
- If production credentials are unavailable for the paired replay, the change
  remains code-complete but shadow-only and cannot alter the live release.

## Exact-game audit result and decision

The candidate was rejected before any provider or model code changed. Exact
ESPN game summaries identify Charleston Southern at Clemson as event
`401858261` and The Citadel at Texas A&M as event `401856725`. DraftKings
publishes Spread and Total for both games but explicitly returns `OFF` for both
sides of each Moneyline. Those rows are therefore not dropped quotes: the
named sportsbook is not offering that market. Creating a substitute extreme
favorite price would violate the complete two-sided quote and named-book
continuity contracts.

The same exact-game summaries contain no injury report, and the configured ACC
and SEC official availability feeds contain no exact matchup report for either
game. Their availability must remain visibly unverified; missing evidence can
never be converted into a clear report.

Consequently there is no CFB runtime, model, provider, writer, release, board,
or locked-record change from this audit. The existing Spread and Total remain
available, the unavailable Moneylines remain held, and the member explanation
is corrected to say that the configured official sources have not published a
verified matchup report. A future price-continuity candidate requires a real,
complete two-sided quote from an eligible named book and the paired zero-write
replay described above.

## Rollback

Roll back future unlocked publication to the October 15/r125 family if the
expanded catalog scope cross-matches an event, replaces a higher-priority book,
exceeds the declared request budget, fabricates a missing Moneyline, contracts
the board, mixes release identifiers, or changes any stored lock.
