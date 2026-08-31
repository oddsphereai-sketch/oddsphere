# MLB r74 source-aware split-pair recency correction

Date: 2026-08-31

## Decision

Advance a deterministic evidence-identity correction in the existing MLB
prediction-record writer. For each market and source, the writer must freeze
the newest internally coherent split pair. Two sides may pair only when their
provider, source book, source type, and exact provider observation timestamp
match. When the provider does not publish an observation timestamp, both sides
must share the same ingestion timestamp. Pair complement quality retains the
existing two-percentage-point tolerance, but row adjacency can no longer beat
recency or combine different observations.

This release does not change a projection, probability head, public
calibration, selected-side rule, exact-price selector, split threshold,
promotion duration, stake, provider call, writer, lease, timer, or lock rule.
It versions the evidence selector and every downstream decision/grade identity
that can be affected: schema v7, selector v2, decision r74, rule bundle v62,
grade policy v52, and correction policy v23. Calibration remains v27 and the
r73 two-cycle/twenty-minute promotion contract remains active.

## Root cause and Houston incident

`market_split_observations_v2` is queried newest-first, but each ingestion may
contain many provider-history observations with the same `fetched_at`. The old
compactor searched every left/right combination, minimized complement error,
then minimized the rows' array-index distance. It never compared
`source_observed_at`. It could therefore choose an older adjacent pair over a
newer complete pair, or synthesize two sides from different observation times.

For CWS@HOU Moneyline:

- At the 2026-08-31 17:45:37Z writer cutoff, the old selector used Circa's
  17:05:44Z pair: HOU 42% tickets / 41% money, a -1pp signed gap. A newer
  complete 17:26:10Z pair was already stored: HOU 31% / 21%, a -10pp gap that
  meets the existing signed-resistance stand-down boundary. The public record
  became Houston Best Angle at -137.
- At the 18:15:37Z writer cutoff, the old selector combined an away row from
  17:36:26Z with a home row from 17:51:02Z because those rows happened to be
  adjacent and complementary. The public record returned to No Play with the
  same side, -137 price, probability, and edge.
- The corrected selector chooses the exact 17:26:10Z pair at the first cutoff
  and the exact 17:56:11Z pair (HOU 32% / 20%, -12pp) at the second. The stale
  intermediate Best Angle is therefore never authorized.

Houston's later No Play remains independently coherent: the 20:45 writer held
HOU at 55.76% and -136, while verified Sharp resistance remained -17pp. The
canonical movement reference is a same-book trail; movement at another book
cannot be merged into that trail.

## Frozen replay protocol

The identity rule was fixed before outcome inspection. No threshold grid was
searched. The read-only replay used the exact immutable row cutoff
(`locked_at`, or `published_at` for the current unlocked slate), the old pair
stored in `snapshot_json.source_aware_split_rows_at_lock`, and raw provider
history available no later than that cutoff. Queries were bounded to 500 rows
per event, the same writer limit.

- Selection/diagnostic period: 2026-08-22 through 2026-08-27.
- Untouched later confirmation: 2026-08-28 through 2026-08-31.
- Cohort: 270 release-stamped Moneyline/Total rows.
- Outcomes, units, ROI, Brier, and CLV were not used. This is an input identity
  correction, not a fitted prediction or grade threshold, and the replay does
  not manufacture a counterfactual settled bet where other gates may still
  block an action.

## Replay result

The newest coherent evidence timestamp differs from the previously frozen
timestamp on 143 rows; 42 selected-side money-minus-ticket gaps change.

| Window | Rows with newer pair | Gap changes | Signed stand-down added | Signed stand-down removed | Support added | Support removed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Aug 22–27 selection/diagnostic | 88 | 29 | 1 | 3 | 5 | 0 |
| Aug 28–31 untouched confirmation | 55 | 13 | 0 | 0 | 0 | 0 |
| Combined | 143 | 42 | 1 | 3 | 5 | 0 |

The boundary changes are balanced rather than a hidden board-flattening rule.
The one newly recognized signed stand-down is KC@TOR Moneyline on Aug. 27,
where the stored pair showed +2pp but the newest coherent pair showed -42pp.
The three removed stale stand-downs are TEX@CWS Aug. 25 (-10pp to +16pp),
COL@WSH Aug. 26 (-10pp to -9pp), and MIL@NYM Aug. 27 (-36pp to -1pp). Five
newly recognized support boundaries occur in the same diagnostic period. A
released stand-down or added support is only eligibility evidence; every
existing probability, price, projection, movement, data-health, and promotion
gate still applies.

At the frozen 2026-08-31 20:45:32Z current board, every selected ticket/money
threshold classification remains the same under the corrected pair. The
36-market board therefore remains 1 Best Angle / 8 Leans / 11 Watchlists / 16
No Plays: Moneyline 0 / 3 / 2 / 7, Total 1 / 2 / 9 / 0, First Inning
0 / 3 / 0 / 9. Promotions: 0. Demotions: 0. Side, probability, projected
score, evaluated price, stake, Total/FI decision, and provider-call deltas: 0.

## Tests, load, and rollback

Focused regression covers:

1. a newer coherent pair beating an older adjacent pair;
2. different provider observation times never forming a synthetic pair;
3. an invalid newest pair falling back to the newest earlier coherent pair;
4. release registry/runtime coherence while probability heads and r73
   promotion timing remain unchanged.

The correction adds zero queries, provider calls, writes, retries, or timers.
It runs inside the existing bounded event query and authoritative
`prediction_pipeline:mlb` writer/lease. Locked rows remain immutable.

Rollback is decision r73, rule bundle v61, grade policy v51, correction v22,
schema v6, and the prior adjacency-based compactor. Calibration v27,
evaluation-price v3, and action-promotion r1 remain unchanged under either
release.
