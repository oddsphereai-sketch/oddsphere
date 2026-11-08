# CFB tracking completeness and weekly continuity — predeclaration

Starting base: `7c6c23f9dd715fdb96353507f35c11cefbd2ab2a`.
Owner requested missing Best Angle tracking, incomplete November 7 settlement,
and the next weekly board rollover be repaired urgently.

SELECT-only evidence: 95 November 7 games have T-60 evidence; 29 games / 87
market rows are materialized and correctly settled. The remaining 66 are absent
from Tracking. Production CFB prediction records total 2,715, but an unpaginated
REST SELECT returns 1,000. The canonical writer repeatedly logs duplicate-key
`prediction_records_game_market_version_slate_key` failures, rejecting its batch.
92 T-60 payloads are tracking-enabled; two have late captures and one has no
market anchor. Their existing accuracy-only recovery policy remains authoritative.

Candidate writer r154 must read every existing identity in bounded ordered pages
before planning inserts. It must retain original locked picks, probabilities,
prices, grades, release IDs and evidence exactly, skip all existing markets, fail
closed on any read failure, and remain under the sole prediction_pipeline:cfb
lease. No recommendation, threshold, calibration, stake or board-grade change is
proposed: same-input promotions and demotions are both zero. Missing tracking rows
may only materialize existing pregame evidence using the canonical writer.

Regression must exceed the 1,000-row production cap, preserve old records, insert
new markets once, be idempotent on retry, and fail before writes on a later-page
read error. Require focused production/tracking tests, full model gate, fresh-main
integration safety and protected PR. Verify production release, canonical writer,
all 95-game market coverage and settlement, immutable originals, member Tracking,
and the upcoming weekly board. Investigate rollover separately before changing it.
