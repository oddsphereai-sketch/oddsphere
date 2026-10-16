# NFL player props provider-family availability

Date: 2026-10-16

Audit instant: `2026-10-16T10:55:03.355Z`

Season/week: 2026 regular season Week 7

Mode: bounded read-only collection; no persistence

## Family-by-family result

The schedule endpoint returned 14 games. The existing collector made 29 BALLDONTLIE calls and 18 SharpAPI calls, including the already-existing conditional Pinnacle/NoVig reference lane. No normalized in-slate prop observation was returned by any lane.

| Research family | BALLDONTLIE retail observations | Sharp generic observations | Sharp Pinnacle/NoVig reference observations | Exact complete offers | Archive rows | Availability conclusion at audit instant |
|---|---:|---:|---:|---:|---:|---|
| Passing Touchdowns | 0 | 0 | 0 | 0 | 0 | Not observed; provider supply unproven |
| Longest Pass | 0 | 0 | 0 | 0 | 0 | Not observed; provider supply unproven |
| Longest Reception | 0 | 0 | 0 | 0 | 0 | Not observed; provider supply unproven |
| Longest Rush | 0 | 0 | 0 | 0 | 0 | Not observed; provider supply unproven |
| Field Goals Made | 0 | 0 | 0 | 0 | 0 | Not observed; provider supply unproven |
| Kicking Points | 0 | 0 | 0 | 0 | 0 | Not observed; provider supply unproven |

## Interpretation

This is a timestamped availability failure, not evidence that each provider never carries these families. BALLDONTLIE reported an empty player-props board at the audit instant. Sharp's generic catalog reached its bounded page ceiling before yielding an in-slate offer, while the explicitly requested Pinnacle/NoVig reference lane also yielded no normalized in-slate rows.

Therefore:

- no family has passed a live exact-price completeness gate;
- no family may be exposed to members;
- zero rows is the correct fail-closed archive behavior; and
- the next provider cycle that returns observations must be audited family by family for books, alternate lines, both side prices, provider timestamps, and opening/current identity before supply is called adequate.

The internal archive changes evidence retention only. It does not force the reference lane, increase provider budgets, or infer absent prices.
