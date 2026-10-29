# NBA consumer history continuity — 2026-10-29

## Problem

The future-unlocked NBA member board correctly selected a real consumer quote
after the execution-authority repair, but the movement panel could still show
only that current quote. The member evidence builder read chronology from
`market_price_observations_v2`, whose current NBA rows were Circa/Pinnacle
sharp-reader observations. Filtering those sharp books out of the public trail
was correct, but it also left the card unable to see the append-only FanDuel,
DraftKings, BetMGM, Caesars, Fanatics, BetRivers, bet365, and Hard Rock history
already captured by the sole NBA line writer.

## Pre-declared boundary

This repair is display evidence only:

- Fully paginate `line_history` for the exact current NBA game IDs and the
  Moneyline, Spread, and Total markets using a fixed high-water ID.
- Accept only valid mainstream consumer execution books and real stored
  timestamps, sides, prices, and lines.
- Merge those rows only when building future-unlocked member evidence, after
  the professional model and reader have completed.
- Do not add consumer rows to `buildNbaProfessionalMarketReader`, movement
  corrections, forecasts, probabilities, selections, grades, stakes, or the
  immutable legacy recovery path.
- Preserve exact stored locked payload precedence.

No opening line or intermediate move may be fabricated. Repeated real
observations may truthfully show that the same-book quote remained unchanged.

## Release identifiers

- Model: unchanged
  `nba_professional_unified_2026_10_29_r24_consumer_execution_authority`
- Market marriage: unchanged
  `nba_market_marriage_2026_10_29_r25_consumer_execution_authority`
- Grade policy: unchanged
  `nba_grade_policy_2026_10_29_r15_consumer_execution_authority`
- Locked member snapshot:
  `nba_locked_member_snapshot_2026_10_29_r8_consumer_history_continuity`
- Member lock publication:
  `nba_member_lock_publication_2026_10_29_r10_consumer_history_continuity`

## Required gates

- Consumer-history mapping rejects Circa/Pinnacle, unknown games, malformed
  sides, zero/missing prices, and invalid timestamps.
- Pagination is deterministic past the PostgREST 1,000-row boundary.
- Existing locked reader and writer precedence tests remain green.
- `npm run verify:model-change` and TypeScript verification pass.
- A same-input live no-write rehearsal reports zero score, side, grade,
  promotion, demotion, and actionable-count changes.
- Production verifies the public quote and movement reference use one real
  consumer book while sharp splits remain independently sourced.

## Candidate result

The credential-backed October 29 read-only rehearsal covered all three live
NBA games and all nine Moneyline, Spread, and Total markets. Every market
returned a coherent selected-side and opposing-side consumer chronology.
CLE at ATL now carries FanDuel history for both Moneyline sides and both
Spread sides at ATL -1.5 / CLE +1.5, while its Total carries Caesars history
for both Over and Under. SAC at NO and MEM at POR likewise populate all six
two-sided market scopes from BetRivers, BetMGM, DraftKings, or Caesars.

The candidate reads only stored timestamps and quotes. Several trails are
unchanged between first and current observations; they remain truthful flat
trails rather than fabricated movement. Circa/Pinnacle rows are rejected from
this member-only chronology. The production model, reader, final scores,
sides, prices, probabilities, grades, stakes, and actionable count are not
fed by this new map, so their same-input delta is zero by construction. The
focused member-evidence, site-wiring, locked snapshot, lock-publication,
TypeScript, and full `verify:model-change` suites passed.

## Rollback

Revert the member-only consumer-history loader and restore the r7/r9 publication
identifiers. Do not rewrite, replace, or reinterpret any locked payload created
under r8/r10.
