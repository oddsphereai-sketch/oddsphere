# CFB paid FCS odds budget continuity — result

Date: 2026-10-30

## Result

The candidate repairs the paid fallback gate without fabricating prices or
changing an existing forecast, side, probability, grade, or stake.

- The production baseline remains 56/100 games with current prices and 43
  upcoming FCS-only games missing Moneyline, Spread, and Total prices.
- The last stored paid-provider balance is 2,262 credits. The incumbent fixed
  gate rejects that balance because its threshold is 2,310.
- Candidate r6 performs the provider's quota-free `/v4/sports` balance check,
  accepts one bounded recovery request at a tested 900-credit balance, preserves
  a 250-credit shared-account floor, and reserves a conservative 12 credits for
  the next request. The paid `us,us2` request costs at most six credits when all
  three requested markets are returned.
- Current-attempt spend is stored separately from historical-opening spend and
  deduplicated by exact attempt timestamp before applying 60-credit ordinary and
  90-credit T-60 weekly ceilings.
- Unresolved gaps cool down for twelve hours outside 48 hours and four hours
  inside 48 hours. An immediate new-gap seed and a due T-60 request remain
  possible, subject to the same balance and weekly-spend gates.

The release identifiers are:

- paid adapter:
  `cfb_the_odds_api_fcs_fallback_2026_10_30_r6_adaptive_credit_continuity`
- sole writer:
  `cfb_forward_evidence_writer_2026_10_30_r145_adaptive_fcs_credit_continuity`

The one `prediction_pipeline:cfb` lease, append path, named-book hierarchy,
strict team/time identity, complete two-sided market validation, model,
calibration, grade policy, member reader, tracking contract, and immutable-lock
precedence are unchanged.

## Verification

- `npx tsx scripts/test-cfb-the-odds-api-fallback.ts`: passed.
- `npm run test:cfb-v1-production`: passed.
- `npx tsc --noEmit`: passed.
- changed-file ESLint: zero errors (two unrelated pre-existing unused-parameter
  warnings in `cfbForwardEvidence.ts`).
- `npm run verify:model-change`: passed. The optional Market Brain PostgreSQL
  proof was skipped because `MARKET_BRAIN_POSTGRES_URL` is unset, as permitted
  by the repository script.

The unit suite proves a 900-credit recovery boundary, the quota-free live
balance gate, shared floor, ordinary/T-60 weekly credit ceilings, duplicate-row
receipt deduplication, historical/current spend separation, near/far retry
cadence, strict identity, and fallback book no-replacement behavior.

## Board impact

On identical already-priced inputs, promotions, demotions, side changes, score
changes, and actionable-count changes are all zero. The candidate can affect
only a future-unlocked market that is currently unavailable and for which the
provider returns a real complete quote. Such a market must still pass the
unchanged incumbent probability, economics, and grade gates before it can
become actionable.

No provider credential exists in the local worktree, so this result does not
claim that the 43 live FCS-only games are already recovered. Production success
requires the merged writer to execute with the production credential and a
fresh audit to confirm actual provider-supported coverage, remaining credits,
and board coherence. A branch preview is not the live repair.

## Rollback

Restore paid-adapter r5 and sole-writer r144 together. Do not edit or replace
any stored locked payload. The prior fixed reserve will intentionally re-block
the current 2,262-credit balance.
