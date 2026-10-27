# Owls sharp-book split transition

Date: 2026-10-27

## Scope and authority

- Affected sports: MLB, NBA, WNBA, NFL, CFB/NCAAF, CBB/NCAAB, and NHL.
- Affected markets: full-game Moneyline, Spread, and Total wherever the product already exposes
  Sharp Book Splits. MLB first-inning evidence is not synthesized from a full-game Spread.
- Public Consensus: unchanged; Playbook remains authoritative.
- Source-specific Sharp Book Splits: Owls is the only live API source. The cutover makes no new
  SharpAPI split requests. Exact-game last-known-good display continuity may retain a previously
  verified complete pair during a temporary Owls gap.
- Writers, crons, and leases: unchanged. The existing scheduled Market Intelligence collector and
  Daily Edge response assembly remain the only paths; no second prediction writer or timer is added.
- Locked records: immutable. Every response overlay explicitly skips locked games.

## Qualification contract

An Owls observation enters the active named-book lane only when all of these hold:

1. Sport and exact normalized away/home identity match one canonical game.
2. A duplicate matchup is disambiguated by the provider event date; otherwise it fails closed.
3. Both opposing sides carry valid ticket and handle percentages summing to approximately 100%.
4. Both sides share one valid source timestamp that is no more than three hours old and no more
   than five minutes in the future.
5. Book priority is Circa, then DraftKings, then BetMGM. A partial BetMGM ticket-only row is never
   promoted to a complete sharp-book read.

Missing, partial, stale, malformed, wrong-sport, unmatched, and ambiguous evidence remains neutral.
The prior durable complete section remains available under the existing continuity contract.

## Model and member impact

The final verified named-book section is mirrored into each future-unlocked recommendation's
context-only market read. The operation preserves the writer-owned pick, model probability,
market-implied probability, evaluated price, grade, stake, lock, and tracking record. Therefore the
same-input impact is exactly zero promotions, zero demotions, zero side changes, zero probability
changes, zero grade changes, and zero actionable-count change. Only source-specific evidence,
resolved market-read status/copy, and source-health metadata may change.

Release identifiers:

- Member presentation: `daily_edge_member_presentation_2026_10_27_r28_owls_sharp_book_splits`
- Market Intelligence capture: `market_intelligence_v2_shadow_capture_2026_10_27_r6_all_owls_named_book_splits`

Capture r6 supersedes r5 only for internal retention: display still chooses one complete priority
pair, while canonical Market Intelligence stores every complete fresh Circa, DraftKings, and BetMGM
pair separately for market-reading research. It changes no writer-owned prediction field.

## Verification and rollback

Focused tests cover authentication redaction, payload normalization, freshness, complete-pair
selection, canonical storage, durable feed validation, response overlays, locked-game exclusion,
whole-number percentage transport (including 1%), market-reader propagation, and exact preservation
of grade/pick/probability. Publication additionally
requires TypeScript, the full model-change verifier, latest-main integration safety, protected PR
checks, and production proof after a scheduled refresh.

Rollback to presentation r27 and capture r4, while preserving append-only observations, if any row
crosses event identity, an incomplete pair appears complete, a locked snapshot changes, provider
failures erase last-known-good evidence, or member/source coverage regresses.
