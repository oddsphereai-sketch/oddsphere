# CFB evaluated-book opening trail repair

Date: 2026-10-06

## Scope and pre-declaration

The Tuesday-through-Monday board repair correctly published Southern Miss at Troy, Jacksonville
State at Kennesaw State, and New Mexico State at Florida International. Read-only production
inspection then found that exact-price quote shopping could select a named sportsbook other than
the single representative provider-opening book. The immutable evidence already retained each
selected book's opening inside the compact forward context capture, but the member history reader
projected only `providerOpening`, `operationalOpening`, and current books. The affected selected
book therefore rendered a current-only price map even though its verified same-book opening was
stored.

This repair is limited to reconstructing the member-facing same-book trail from existing immutable
evidence. It must not change a forecast, PMF, probability, score, side, exact graded quote, grade,
actionability, lock, stake, tracking tuple, provider request, schedule, lease, label, or copy. No
cross-book point may be relabeled as movement. A game with no earlier same-book observation must
remain current-only.

## Implementation

- The bounded market-history query projects three compact JSON arrays only:
  Moneyline, Spread, and Total context-capture families. It still does not load the full historical
  payload.
- The member fixture locates the evaluated sportsbook family, restores its own opening landmark,
  and appends the immutable evaluated quote as the current or locked terminal point.
- Existing same-book observations remain authoritative and duplicate tuples remain compacted.
- Fixture / snapshot / reader advance to r72 / r32 / r17. The evidence, collector, writer, model,
  calibration, market-reader, decision, grade, lock, and tracking releases do not change.

## Production candidate result

Read-only candidate built from the live r98 evidence wave:

- Games / markets: 89 / 267 before and after.
- Grades before and after: 12 Best Angle / 76 Lean / 66 Watchlist / 113 No Play.
- Changed decision identities: 0.
- Complete multi-point opening-and-terminal trails: 165 → 168.
- Recovered exact same-book trails:
  - Jacksonville State at Kennesaw State Spread: Caesars +3.5 -112 → +3 -112.
  - New Mexico State at Florida International Spread: BetMGM -3.5 -105 → -6.5 -108.
  - New Mexico State at Florida International Total: Fanatics 48 -110 → 46.5 -110.
- Southern Miss at Troy remains current-only. Fresh Circa, Pinnacle, and other SharpAPI context is
  stored, but this first capture has no earlier same-book observation. The repair does not invent
  one.
- Promotions / demotions: 0 / 0. Board actionability is unchanged and the board does not flatten.

## Verification and rollback

Required verification includes `scripts/test-cfb-v1-production.ts`, TypeScript, the complete model
change verifier, production build, clean integration-safety verification against the latest remote
`main`, protected pull-request checks, and post-merge live inspection of the r32 compact snapshot.

Rollback fixture/snapshot/reader to r71/r31/r16. Stored evidence and tracking rows are immutable
and require no rollback.
