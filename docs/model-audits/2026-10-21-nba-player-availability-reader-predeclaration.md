# NBA verified player availability and professional-reader predeclaration

Date: 2026-10-21

Status: accepted only as part of the combined r14/r16/r8 candidate after the strict same-input audit.

## Problem

The production NBA path resolves ESPN availability against the exact scheduled game and currently
has complete two-team coverage on the October 21 board. The member adapter discards the player rows,
however, and exposes no availability evidence in the shared Daily Edge reader. Separately, the
legacy v1 scaffolding treats every reported `Out` player identically and places a fixed 60-point
confidence ceiling on the professional model. That ceiling has no player identity, expected minutes,
role, replacement, lineup-continuity, report-timing, or market-repricing evidence. It can therefore
demote a professional exact-price decision for the mere presence of any `Out` row.

This is neither a player-impact model nor the nuanced injury/market marriage required by the NBA
professional-model contract.

## Affected production scope

- Sport: NBA only.
- Markets: Moneyline, Spread, and Total grades for future unlocked rows only.
- Independent model: current professional point-in-time score artifact; unchanged equations and
  coefficients.
- Market marriage: current target-book-excluded professional reader and qualified Spread/Total
  corrections; unchanged.
- Candidate grade policy: `nba_grade_policy_2026_10_21_r8_rating_identity_no_count_cap`.
- Candidate prediction-record release: one new release identifier is required because grades can
  change, even though scores, probabilities, and sides are intended to remain identical.
- Writer: the existing NBA prediction-record writer only.
- Lease: the existing `prediction_pipeline:nba` lease only.
- Reader: the shared Daily Edge reader gains structured NBA availability evidence.
- Cron/provider cadence: unchanged. The existing one-request-per-game ESPN summary cache remains the
  sole availability read.

## Candidate rule

1. Keep exact-game, two-team ESPN report matching fail closed. A missing team group, malformed player,
   failed request, or ambiguous matchup remains unavailable and can never mean a healthy roster.
2. Preserve each reported player's name, normalized status, provider player id, position, injury
   type, provider report timestamp, and expected-return date when the provider supplies them.
3. Surface those structured rows in the NBA reader. Do not convert counts into impact labels such as
   star, major, minor, or replacement quality without evidence.
4. The professional scorer remains the starting basketball opinion. The existing qualified,
   target-book-excluded market reader remains the only current path that may alter the coherent score.
5. Remove only the legacy `source=injury` confidence cap from the professional output. Preserve
   limited-book, missing-market, data-quality, exact-price, target-exclusion, freshness, and market
   qualification controls.
6. Do not add a fixed score adjustment, confidence cap, forced side, automatic fade, automatic
   promotion, or injury-count threshold.
7. Existing locked member cards retain exact stored precedence and are never reconstructed with the
   new availability fields or grade semantics.

This does not claim that injuries are irrelevant. Established absences may already be reflected in
lagged team state, and acute information may be reflected by the separately validated market reader.
A future direct player-impact input requires point-in-time expected minutes, replacement rotation,
role redistribution, report chronology, and chronological validation. This release must not invent
that missing model.

## Required evidence before publication

- Same-input current-board comparison with every score, probability, side, grade, promotion,
  demotion, and actionable-count change.
- Prove score, probability, side, exact price, qualified market correction, and stake parity.
- Demonstrate at least one verified populated report and one verified empty report, plus missing and
  malformed fail-closed cases.
- Prove unlocked cards render structured player rows and locked cards retain their exact payload.
- Focused NBA parser, candidate, market-grade, adapter, reader, writer, and lock tests.
- TypeScript and `npm run verify:model-change`.
- Latest-main integration safety, protected pull request, exact-head merge, and post-deploy live proof.

## Rejection and rollback

Reject the candidate before publication if it changes a score, probability, side, exact price,
market-reader qualification, stake, provider budget, or locked payload; if it causes an unexplained
actionable-board collapse; or if player evidence cannot be tied to both exact matchup teams.

After publication, roll future unlocked generation back to the preceding model/grade release if the
reader loses exact team/player identity, any lock changes, releases mix, the sole writer/lease
contract fails, or the live board impact differs from the reviewed comparison.

Final combined evidence is recorded in
`docs/model-audits/2026-10-21-nba-rating-availability-r14-result.md`.
