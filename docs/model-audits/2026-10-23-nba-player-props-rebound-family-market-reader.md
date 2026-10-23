# NBA player-props rebound-family market-reader repair

Date: 2026-10-23
Status: production candidate for future-unlocked rows; locked rows remain immutable

## Owner direction

Oddsphere must use market evidence to confirm or correct an independent player-prop forecast, but it must not let a broad consensus disagreement erase a substantially stronger independent read. The repair is internal only: no member copy, label, layout, provider cadence, or public tracking change is authorized.

## Scope

Only these exact-price arbitration policies change:

- Rebounds
- Rebounds + Assists
- Points + Rebounds + Assists

Points + Rebounds and every non-rebound-family market remain unchanged. The frozen independent models, model coefficients, reliability models, grade policies, target-book exclusion, canonical-line selection, writer topology, lease, cadence, and member reader remain unchanged.

The three affected markets now require:

1. target-excluded consensus at least four percentage points from 50%; and
2. neither the same-book line nor the same-book no-vig price trail may move against the proposed market flip.

This is not a market blend, an Under quota, or a global no-flip rule. A qualified market correction still produces one coherent final projection on the corrected side. Missing movement does not manufacture opposition.

## Release-pure diagnosis

The select-only inventory reconstructed all 157 settled October 22 locks from their exact stored target quote, target-excluded comparison books, same-book opening/prior/current trail, immutable lock timestamp, and official box score.

Across all markets, the stored independent side was 108-49 while the released final side was 96-61. The loss was concentrated in broad rebound-family arbitration:

| Market | Released final | Stored independent |
|---|---:|---:|
| Rebounds | 10-12 | 10-12 |
| Points + Rebounds | 12-4 | 12-4 |
| Rebounds + Assists | 11-5 | 13-3 |
| Points + Rebounds + Assists | 15-4 | 16-3 |

The standalone inventory's stored member rows are not used to rewrite any lock. They are diagnosis only.

## Exact runtime comparison

The candidate was replayed through the actual frozen runtime using the same 52 point-in-time feature rows and 15,823 pre-lock observations. Results:

| Market | Active final | Candidate final | Active MAE | Candidate MAE |
|---|---:|---:|---:|---:|
| Rebounds | 10-12 | 12-10 | 3.067 | 2.890 |
| Points + Rebounds | 12-4 | 12-4 | 5.755 | 5.755 |
| Rebounds + Assists | 11-5 | 13-3 | 3.111 | 2.909 |
| Points + Rebounds + Assists | 15-4 | 16-3 | 6.682 | 6.596 |

The affected family improves from 48-25 to 53-20. Rebounds retain two market flips; both correct losses from the independent side and neither harms it. Rebounds + Assists and PRA retain the independent side where the proposed market correction lacks non-opposed lock-time movement support.

## Board impact

- Best Angle: 1 -> 1
- Lean: 2 -> 2
- Watchlist: 4 -> 3
- No Play: 66 -> 67
- Actionable promotions: 0
- Actionable demotions: 0
- One losing Watchlist becomes a winning No Play.

This does not flatten the actionable board and does not change any grade policy. There is no actionable demotion requiring a paired promotion.

## Release boundary and rollback

Runtime/artifact release advances to `nba_player_props_frozen_runtime_artifact_2026_10_23_r7_rebound_family_market_reader`; decision release advances to `nba_player_props_forward_decision_2026_10_23_r7_rebound_family_market_reader`. The artifact checksum is regenerated from the unchanged frozen models plus the versioned arbitration policy.

Existing locked rows must retain their exact stored projection, side, probability, grade, price, and evidence. The release applies only when the sole writer recomputes unlocked/future decisions. Roll back future-unlocked generation if the live artifact identity differs, the sole writer does not publish the new decision release, any lock changes, or live board impact falls outside the reviewed policy.

The support-weighted standalone rebound projection remains a separate research candidate and is not smuggled into this repair.
