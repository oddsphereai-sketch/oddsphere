# Private player-props full-board and alternate-line tracking

Date: 2026-10-12
Starting production base: `160c16c4cb07c9a692d3550d2409126aba37ef50`
Status: additive internal tracking candidate; no forecast or member-product change

## Objective

Retain a private record of every locked NFL player-prop decision—not only Best Angles and Leans—and
the full offered MLB prop ladder so model accuracy, Market Reader lift, No Play/Watchlist
opportunity, and alternate-line sensitivity can be evaluated without changing the public tracking
page. The implementation proved that MLB's historical T-60 snapshots preserve the compact selected
main line, not the provider's full offered ladder. MLB therefore gains a separate prospective
pre-T60 ladder capture rather than falsely labeling historical main lines as offered alternates.

## Frozen boundaries

- No projection, probability, side, grade, threshold, stake, price selection, cadence, provider
  request, public copy, label, layout, or member route changes.
- Existing official actionable ledgers remain unchanged. The new NFL artifact is a separate private
  research archive under the existing sole `prediction_pipeline:nfl` writer and lease.
- MLB's existing `mlb_props_2026_09_21_r43` forecast release, sole refresh route, shared
  `prediction_pipeline` lease, compact member board, T-60 locks and official tracking remain
  authoritative and unchanged. Its private capture makes no provider request and cannot block
  canonical publication or lock creation.
- The archive appends only already-locked board rows after the member snapshot, official tracking,
  closing-price update, settlement, and existing market-observer capture. Failure is telemetry-only.
- For MLB, each successful canonical refresh may advance a game's private candidate only while its
  evaluation time is at or before T-60. The last successfully stored pre-lock ladder then freezes;
  an after-cutoff refresh cannot replace it. Explicit provider alternate rows remain alternates, and
  the selected non-alternate consensus line is marked canonical.
- The first captured locked tuple for an exact release/game/player/market/line/side/book key is
  immutable. Later cycles may add missing locked rows but cannot replace a prior value.
- Existing locked rows are not reconstructed or relabeled. Pre-release weeks may be read from an
  extant canonical snapshot only and are explicitly labeled as fallback coverage.

## Private report contract

The SELECT-only operator report has two non-overlapping views:

1. **Exact offer ledger:** every retained book, line, side, price, projection, independent point,
   model/market/final probability, grade, movement state, release tuple, result and actual value.
2. **Canonical scorecard:** one prediction per game/player/market/main line so repeated books and
   alternate ladders cannot inflate accuracy.

It also reports offered alternate-line scopes and favorable stat-unit cushions. Cushions are
market-specific: attempts/completions/receptions use count units, football yardage uses yard units,
and MLB count markets use their native half/full-stat units. Anytime touchdown remains binary and
does not receive a fictitious points cushion. Cushion hit rates are diagnostics only; profitability
requires a real offered alternate price.

## Accuracy use

The report separates:

- published and independent point MAE/RMSE/bias;
- independent, target-excluded market and final Brier/log-loss/calibration;
- best-available locked exact-price units/ROI (descriptive, not a staking recommendation);
- Market Reader corrections, harms, confirmations and unchanged losses;
- canonical main-line results from actual offered alternate-line results; and
- virtual favorable-cushion conversion by prop family.

The locked MLB board does not preserve every historical pre-market point projection, so the report
leaves that point field unavailable rather than reconstructing it; its stored independent
probability is still scored. All summaries remain release-separated. Archive aggregates spanning multiple releases carry an
explicit warning and cannot be called current-model performance. Any future model candidate must be
predeclared, evaluated chronologically and pass the ordinary model-change safety gates before it can
alter production.

## Initial read-only audit result

The first report run is deliberately split between what history can prove and what only the new
prospective archive can prove.

### MLB, 2026-09-25 through 2026-10-11

- Coverage: 72 stored game-lock pointers, 46 readable locked snapshots, 15,695 captured historical
  main-line offers, 5,010 offers matched to supported official outcomes and 2,839 deduplicated
  player/market/line forecast scopes. Coverage is incomplete and contains no historical full-ladder
  alternate offers; the report labels all 72 locks as main-line fallback coverage.
- Canonical record: 1,945-894 (68.51%). This is not a profitability result. Only 2,280 scopes had a
  usable exact locked price and those returned -76.93 units at one unit per scoped wager (-3.37%
  descriptive ROI).
