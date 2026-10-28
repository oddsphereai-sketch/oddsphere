# Owl's ticket-share capture predeclaration

Date: 2026-10-28

## Scope

- Affected capture family: the existing Market Intelligence V2 postlude used by MLB, WNBA, NBA,
  NHL, NFL, CFB, and CBB scheduled writers.
- Affected markets: full-game Moneyline, Spread, and Total source-specific split observations.
- Existing capture release:
  `market_intelligence_v2_shadow_capture_2026_10_27_r9_all_sport_owls_schedule`.
- Candidate capture release:
  `market_intelligence_v2_capture_2026_10_28_r10_owls_ticket_share_retention`.
- Authoritative paths, writer schedules, sport-scoped prediction leases, prediction models,
  calibrations, decisions, grades, stakes, locks, member snapshots, and readers are unchanged.

## Confirmed defect

A bounded authenticated NBA probe returned 12 Owl's events and 72 normalized BetMGM rows with
valid opposing ticket percentages, no handle percentages, feed status `partial`, and reason
`book_unavailable`. The existing normalizer preserved those rows in memory, but the canonical
capture selected only complete money-plus-ticket pairs and therefore wrote none of the BetMGM
evidence. This silently erased a real provider observation that is useful as retail ticket context.

The missing handle is not sharp money and must remain `NULL`; it must never be inferred as 50%,
copied from tickets, or used to construct money-minus-ticket divergence. Member-facing priority
selection must continue to require a complete two-sided money-plus-ticket pair.

## Candidate behavior

- Continue retaining every fresh, complete Circa, DraftKings, and BetMGM money-plus-ticket pair as
  a separate source-book observation.
- Additionally retain a fresh, coherent two-sided BetMGM ticket-only pair with
  `source_type=retail_ticket_share`, factual ticket percentages, and `money_pct=NULL`.
- Reject one-sided, mixed-timestamp, malformed, non-complementary, stale, or future observations.
- Keep ticket-only evidence out of the member split selector and give it zero direct resolver score.
- Reuse the already-issued league-level Owl's request; incremental provider calls are zero.

## Production-impact boundary

This is an observation-capture repair only. It cannot change a projection, probability, side,
price, market selection, grade, promotion, demotion, stake, lock, tracking record, or member
snapshot. Same-input board impact is therefore contractually zero promotions, zero demotions,
zero side changes, and zero actionable-count change. Any future predictive use requires a separate
versioned sport/market release and release-pure chronological evidence.

## Verification and rollback

- Focused normalizer, canonical-adapter, resolver, and all-sport sync tests must prove truthful
  ticket-only retention and unchanged complete-pair display selection.
- `npm run verify:model-change` must pass.
- Roll back the capture release to r9 if ticket-only rows are mislabeled, incomplete pairs reach the
  member selector, provider calls increase, write volume is unbounded, or any prediction-owned field
  changes. Existing observations and locked records remain immutable.

## Candidate verification result

The candidate was exercised without database writes against the 2026-10-28 NBA slate:

- 12 canonical games were matched to 12 Owl's split events with zero identity rejections.
- The existing single league request produced 72 factual BetMGM ticket-share observations; every
  retained row had `source_type=retail_ticket_share` and `money_pct=NULL`.
- The existing price request produced 144 current source-book price rows; combined with 606 stored
  rows, the reader rehearsal received 750 price observations.
- No prediction, decision, grade, stake, lock, tracking, or member-facing write was attempted.
- The local Playbook refresh was unavailable because that provider key was not present in the
  worktree environment; already-persisted Playbook observations and the independent Owl's rehearsal
  were unaffected.

Focused provider, canonical-adapter, and all-sport sync tests passed, as did TypeScript checking and
the complete `npm run verify:model-change` gate. The optional Market Brain PostgreSQL proof was
reported as skipped because `MARKET_BRAIN_POSTGRES_URL` is not configured locally; production
activation of a predictive Market Brain remains separately prohibited until its sport-specific
chronological proof and database-backed checks pass.
