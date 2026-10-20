# NBA lock publication and online tracking repair — 2026-10-20

## Scope and predeclaration

- Sport/markets: NBA Moneyline, Spread, and Total lifecycle metadata only.
- Current prediction release: `nba_professional_unified_2026_10_20_r11_heavy_tail_margin_calibration`.
- Current lock authority: `nba_lock_coherence_2026_10_15_r2_unified_score_tuple` under the sole `prediction_pipeline:nba` lease.
- Candidate member publication release: `nba_member_lock_publication_2026_10_20_r1_column_authoritative`.
- Candidate tracking publication release: `tracking_refresh_publication_2026_10_20_r1_nba_checkpoint`.
- Authoritative writer remains the existing NBA prediction-record writer and pregame sweep. No writer, provider call, model input, prediction, probability, score, side, selected line, price, grade, stake, threshold, lock boundary, or settlement rule changes.

The observed opening-day failure is downstream of the lock. BOS-DET's three
official rows locked atomically at `2026-10-20T18:00:59.937Z` and all three
pending grade rows exist, but the rolling member response snapshot was built
before that timestamp. The post-lock path then attempted to recompute all 52
rolling-board games and did not publish before the route ended. Separately, the
hourly tracking cycle successfully completed NBA but published its shared
reader snapshot only after every later sport; an NHL stall prevented that
publication.

## Candidate behavior

The NBA lock postlude reads the existing coherent Daily Edge snapshot and the
authoritative `prediction_records.locked_at` columns. It requires one complete
Moneyline/Spread/Total tuple with one identical non-null timestamp, then changes
only `scheduledLockAt`, `lockState`, and `lockedAt` in the response cache. It
does not reconstruct or update a stored locked payload. Normal full NBA reader
builds receive that same column timestamp as response-only metadata while the
exact captured DTO retains precedence for every model and market field.

The existing hourly tracking route now publishes its shared online snapshot
immediately after the NBA stage. Later sports remain on the same route and
their existing sport-scoped leases; NHL runs last so its failure cannot block
healthy sports from settling. The route budget rises from 180 to 300 seconds;
there is still one schedule and no parallel tracking writer.

## Outcome-blind board impact and gates

- Promotions: 0.
- Demotions: 0.
- Actionable count: unchanged.
- Prediction/score/side/probability/price/grade/stake changes: 0.
- Existing locked database mutations: forbidden; before/after SHA-256 hashes
  of all three BOS-DET rows must match exactly.
- The candidate fails closed on a partial three-market lock tuple, mismatched
  timestamps, unavailable response snapshot, or database read/write failure.
- Publication requires focused immutable-reader, lock-publication, tracking,
  cron-wiring, TypeScript, full model-change, and integration-safety checks,
  followed by live proof of the badge, the three immutable hashes, pending
  tracking rows, current snapshot timestamps, sole writer/lease, and site
  responsiveness.

Rollback removes the response-only metadata overlay and tracking checkpoint;
it never deletes, updates, or reconstructs an existing locked record.
