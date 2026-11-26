# CFB market-reading signal audit — 2026-09-26

## Scope

This was a SELECT-only, release-separated audit of settled, locked CFB evidence. It made no
provider requests and no database writes. It evaluated the independent forecast against the
published market/sharp-aware forecast and separately measured same-book movement, Circa
money-versus-ticket gaps, Playbook public money-versus-ticket gaps, explicit reverse-line
movement, and newly captured Circa/Pinnacle price trails.

The executable audit is `scripts/operator/audit-cfb-market-reading-signals.ts`.

## Results

Across 184 settled games, the published forecast improved over the independent forecast:

| Metric | Independent | Published |
| --- | ---: | ---: |
| Team-score MAE | 9.6101 | 8.5154 |
| Margin MAE | 14.4284 | 12.1760 |
| Total MAE | 12.9952 | 12.2118 |
| Winner accuracy | 80.98% | 85.33% |
| Spread accuracy | 51.01% | 51.68% |
| Total accuracy | 48.05% | 49.35% |

For the current settled production release (`cfb_market_sharp_aware_production_2026_09_19_r21_contained_spread_counter_signal`, 103 games), the published forecast also improved all six metrics: team-score MAE 8.5414 versus 9.3257, margin MAE 11.3306 versus 13.4169, total MAE 12.4553 versus 12.9355, winner accuracy 82.52% versus 77.67%, spread accuracy 57.33% versus 56.00%, and total accuracy 53.25% versus 50.65%.

Signal direction was not uniform. Explicit reverse-line movement was 18.75% on moneylines,
61.54% on spreads, and 42.86% on totals in the current release. Public money-versus-ticket
divergence was 66.67% on moneylines, 70.00% on spreads, and 44.83% on totals. These results do
not qualify a blanket reverse-line-movement feature.

The exact stored-component counterfactual removed public-total influence while leaving the
market anchor, sharp split input, same-book movement, weather, and mixture weight unchanged.
On 22 affected current-release games, retaining the incumbent public-total input produced
40.91% total direction accuracy versus 36.36% without it. Total MAE was essentially tied
(13.1970 incumbent versus 13.1893 candidate), and the four-game chronological confirmation
cohort tied on direction while the candidate improved total MAE by only 0.0671 points. This
does not qualify a production change.

Circa/Pinnacle price-trail outcome samples remain too small because historical continuity only
began with the r75 writer repair. They remain captured for forward evaluation and are not
promoted into prediction behavior by this audit.

## Decision

Keep the current CFB forecast marriage unchanged. Do not add blanket RLM, invert the public
total read, or remove public-total influence. Continue forward capture under the repaired
price-trail release and reevaluate only on release-pure, chronologically held-out evidence.
