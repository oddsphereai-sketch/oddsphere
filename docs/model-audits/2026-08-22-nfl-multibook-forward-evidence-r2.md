# NFL multi-book forward evidence — 2026-08-22 r2

## Scope

This release expands the existing append-only NFL forward evidence payload. It
does not publish a probability, projected score, side, Bet grade, stake,
tracking record, or settlement instruction. The public Week 1 board remains on
the explicit model-validation hold.

- Evidence schema: `nfl_forward_evidence_snapshot_2026_08_22_r2_multibook`
- Collector: `nfl_forward_evidence_collector_2026_08_22_r2_multibook`
- Writer: `nfl_forward_evidence_writer_2026_08_22_r2_multibook`
- Provider slate: `balldontlie_nfl_regular_slate_2026_08_22_r2_multibook`
- Authoritative route: `/api/cron/nfl-forward-evidence`
- Lease: required `prediction_pipeline:nfl`

The schema, collector, and writer identifiers bump because the model-input
evidence changes. Historical r1 rows remain immutable. The first r2 cycle
seeds a distinct r2 opening row per game while copying the earlier r1
operational-opening quote, provenance, and timestamp into the new payload.
The existing six-hour/hourly/T-60 cadence then resumes.

## Root cause and correction

BALLDONTLIE already returned multiple current sportsbook rows for every Week 1
game. The r1 normalizer selected one representative quote (FanDuel) and
discarded the remaining rows before the append-only payload was built. That was
enough for a truthful price board, but not enough for a timestamp-valid
leave-one-book-out value policy.

r2 preserves three distinct concepts:

1. `market.current`: the unchanged representative headline quote.
2. `market.currentBooks`: every complete provider book row, retained for audit.
3. `market.comparableCurrentBooks`: only conventional sportsbooks eligible for
   a future comparable-consensus calculation.

The comparable allowlist is FanDuel, DraftKings, Caesars, BetMGM, Fanatics, and
BetRivers. Kalshi and Polymarket are preserved in the all-book array but cannot
enter a sportsbook no-vig consensus. The same separation is stored for
provider-native opening rows when the provider supplies them.

This adds no provider request. It only retains data already present in the
bounded BALLDONTLIE response. A missing two-book comparable set is an explicit
`multibook_consensus_unavailable` health hold rather than an ordinary No Play.

## Live no-write coverage proof

The bounded August 22 probe used three requests and made no database, cache,
prediction, publication, grade, or tracking write.

- Week identity: 2026 Regular Season Week 1
- Games: 16/16
- Raw and matched current rows: 112
- Complete moneyline/spread/total rows: 112
- Complete rows per game: seven for every game
- All observed books: BetMGM, BetRivers, Caesars, DraftKings, FanDuel, Kalshi,
  Polymarket
- Comparable conventional books: five for every game (all above except Kalshi
  and Polymarket; Fanatics was not present in this capture)
- Games with at least two comparable books: 16/16

## Promotion boundary

Multi-book availability is necessary evidence, not a betting result. No
leave-one-book-out rule may affect the member board until it is selected and
confirmed chronologically on exact offers, reports calibration/proper scores,
units/ROI, normalized CLV, largest-win sensitivity, weekly and sportsbook mix,
and promotions/demotions, and passes the full model-change protocol. Bet count
remains an output; r2 does not introduce a forced weekly quota.