- Probability quality: independent Brier 0.19592, target-excluded market Brier 0.19028 and final
  Brier 0.19026. The final reader improved the independent side in this sample, but did not
  materially outperform the market-only probability.
- Directional Market Reader attribution: 81 corrections, 65 harms, +16 net corrections, 1,777
  confirmations and 730 unchanged losses across 2,653 comparable scopes. This is evidence that the
  reader is influencing predictions; it is not evidence that one global increase in market weight
  would help every prop.
- Market heterogeneity is material. Net reader corrections were positive for total bases (+9), RBI
  (+6), singles (+3), pitcher hits allowed (+2), hitter hits (+1) and pitcher strikeouts (+1), while
  H+R+RBI (-1), runs scored (-2) and walks (-3) were negative. Several other markets had no side
  changes in this window.
- Grade calibration requires a larger owner-examined sample before any live rule change. Leans went
  63-33 and were essentially flat at exact prices (+0.24 units across 92 priced scopes), while the
  eight Best Angles went 2-6 (-4.59 units). The Best Angle count is too small for a safe automatic
  demotion rule, but it is a mandatory candidate-audit segment.
- Favorable virtual cushions show sensitivity, not tradeable performance. For example, batter hits
  converted at 98.8% with a full-stat cushion and total bases at 86.8%; those figures cannot be
  presented as alternate-line returns until the prospective archive supplies the actual alternate
  price offered at lock.

### NFL, 2026 Week 5

- The stored fallback snapshot supplies 248 exact rows, but the official stored outcome state does
  not yet settle them. Weeks 1-4 have official results but no historical full-board snapshot.
- The report therefore produces zero settled NFL forecast scopes instead of fabricating old No Play,
  Watchlist or alternate rows. Forward capture is required for a complete NFL audit.

### Product decision

This audit supports publishing the private capture and report, not retuning either live model in the
same change. The forward archive closes the missing-data problem and creates the evidence needed for
chronological, release-separated candidates: market-specific blending, grade calibration, projection
bias correction and actual-priced alternate-line evaluation. Any such candidate remains subject to
the normal promotion/demotion, board-count and live-release safety gates.

## Runtime identifiers

- NFL sole writer at release: `nfl_player_props_writer_2026_10_12_r48_private_full_tracking`; current additive availability successor: `nfl_player_props_writer_2026_10_12_r49_regular_season_identity_capacity`
- Private capture: `nfl_player_props_private_tracking_2026_10_12_r1_full_locked_board`
- Private schema: `nfl_player_props_private_tracking_history_v1`
- Private key: `nfl::player-props-private-tracking::<season>::<week>`
- MLB model release remains: `mlb_props_2026_09_21_r43`
- MLB private capture/schema: `mlb_props_private_tracking_2026_10_12_r1_pregame_full_offer_ladder` /
  `mlb_props_private_tracking_history_v1`
- MLB private key: `mlb::player-props-private-tracking::<slate-date>`
- Private report: `private_player_props_tracking_report_2026_10_12_r1`

The artifact is capped at 16,000 rows per week, 32 MB decoded and 2 MB gzip, retained for 550 days,
and makes zero provider calls. MLB's artifact is capped at 30,000 rows per slate, 32 MB decoded and
3 MB gzip with the same 550-day retention. MLB reporting may make bounded public MLB Stats API game-log reads
only when the private operator explicitly runs the report; those calls are not part of the site or
production writer.

## Verification gates

- full-board capture includes canonical and alternate locked rows;
- duplicate writes are idempotent and conflicting rewrites preserve the first tuple;
- checksum and compression round-trip;
- MLB's closer pre-lock candidate advances while after-cutoff data cannot replace it;
- explicit MLB provider alternates remain distinct from the selected main line;
- canonical scopes deduplicate two-sided and multi-book offers;
- market-specific cushion settlement, including pushes;
- private capture remains after authoritative settlement and failure-isolated;
- focused NFL writer/snapshot/market-board tests;
- `npm run verify:model-change` and current-main integration safety before publication;
- post-deploy proof of the r48 writer, one NFL lease/writer, archive rows, canonical/alternate counts,
  unchanged public board/release tuple, and immutable official tracking.
