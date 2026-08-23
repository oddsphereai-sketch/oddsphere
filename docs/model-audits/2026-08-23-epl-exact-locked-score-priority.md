# EPL exact locked-score priority

## Incident

BOU@MNC locked at `2026-08-23T12:03:35.791Z`. Its immutable member snapshot
contains the score projection shown at lock:

- BOU expected goals: `1.0419136028115643`
- MNC expected goals: `2.322859921925649`
- likely score: `BOU 1-2 MNC`

The snapshot predates the additive `soccerProjection.matchResultOutlook` field.
PR #191 correctly stopped presenting a different goals head as though it were
the Match Result head, but rendered the legacy lock as refreshing. PR #192 then
reconstructed a new score outlook from the immutable 1X2 probabilities. That
reconstruction was coherent but was not the exact score displayed at lock.

## Correction

The reader priority is now:

1. stored `matchResultOutlook` for snapshots that contain it;
2. the exact stored `game.projected` and `soccerProjection` score fields for a
   legacy immutable locked snapshot;
3. deterministic 1X2 reconstruction only when neither stored score form exists;
4. fail closed when no trustworthy score context exists.

The legacy lock path is labeled `Exact value stored at lock`. It explicitly
states that the value is not recomputed after lock. The probability, pick,
grade, price, stake, lock time, writer, provider calls, and tracking record do
not change.

## Board impact

- promotions: 0
- demotions: 0
- prediction/probability/grade/stake changes: 0
- locked database mutations: 0

## Verification

The production database was read without writes. The current member snapshot
still stores the exact BOU@MNC values above, proving the lock itself was not
overwritten; the defect was reader precedence. Future locks already store the
same-head `matchResultOutlook` directly and therefore use priority 1.
