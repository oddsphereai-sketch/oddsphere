# CFB coherent market-evidence candidate result

Date: 2026-09-01
Starting production base: `3c114e3c0b696cdafbbd831f3fef8d2746a0a507`
Integrated protected-main base: `5fb5b7d4f61730e40405f8b6b31667f4369f3843` (tree `4d78efc03e68d3b20b3ca60490517bbba60f8468`)
Candidate production forecast: `cfb_market_sharp_aware_production_2026_09_01_r13_coherent_movement`
Candidate decision: `cfb_v1_daily_edge_decision_2026_09_01_r26_coherent_movement_evidence`
Status: standalone CFB source and registry candidate integrated on the protected FI base; protected PR, deployment, and live verification remain pending

## Current-board replay

The read-only replay used the production evidence store at `2026-09-01T12:00:00.000Z`, made zero writes, and evaluated the authoritative weekly window from 2026-09-03 through 2026-09-07.

| Measure | Current release | Candidate | Change |
| --- | ---: | ---: | ---: |
| Comparable markets | 209 | 209 | 0 |
| Best Angle | 23 | 22 | -1 |
| Lean | 38 | 43 | +5 |
| Watchlist | 101 | 95 | -6 |
| No Play | 47 | 49 | +2 |
| Actionable | 61 | 65 | +4 |

The transition contains four promotions, three demotions, and one side change. It is not a flatter board.

Candidate actionable counts by market are Moneyline 6, Spread 20, and Total 39. The complete candidate grade distribution is:

| Market | Best Angle | Lean | Watchlist | No Play |
| --- | ---: | ---: | ---: | ---: |
| Moneyline | 1 | 5 | 14 | 36 |
| Spread | 4 | 16 | 52 | 4 |
| Total | 17 | 22 | 29 | 9 |

## Forecast and evidence impact

- All 87 FBS-involved games had a usable canonical market anchor; 209 markets were comparable.
- Forty-two games changed projected score. The maximum absolute expected team-score change was 0.2951 points, retaining natural decimal precision.
- The maximum absolute market-probability change was 1.5189 percentage points.
- Three evaluated quotes changed; 201 complete side/grade/quote tuples were unchanged.
- Public evidence classified 7 markets as support, 2 as resistance, 174 as neutral, and 26 as unknown. Unknown evidence remained neutral.
- Public split forecasts were available for 86 games but produced a nonzero point shift in only 7, demonstrating that availability alone does not manufacture an adjustment.
- The only side change was a weak WYO/CSU spread crossing; it finished `No Play` with negative exact-price economics, so it did not manufacture an actionable pick.
- One spread promotion carried supportive same-book movement. Other promotions and demotions flowed through the coherent PMF and the existing exact-price grade rules.

## Candidate verification

- CFB market/sharp-aware PMF coherence and balanced promotion/demotion tests passed.
- CFB production contract, exact-price decision, generalized weekly engine, Playbook identity, kickoff weather, SharpAPI odds/splits, and market-informed outcome tests passed.
- A read-only current-board replay reproduced the counts above with zero writes.
- The full model-change gate, TypeScript compilation, production webpack build, and latest-main integration-safety gate passed from the final committed candidate tree.

## Integration and remaining publication gates

The standalone candidate is based on the exact FI merge and changes only the CFB registry section, leaving the merged MLB, player-props, and first-inning registry text intact. Publish only through an up-to-date protected PR; if main advances, integrate it and rerun every affected gate. After merge, verify the production commit, deployed release identifiers, writer and lease health, natural unlocked refresh, immutable T-60 behavior, tracking records, and the signed-in Daily Edge reader.
