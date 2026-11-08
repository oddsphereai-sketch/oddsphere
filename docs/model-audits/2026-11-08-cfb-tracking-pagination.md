# CFB tracking pagination correctness repair

Base: `7c6c23f9dd715fdb96353507f35c11cefbd2ab2a`.
Writer release: `cfb_forward_evidence_writer_2026_11_08_r154_complete_tracking_identity_read`.

Production SELECT-only baseline on November 8:

- November 7: 95 final games, 95 immutable T-60 evidence rows, only 29 games /
  87 records in Tracking. All 87 existing results correctly match final scores.
- 92 source locks are tracking-enabled. Two late captures and one missing-anchor
  game retain their existing accuracy-only recovery semantics.
- 66 absent games include 26 saved Best Angle decisions (3 Moneyline, 3 Spread,
  20 Total). These are original source decisions, not new promotions.
- Season ledger: 2,715 records; the old unpaginated SELECT returns only 1,000.
  Repeated duplicate-key errors abort the batch containing the missing games.
- Other November saved Best Angles are settled: NBA 3/3, NFL 7/7, CBB 80/80,
  CFB 21/21. This census cannot substitute for missing-row reconciliation.
- The upcoming week is collected and visible: November 10, 113 Division I games,
  67 FBS-involved, member page updated November 8 at 7:45 AM Eastern. No weekly
  selection or model change is needed for the observed live rollover.

The sole writer now reads identities in 200-game batches and ordered 500-row
pages before any tracking write. The denominator audit uses that same reader.
No payload history is loaded by this lookup. A later-page failure stops writes;
existing markets are skipped regardless of release. No upsert/replacement of
prediction records is introduced. Same-input scores, probabilities, prices,
grades and stakes are identical: 0 promotions, 0 demotions, unchanged board.

Regression runs the real canonical writer against 1,200 immutable existing
records with a simulated 1,000-row API cap. It proves full reads, exact original
priced-lock materialization, no historical game writes, idempotent retry and
zero writes on later-page read failure. Existing locked-reader precedence tests
remain in the focused production suite. Tracking aggregate: 69/69 passed;
tracking refresh helpers: 45/45 passed; production build and TypeScript passed.
The full model gate and protected publication/live proof are required separately.

Original November 7 fingerprints for post-deploy comparison:

- 87 prediction_records through id 555779: MD5 of ordered full-row JSON
  `8e79a678a1a5146bc7d86adbbe199ec0`.
- 95 T-60 evidence id/payload_sha256 pairs: ordered MD5
  `6098db9da87a568868f400614ec0da85`.

Older final-game partial-market coverage exists on August 29 (1 game), September
5 (7), September 6 (3), and September 26 (1). Those games already have tracking;
missing historical market contracts must not be invented to force three rows.
The newly identified zero-record gap is the 66 November 7 games.
