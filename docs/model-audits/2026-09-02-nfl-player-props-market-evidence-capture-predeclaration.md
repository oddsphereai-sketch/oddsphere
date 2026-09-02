# NFL Player Props Market Evidence Capture Predeclaration

Date: 2026-09-02
Base: `d4011de2da10fa2303c79bf2d1c1a9243cd40f1e`
Capture release: `nfl_player_props_market_evidence_capture_2026_09_02_r1`

## Scope

This is additive forward evidence only. It cannot change a posterior, side,
projection, probability, grade, stake, exact evaluated price, lock, tracking
tuple, provider request, database query/write, cron, lease, or member-facing
decision value. Existing model, calibration, decision, runtime, board, member,
writer, tracking, and settlement releases remain authoritative.

The existing NFL props writer already holds the complete exact offer set while
constructing the board. The capture normalizes that in-memory evidence into one
object per game/player/market/line identity. Complementary Over and Under rows
reference the same deterministic 16-hex identity; they never duplicate the
book array. No new provider call, table, endpoint, or writer is introduced.

## Frozen schema and bounds

Schema `nflpme1` stores compact, documented tuples:

- deterministic identity and short market enum;
- at most eight books per identity, with short provider and sharp/retail/unknown
  class enums;
- exact current observation/fetch timestamps and clock skew, same-book opening
  timestamp/line/prices, current two-sided or milestone price, and an evaluated
  side bitmask;
- complete, incomplete, stale, missing, and singleton breadth states;
- incumbent independent-residual coefficient, the separate quarterback point-
  projection market coefficient when applicable, independent/published point
  outputs, and raw/market/final probability, edge, EV, and grade for each side;
- `sp=n`, recording that the current NFL props contract has no verified prop-
  scoped split input and therefore applies a neutral missing-split value.

When size retention is necessary, identities are ordered by deterministic hash
inside each supported category and retained category-round-robin. A source-
stratified book order prevents first-N retail bias. Evaluated books are marked
but excluded when comparator breadth is interpreted. The capture has a hard
added-size ceiling of 524,288 serialized bytes for the full production
snapshot, inclusive of additive decision references.

## Measured pre-patch production topology

The latest stored Week 1 snapshot at `2026-09-02T11:51:09.409Z` serialized to
9,071,155 bytes; its board serialized to 4,611,808 bytes. It contained 1,137
decisions and 1,074 member decisions. A self-contained tuple prototype over the
same topology projected 314,918 added bytes including both full-snapshot
decision-reference copies, leaving 209,370 bytes below the hard ceiling.

The implemented tuple was subsequently replayed in memory against that same
stored canonical snapshot without a provider call or database mutation. The
9,071,155-byte baseline became 9,510,622 bytes after additive metadata, a
measured increase of 439,467 bytes and 84,821 bytes of remaining headroom. The
replay reconstructed 1,109 stored book observations (1,077 complete), retained
all 701 observed complementary identities, and stored at most six books on an
identity. The increase over the pre-patch structural estimate is attributable
to exact output/timestamp provenance added by the frozen implementation; it
remains inside the declared hard limit.

The retained categories must include every populated supported market. Missing
evidence remains neutral and receives a truthful reason code; capture absence
must never become a Hold or decision input.

## Required gates

- Canonical and member outputs, counts, values, and ordering must be exactly
  equal after removing only `marketEvidence` and `marketEvidenceId`.
- One complementary identity must own one book array and both side references.
- The evaluated book, target-excluded breadth, timestamps, skew, and opening
  trail must be reproducible.
- Synthetic oversized input must remain within 524,288 added bytes and retain
  every populated category deterministically.
- Static and runtime tests must prove unchanged provider collection and
  database write-path counts.
- Locked rows retain their exact prior payload; the capture is additive only to
  newly computed rows and never reconstructs a locked decision field.
