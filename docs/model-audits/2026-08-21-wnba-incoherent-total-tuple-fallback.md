# WNBA incoherent-total tuple fallback — 2026-08-21

## Scope

Reader/data integrity only. This changes no WNBA model, distribution, calibration, grade policy,
side, probability, grade, stake, promotion, or demotion rule.

## Production reproduction

At `2026-08-21T20:53:43.001Z`, the GS@CHI current total board contained selected-side Over prices
at `162.5` while every available Under price was at `163.5`. The model decision remained
`Over 163.5`, so the v3 writer correctly refused to synthesize an exact current tuple. The prior
tracking record remained complete at `Over 163.5`, FanDuel `-112`, evaluated
`2026-08-21T20:34:18.970Z`, decision `2026-08-21T20:34:23.398Z`, Watchlist.

The `20:53:54.519Z` published reader snapshot nevertheless ignored that unlocked last-known-good
record. It exposed FanDuel `-126` from the incompatible `Over 162.5` row as if it priced
`Over 163.5`, omitted the decision tuple, and lost the opposing trail. This proves a genuine
writer/reader selection defect, not cache timing: `game_predictions.computed_at` was
`20:53:47.675Z`, the total tuple was absent there, and the current snapshot was generated after
that write.

## Repair contract

- The authoritative writer may retain a prior tuple only when market, side, line, exact model
  probability, outcome confidence, grade, decision chronology, and current release identifiers
  still match.
- The unlocked reader may reuse only a complete v3 tracking tuple whose record fields match that
  tuple and whose tuple remains compatible with the current decision.
- A changed line, probability, grade, release, malformed record, or future decision timestamp
  fails closed. No tuple is synthesized.
- The evaluated price trail stays on the tuple line. A newer incompatible quote is exposed only as
  separate current context; the opposing trail remains on the evaluated line.
- A locked record remains authoritative before current or fallback evidence, preserving T-60
  immutability.

## Candidate verification

The candidate adapter was run read-only against the same production database at
`2026-08-21T21:06:20.258Z`. It returned three games, nine v3 tuples, two-sided movement for all
nine markets, and the unchanged three-Lean/six-Watchlist board. GS@CHI Total retained the exact
FanDuel `-112` evaluated tuple at `163.5`, kept the newer FanDuel `-126` quote separate, and
restored 18 selected-side plus 18 opposing-side stops.

Focused regression: `scripts/test-wnba-incoherent-total-context.ts`.
