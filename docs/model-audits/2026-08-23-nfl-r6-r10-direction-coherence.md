# NFL r6 value / r10 outcome direction coherence audit

Date: 2026-08-23

## Decision

Pass the predeclared structural coherence guard. An r6 exact-price moneyline candidate can be a
member-facing Lean only when its selected team is also the qualified r10 discrete joint PMF's
conditional winner. The guard does not change either probability head, a line, price, stake, or
T-60 boundary. It prevents a market-led action from contradicting the displayed score/winner
forecast while preserving every same-direction positive-EV candidate.

The 2024/25 data had been inspected in prior r6 research. These results therefore support a
coherence constraint, not a pristine new alpha claim.

## Exact historical reconstruction

All 1,906 source rows reconstructed exactly.

| Season | Policy | Actions | Record | Units | ROI | Mean normalized CLV | CLV+ |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2024 | r6 baseline | 115 | 74-41 | +14.179u | 12.33% | +0.291pp | 44.35% |
| 2024 | direction coherent | 72 | 54-18 | +16.080u | 22.33% | +0.482pp | 45.83% |
| 2025 | r6 baseline | 137 | 85-52 | +4.764u | 3.48% | +0.057pp | 37.96% |
| 2025 | direction coherent | 104 | 67-37 | +2.295u | 2.21% | +0.019pp | 36.54% |
| 2024-25 | r6 baseline | 252 | 159-93 | +18.944u | 7.52% | +0.164pp | 40.87% |
| 2024-25 | direction coherent | 176 | 121-55 | +18.375u | 10.44% | +0.209pp | 40.34% |

The guard removes 76 direction-conflicting actions. Both seasons remain profitable with positive
mean CLV; pooled units remain nearly unchanged while pooled ROI improves by 2.92 percentage
points. The 2025 reduction in units and ROI is retained as a limitation.

## Current authoritative Week 1 replay

Input: the SELECT-only r2 multi-book export captured at `2026-08-23T14:06:21.315Z`, 16 games,
five or more comparable books per game, all 32 expected quarterbacks matched and projected.

- before the guard: 10 moneyline Leans, 6 moneyline nonqualifiers;
- after the guard: 8 moneyline Leans, 8 moneyline No Plays;
- two candidate demotions: HOU moneyline (r10 projects BUF 24-23) and KC moneyline (r10 projects
  DEN 20-19);
- 8 applied member Lean promotions relative to the current 48-Held production reader;
- 40 remaining markets become truthful No Plays rather than Holds: 8 moneylines, 16 spreads,
  and 16 totals;
- zero Best Angles and zero stakes;
- every current Lean has positive expected value at its stamped r6 evaluated book/price;
- every No Play selected side and all spread/total forecast probabilities come from r10;
- projected-QB status remains visible refresh context and is not an automatic Hold;
- SharpAPI NFL splits remain unavailable and are never fabricated; Playbook is labeled public
  consensus only.

The release displays a supported representative score from the same discrete PMF that supplies
the outcome, spread, and total forecasts. The r6 moneyline value probability is labeled separately
where it grades a Lean. True data/identity/availability failures still fail closed as Held.
