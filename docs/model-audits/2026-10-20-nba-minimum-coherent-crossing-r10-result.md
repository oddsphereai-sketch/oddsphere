# NBA minimum-coherent crossing r10 result

Date: 2026-10-20

Status: accepted production candidate; publication and post-deploy verification pending

## Decision

Advance the NBA unified projection from r9 residual mirroring to r10 minimum
coherent crossing. Reader qualification, independent inputs, market sides,
grades, stakes, writer, cadence, lease, tracking, and locked-record precedence
remain unchanged.

The candidate uses only the existing qualified reader decision. When r9 would
flip a side by mirroring the complete independent residual across the line,
r10 instead chooses the nearest margin or Total that preserves r9's Moneyline,
Spread, and Total directions. The existing 0.25-point minimum residual is the
decision-boundary separation. This is not a fixed market weight and does not
cap an already-aligned independent projection.

## Historical proxy

The two-season public-consensus proxy is evaluation evidence, not an exact
reconstruction of source-specific live trails. The candidate preserved every
r9 Moneyline, Spread, Total, selected-underdog, +3, and +6 direction.

| Season | Version | Team-score MAE | Margin MAE | Total MAE | Winner | Brier | Spread | Total |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2024-25 | r9 mirror | 9.2590 | 10.9363 | 14.7682 | 68.38% | 0.20665 | 51.68% | 49.63% |
| 2024-25 | r10 minimum | **9.1503** | **10.7445** | **14.6273** | 68.38% | **0.20362** | 51.68% | 49.63% |
| 2025-26 | r9 mirror | 9.5109 | 11.0537 | 15.1556 | 69.28% | 0.19874 | 52.94% | 52.61% |
| 2025-26 | r10 minimum | **9.4395** | **11.0151** | **15.0845** | 69.28% | **0.19726** | 52.94% | 52.61% |

The result closes the immediate score-versus-side tradeoff without importing
the separate post-hoc continuous public-consensus coefficients into production.

## Current-board impact

Read-only same-input audits were run from clean r9 and r10 worktrees against
the October 20 three-game board. All three games had complete reader evidence.

- Picks changed: 0 of 9 markets.
- Grades changed: 0 of 9 markets.
- Actionable count changed: 0; both releases produced two actionables.
- Prices changed: 0.
- PHI-NY and OKC-SA scores changed: 0.
- BOS-DET retained BOS Moneyline, BOS -1.5, and Over. Its representative score
  changed from BOS 115.341 / DET 112.819 to BOS 114.955 / DET 113.205 because
  the qualified BOS Spread side needs only a 0.25-point residual beyond -1.5,
  not a mirror of the full independent residual.

The r10 read remained one coherent score/probability/pick tuple. The existing
reader release remained
`nba_professional_market_reader_2026_10_20_r6_structural_qualification`.

## Automated evidence

- Unified projection regression, including a grid comparison against the exact
  r9 formula: passed.
- Professional candidate score/pick/price/grade-input coherence: passed.
- Locked member snapshot precedence: passed.

Publication still requires TypeScript, the full model-change suite, latest-main
integration safety, protected pull-request checks, and post-deploy verification
of releases, board coherence, writer/lease health, and unchanged locked rows.

## Rollback

Roll back model and market marriage from r10 to r9 and unified projection from
r4 to r3 if same-input picks diverge, locked data changes, score coherence
fails, actionability contracts unexpectedly, or writer/lease health regresses.
