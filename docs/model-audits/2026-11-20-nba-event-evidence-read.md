# NBA evidence-read timeout repair

Starting main: f56f908bcac7d932954ce95901be93db0027c49d.
Own branch: codex/nba-event-evidence-read-20261120.

## Concrete defect

A production-shaped November20 NBA pipeline rebuild failed with
`price_observation_lookup_failed`, preserving the previous published board.
The exact44-event first-page query reproduced PostgreSQL57014 statement timeout
in8,597ms. PostgreSQL can choose a global ID-index scan to satisfy an ordered
IN-list whose events are sparse, especially future events with no observations.
A descending-ID frontier query for one empty future event also timed out in8,460ms.
The same populated event's first500 rows returned in472ms; unordered exact
counts returned1,984 rows in567ms and a genuine empty event in456ms.

This is a real refresh/read failure. It does not prove that every recent losing
forecast was stale or that repairing reads guarantees winning picks.

## Repair and complete-evidence proof

The existing leased NBA writer now reads the identical price columns through
bounded exact-event scopes. It freezes the existing global high-water ID, asks
for each event's exact row count at that frontier without global-ID sorting,
then continues ID keyset pages until that count is satisfied. Short server-capped
pages cannot terminate a read. A final unordered scope probe proves exhaustion,
including empty scopes. All rows are merged into the original global ID order.

The reader checks scope identity, ID monotonicity, count/exhaustion agreement,
duplicates and the final global frontier. Any failed event, missing count or
exhausted event/page/row budget rejects the whole read and retains the prior
published board. It never publishes a favorable subset, substitutes empty
opposition, samples history, resets an anchor or invents provider clocks.
Concurrency is four. Bounds are128 events,1,024 data pages and200,000 rows.
No table/index migration, new writer, timer, provider call or policy threshold.

A SELECT-only replay of the same44 events returned all15,908 observations in
7,654ms, exactly matching an independent database count. Last ID equals the
frozen frontier9,118,871. Nine current games have rows;35 future events are
honestly empty. Full selected payload SHA256:
55f3d75af6fe92f0b5c2b86a06ca0e023446ee7122423db17febb524736cd765.
This includes every saved observation under that frontier, with zero writes.

## Releases and behavioral boundary

- Model/record: nba_professional_unified_2026_11_20_r37_event_scoped_evidence.
- Marriage: nba_market_marriage_2026_11_20_r39_event_scoped_evidence.
- Reader: nba_reader_publication_2026_11_20_r3_event_scoped_price_evidence.
- Read primitive: nba_price_evidence_read_2026_11_20_r1_event_scoped_pages.
- Grade remains nba_grade_policy_2026_11_06_r31_moneyline_wager_price_boundaries.

For identical complete evidence this changes zero scores, probabilities, picks,
prices, grades or stakes: zero promotions, zero demotions, zero market-mix change.
Fresh evidence can naturally change a later forecast through the unchanged
existing rules; an older cached board and a newer source wave are not a causal
same-input model comparison. Full current-board counts and live source/release
proof must be captured after deployment. The separate conditional-Total numerical
candidate is not part of this release and remains unapproved/offline.

R36/R35/R34 saved knowledge remains compatible. Every existing locked payload
and release retains exact writer/reader precedence. The shared
prediction_pipeline:nba lease, T−60 owner and normal cadence remain authoritative.
The current required checks, integration proof, protected PR, deployment and live
refresh/reader/locked-history verification are required before declaring it live.

Tests cover exact payload parity, server caps, fixed-frontier arrivals, bounded
concurrency, empty futures, failures, mismatched scope/count, duplicate IDs,
fail-closed publication and writer/reader lock precedence. Private read receipts,
full test logs and live proof are retained under the ignored learning-lab archive.
