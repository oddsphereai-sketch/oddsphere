# CBB full-level diagnostic result

Private research only. This is not a production release, predictive qualification,
or authority to transfer archived retail-opening weights to current professional
books. The one predeclared real-cohort fit was run once. No provider request,
database write, production shadow or locked-record change occurred.

Protocol commit: `a0bfc973dd34a47b69bbd16867b338bc331d64f2`.
Dataset SHA256: `47adb0ee1eb2a9010891ecacd29e269b77e9b4e5a0a7d76b990d1bfd201f5c64`.
Method SHA256: `bd9a8dea557c5035ea607f3f03113054f621c69550a611fa2042467e3b02ab59`.
Operator SHA256: `b51eb1340c9d6b07c06d40ff73ca4a115b951ecac19a0a22a30d6bb158e933c3`.
Local full report: `/private/tmp/oddsphere-cbb-market-level-stack-report-20261102.json`.
Local compact report: `/private/tmp/oddsphere-cbb-market-level-stack-summary-20261102.json`.

## Frozen result

Chronological training433, availability-qualified calibration369, later
evaluation199. Calibration uses177 head-applicable cases. In the later block,
125 games have applicable identified patterns;74 retain the exact independent
forecast. All1070 input rows are reported, including clock exclusions and
unsupported patterns. Eighteen source patterns fit; one remains unidentified.

| Later metric | Independent | Level stack |
| --- | ---: | ---: |
| Moneyline wins | 132 | 132 |
| Spread wins | 114 | 119 |
| Total wins | 102 | 105 |
| Margin MAE | 9.34506 | 9.37527 |
| Margin RMSE | 12.12935 | 12.02864 |
| Total MAE | 13.22951 | 13.19304 |
| Total RMSE | 16.62161 | 16.61532 |
| Moneyline log loss | .55837092 | .55677312 |
| Spread log loss | .68508157 | .68710496 |
| Total log loss | .69018289 | .68833018 |

Spread probability quality worsened despite five additional correct picks.
The independent-mean matched-calibration control has Spread log loss .684974,
also better than the candidate. Therefore this failure is not explained solely
by the change of residual calibration. Moneyline and Total probability metrics
improved in this opened retrospective sample; they are not untouched validation.

Thirteen of nineteen source patterns contain four or fewer training games.
The largest74-game DraftKings pattern assigns margin weights .2583434136 to
independent/.7416565864 to its own Spread and Total weights0/1. These are
constrained empirical optima, not bookmaker reliability estimates, and cannot
be renamed Circa or applied to a different missing-source pattern.

## Independent verification and disposition

Independent external AI review checked all19 KKT fits,1000 synthetic two-expert
analytic comparisons, all1070 score identities and exact W/L/P, probability and
EV arithmetic. The declaration pin, finite covariance guard and complete row
reporting were repaired before the controlled fit. Both synthetic suites pass.
There is no remaining identified numerical implementation defect in this
diagnostic. There is also no grade/stake qualification or November current-book
scope. The artifact stays offline; it is not wired into the member writer.
