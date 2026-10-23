# NBA official injury fallback — predeclaration — 2026-10-23

## Owner direction

Repair missing injury evidence as a data-source problem, preserve nuanced model
and market-reader behavior, make no arbitrary player-point adjustment, and
verify the complete Daily Edge system before publication.

## Proven defect

The exact ESPN summary for Detroit-Miami (`401909847`) returned no injury
groups. The NBA's official 2:00 PM ET report for the same date and exact
matchup listed four Detroit players and two Miami players. Production therefore
marked both teams unknown even though an authoritative exact-game report was
available.

## Candidate

For future unlocked NBA rows only:

1. Retain the exact ESPN event summary as first authority.
2. When and only when ESPN is incomplete, fetch the NBA's official season
   report index and select the latest PDF for the exact Eastern game date.
3. Trust only HTTPS PDFs on `ak-static.cms.nba.com`.
4. Require the exact matchup and complete exact team sections. A missing team,
   malformed row, `NOT YET SUBMITTED`, wrong date, wrong matchup, oversized
   response, or extraction failure remains unknown.
5. Preserve player status and report reason. Do not apply a fixed score bump,
   fixed injury points, side flip, confidence cap, public-split rule, or market
   override.

Existing stored locks retain exact payload precedence. The sole prediction
writer, shared NBA lease, professional score artifact, market reader, price
selection, and grade equations are unchanged.

## Required evidence

- Pure exact-date/exact-match/parser tests, including wrong matchup and not-yet-
  submitted rejection.
- Successful parse of the current official Detroit-Miami PDF.
- Same-input current-board comparison against ESPN-only availability, reporting
  every pick, score, probability/confidence, selected price, grade, promotion,
  and demotion change.
- NBA focused tests, TypeScript, full model-change verification, latest-main
  integration proof, protected PR checks, and post-deploy live release and
  availability verification.

Rollback removes only the official fallback from future unlocked builds and
returns to ESPN-only unknown behavior. It must never rewrite a stored lock.
