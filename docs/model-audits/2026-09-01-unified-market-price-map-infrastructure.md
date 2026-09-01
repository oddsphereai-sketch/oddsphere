# Unified market price-map infrastructure

Date: 2026-09-01

## Scope

This release extends the existing Market Intelligence v2 evidence snapshot with an exact-selection, exact-line comparison between market-making prices and retail prices. It is internal infrastructure for sport-owned projection models; it does not add a second member-facing market panel.

The existing Daily Edge reader and Market Pulse remain the single presentation surface. When the sharp-split block is absent, Market Pulse uses its already-resolved market-read state to show one compact Against / Mixed / With direction meter instead of an empty split placeholder. Source hierarchy, source weights, probability gaps, book counts, and implementation details remain backend-only.

## Evidence rules

- Moneyline comparisons require the same event, market, and selected side.
- Spread and total comparisons additionally require the exact selected line.
- Every book probability must be derived from a complete two-way price pair.
- Pinnacle, Circa, and Bookmaker remain the market-making group.
- Major retail books carry full consensus weight; supplemental retail books carry reduced weight.
- Stale, post-start, post-lock, different-line, and incomplete-pair evidence remains excluded by the existing resolver gates.
- Public ticket and money splits remain separate evidence. Price mapping is never represented as a betting split.

## Behavior boundary

The shared resolver records the evidence but does not change its score, label, prediction, projection, side, grade, stake, or lock behavior. Each sport and market must consume the evidence through its authoritative model path under a separately versioned release. Missing price-map evidence must remain neutral and must not flatten the board.

## Member contract

No new reader section, source legend, book-tier copy, or raw sharp-versus-retail calculation is added. The compact direction meter is part of the existing Market Pulse and does not claim to be a betting split. When a sport-owned model later consumes this evidence, the resulting projection, play grade, and existing Market Pulse are the only member-facing outputs.
