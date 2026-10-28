# NFL player props Anytime TD opportunity repair result

Date: 2026-10-15
Decision: reject unchanged; TD-opportunity features do not clear the frozen gates

## Historical result

The candidate added shifted player scoring, red-zone, and goal-line opportunity plus team scoring
and opponent touchdown allowance to the fixed market-independent allocation ensemble.

| Phase | Model | Brier | Log loss | AUC | Calibration error |
| --- | --- | ---: | ---: | ---: | ---: |
| 2024 selection | Fixed independent ensemble | 0.073056 | **0.238165** | **0.864300** | 0.008112 |
| 2024 selection | Opportunity repair | **0.072999** | 0.238176 | 0.864070 | **0.008070** |
| 2025 confirmation | Fixed independent ensemble | 0.072230 | 0.237939 | 0.857856 | 0.005041 |
| 2025 confirmation | Opportunity repair | **0.071948** | **0.236873** | **0.859879** | **0.004503** |

The candidate fails the predeclared 2024 selection gate because log loss and AUC are slightly
worse. Its 2025 gains are directionally encouraging in all four chronological segments, but the
game-clustered Brier-delta interval is `[-0.000583, +0.000017]`, crossing zero. It therefore also
fails the confirmation stability gate.

## Immutable Week 5 external check

The already-open 45-row board rejects the candidate more clearly:

| Model | Brier | Log loss | AUC | Calibration error |
| --- | ---: | ---: | ---: | ---: |
| Fixed independent ensemble | **0.108720** | **0.329791** | **0.959893** | 0.143912 |
| Opportunity repair | 0.130488 | 0.387703 | 0.925134 | **0.140870** |

The candidate's independent positive-EV set went 3-13 for `-5.3u`, and its top 10 expected-value
and no-vig-edge ranks went 0-10 (`-10u`) and 1-9 (`-7u`). The fixed independent foundation's
corresponding no-vig top 10 went 4-6 for `+0.4190u`. Explicit scoring-zone history therefore adds
historical signal but transports poorly to this current-season board and damages player ordering.

## Decision

Reject unchanged. Keep the fixed market-independent team-budget/allocation ensemble as the TD
research foundation, keep production TD actionability disabled, and keep market price/movement as
a separately labeled reader. Do not promote raw posted-price EV until a genuinely forward sample
validates its longshot ordering.

No production probability, grade, stake, writer, lease, or locked record changed. Board impact:
zero.
