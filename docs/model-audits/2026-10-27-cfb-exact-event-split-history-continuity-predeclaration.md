# CFB exact-event split-history continuity predeclaration

Date: 2026-10-27

Status: production candidate; publication and live verification required

## Owner-reported defect

The current Delaware-Western Kentucky member card has Public Consensus but no
Sharp Book Splits. At the same time, most NBA and NHL cards also lack a
complete named-book split pair.

## Source diagnosis

- SharpAPI `/splits` currently returns zero NCAAF rows.
- The exact Delaware-Western Kentucky event history retains complete
  DraftKings Moneyline, Spread, and Total money/ticket pairs. The newest
  recoverable observation was captured at `2026-10-26T14:33:26.130Z`.
- DraftKings Network's current public split page reports that splits are
  temporarily unavailable.
- Current NBA and NHL SharpAPI rows are BetMGM ticket-share-only records. They
  contain no handle shares. Exact-event history for representative current NBA
  and NHL games contains the same incomplete BetMGM evidence, not hidden
  DraftKings or Circa pairs.

Therefore the CFB incident is recoverable from an exact-event, source-verified
last-known observation. NBA/NHL cannot be truthfully populated from the
currently configured sources: Public Consensus must not be relabeled as a
named sharp book and missing handle shares must not be synthesized.

## Bounded CFB repair

When the existing one-request current NCAAF split pull produces no usable
record for an unlocked game beginning within 36 hours, the same sole CFB writer
may:

1. read the bounded NCAAF event catalog for the exact scheduled date;
2. require unique date, away-team, and home-team identity;
3. query at most two exact provider event identities per game and at most eight
   games per cycle;
4. accept only complete DraftKings or Circa money/ticket pairs from the most
   recent observation inside the existing 36-hour daily-sport continuity
   window; and
5. preserve the provider observation timestamp so the existing 120-minute CFB
   reader freshness gate continues to decide whether evidence may affect the
   forecast.

`DEL -> Delaware` is added as an abbreviation-scoped exact provider alias.
`Delaware` must remain rejected for Delaware State.

## Locked-record and model boundary

Locked payloads remain immutable. The recovery is part of the existing sole
`prediction_pipeline:cfb` writer and does not add a writer or lease. The
recovered Delaware-Western Kentucky record is older than the reader's
120-minute freshness threshold, so the current repair restores the split panel
without changing its forecast, probability, pick, grade, stake, or tracking
tuple. A future recovered row may influence an unlocked prediction only when it
is already eligible under the established reader freshness and provenance
rules.

No promotion or demotion rule changes. Expected current-board impact is zero
promotions, zero demotions, and zero actionable-count change.

## Release plan and rollback

- split collector: `cfb_sharpapi_splits_2026_10_27_r7_exact_event_history_continuity`
- evidence collector: `cfb_forward_evidence_collector_2026_10_27_r65_exact_event_split_history_continuity`
- sole writer: `cfb_forward_evidence_writer_2026_10_27_r140_exact_event_split_history_continuity`

Rollback restores r6/r64/r139. Stored locks remain untouched in either
direction.

## Acceptance gates

- Exact Delaware-Western Kentucky live-provider rehearsal restores one
  DraftKings record with complete Moneyline, Spread, and Total.
- The freshest qualifying exact-event observation wins.
- Delaware cannot attach to Delaware State.
- Current complete rows retain precedence over history recovery.
- Recovery remains bounded and sequential.
- Focused identity/split tests, TypeScript, `npm run verify:model-change`, clean
  latest-main integration safety, protected PR checks, and post-deploy live
  verification pass before success is declared.
