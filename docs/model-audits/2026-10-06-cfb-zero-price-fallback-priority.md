# CFB zero-price fallback priority and monotonic publication time

## Scope and predeclaration

The October 6 current board contained 86 games. Fifty-four games had complete named-book prices;
31 FCS-only games and ODU at Appalachian State had no verified paired sportsbook quote. The
existing SharpAPI fallback remained bounded to 24 games, but its ordering treated a game with no
price as equivalent to a priced game that merely lacked three same-line consensus books. A natural
hourly cycle therefore left 23 of the 32 zero-price games deferred while spending part of the
unchanged budget enriching already-priced games.

The repair may change only provider-attempt priority and compact-snapshot publication metadata. It
must not synthesize a sportsbook, line, price, split, prediction, grade, stake, or lock; add a
request, writer, schedule, database loop, member label, or copy; rewrite a prior lock; or weaken
strict exact-event and paired-quote validation. The current 24-game / 192-request SharpAPI limits,
sole `/api/cron/cfb-forward-evidence` writer, and `prediction_pipeline:cfb` lease remain fixed.

## Evidence and result

A bounded read-only provider replay covered the eight games deferred by the preceding cycle, the
one ambiguous event, and ODU at Appalachian State. Ball Don't Lie returned zero books for all ten.
SharpAPI matched eight FCS events plus ODU but returned zero trusted paired books; Jackson State at
Grambling was unpublished. Playbook returned no row for the FCS games and a complete reference
line for ODU at Appalachian State (`APP -9.5`, Total `50.5`, Moneyline `-360/+280`). That reference
already supports line-specific model predictions but cannot be relabeled as a named sportsbook
price for Spread or Total.

The selector now orders candidates by verified paired-market coverage before its existing
deferred/unseeded rotation. Zero-price games are therefore attempted before partial-consensus
enrichment, while deferrals still rotate fairly within that zero-price cohort. A deterministic
30-game test proves that the six zero-price games win a six-game budget even when they already have
trusted event IDs and 24 competing games have one paired market. Provider caps and maximum calls
are unchanged.

The natural 15:54 UTC writer cycle also exposed `sourceCapturedAt` 49.84 seconds after
`publishedAt`: provider evidence received during the run was timestamped after the run-start value
used for publication. Snapshot r30 publishes at the later of requested publication time and newest
included source time. Reader r15 accepts the immediately preceding r29 tuple during handoff. This
changes cache chronology only; scores, PMFs, probabilities, sides, grades, prices, locks, and
tracking tuples are unchanged for identical evidence.

## Releases and rollback

- Collector: `cfb_forward_evidence_collector_2026_10_06_r44_zero_price_fallback_priority`
- Sole writer: `cfb_forward_evidence_writer_2026_10_06_r97_zero_price_fallback_priority`
- Compact snapshot: `cfb_forward_member_snapshot_2026_10_06_r30_monotonic_publication_time`
- Reader: `cfb_member_snapshot_reader_2026_10_06_r15_monotonic_publication_time`

Rollback those four identifiers and the selector ordering together if provider calls exceed the
existing cap, the zero-price cohort fails to rotate, the board disappears during handoff, snapshot
publication precedes source capture, or any same-input prediction/grade count changes. Preserve all
append-only evidence and immutable tracking rows.
