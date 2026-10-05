# NBA regular-season tracking boundary

## Scope

This release corrects public NBA tracking without changing the NBA model or member product.
The official 2026-27 NBA regular season begins October 20, 2026. NBA prediction records before
that date are preseason or prior-season postseason evidence and cannot count in the new season's
public record.

## Production finding

NBA was the only active major-league tracking writer without an official-start guard. The member
aggregate called the shared tracking-boundary helper, but that helper treated NBA as always
eligible. The legacy-compatible aggregate also read `prediction_results` without applying the
shared boundary. The NBA writer could consequently create and settle official-looking records for
any scheduled preseason slate.

The October 5 production inventory contained ten pre-boundary rows across five games: six rows
from June 8-13 and four rows from October 3-4. All ten were settled. These rows remain internal
evidence, but none is eligible for member recaps, category records, streaks, recent results, or
lifetime tracking.

## Repair

- `OFFICIAL_TRACKING_START.nba` is `2026-10-20` and NBA is a boundaried sport.
- The NBA prediction-record writer returns before pipeline or database work for any earlier slate.
- Both the modern and legacy-compatible member aggregates apply the same boundary.
- Both stored-snapshot keys and the server aggregate cache release are bumped, so a pre-repair
  snapshot cannot keep serving preseason counts after deployment.

The production-backed aggregate replay read all ten stored NBA rows and counted zero: 0 wins,
0 losses, 0 pushes, zero category buckets, and zero recent results.

## Market-reading audit

This tracking-only repair does not alter forecasts. The current sport-specific contracts were
rechecked rather than replaced with a cross-sport weight:

- NFL locked evidence carries the current target-excluded market-marriage release and complete
  target-excluded line families; its writer regression suite passes.
- CFB's updated settled replay continues to reject blanket movement/split following. Circa RLM is
  useful only in the released selective lanes; Circa Total RLM remains harmful. Its coherent
  market-informed outcome suite passes.
- NHL r14 production snapshots for all four October 5 games contain two or three market books,
  same-book movement, resolved Playbook fallback splits, and explicit independent/confirmed
  market decisions. Its split-fallback and discrete-flip regression suite passes.
- MLB's October 5 board has complete price, probability, line-movement, and market-read coverage
  for all six markets. Target-excluded source breadth and signed split-direction tests pass.
- WNBA target-excluded market decisions, including a qualified full side flip, pass their
  sport-specific regression suite. The league has no October 5 slate.
- EPL's coherent PMF, draw selector, target exclusion, and exact-price grading pass. UCL retains
  its documented downstream-only market vectors until a UCL-specific correction validates.
- NFL player-prop market evidence capture and MLB player-prop target-excluded evidence remain
  separate from game models and pass their focused contracts.

NBA is not described as current-season certified before launch. Its tracking is safely off until
October 20; any NBA forecast/market change requires a separately versioned, release-pure model
audit rather than being hidden inside this tracking correction.

## Product impact

No prediction, probability, projected score, pick, grade, stake, member copy, label, layout,
provider request, schedule, or lease changes. Existing locked evidence is not rewritten or
deleted. Rollback is the inverse boundary/cache-key change, but doing so would intentionally
restore preseason records to the public tracker and is not recommended.
