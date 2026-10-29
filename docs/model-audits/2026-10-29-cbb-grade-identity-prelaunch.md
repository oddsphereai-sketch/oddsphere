# CBB private prelaunch: grade and team-identity audit (2026-10-29)

Scope: private candidate only. No member writer, lock, grade, stake, live Daily Edge route, or production activation is changed. Started from remote `main` `5d192fa9a99785c739e8443c55bffb7504af9710` after integrating it into the dedicated CBB worktree. Cached Ball Don't Lie data and ESPN's public men's CBB team catalog were used; the catalog capture made **zero paid Ball Don't Lie requests**.

## Team identity and product parity

- The 2026 schedule has 751 distinct participating BDL IDs, including 366 with a conference ID. Fifteen abbreviations collide among scheduled participants. Abbreviation-only matching is therefore unsafe for logos, odds, or stats.
- The new identity resolver binds a BDL team ID to a **unique exact canonical full-name** ESPN team ID, then accepts only an ESPN NCAA logo URL. It preserves the two source abbreviations separately (for example, Butler `BUT` in BDL versus `BTLR` in ESPN). Similar mascot, conference, or abbreviation cannot establish identity.
- Of 366 scheduled conference-ID teams, 359 have a verified ESPN catalog logo. Seven remain unresolved: Queens University, Lindenwood, Southern Indiana, New Orleans, St. Thomas-Minnesota, Centenary (LA), and Winston-Salem. These are explicit integration gaps, not silently mapped to other schools. The two November 1 private cards (four teams) do have exact verified logos.
- The private preview now carries team identity receipts and renders verified logos. The shared Daily Edge badge will use only a supplied CBB logo and otherwise the abbreviation disc; it cannot fall through to MLB's CDN. CBB is still prelaunch and not a member slate, so this is code readiness, not evidence of live UI parity. Member card layout, logo delivery, names, market rows, and locked-reader precedence still require CBB-specific end-to-end tests before activation.

## Per-market grade discrimination, not a new grade policy

`node --import tsx scripts/operator/audit-cbb-grade-readiness.ts` reads 353 already-opened historical fixtures, each with an exact target-book opening moneyline, spread, and total quote. It settles the forecast-selected side at its actual recorded price and reports W/L/push and flat one-unit returns by chronological block. The EV thirds are **descriptive within each block**; they are not thresholds or live Best Angle/Lean rules. No stake recommendation is made.

| Market | Early 151, highest EV third | Selection 162, highest EV third | Later 40, highest EV third | Implication |
| --- | ---: | ---: | ---: | --- |
| Moneyline | 33–18, +1.16u | 40–14, +11.19u | 9–5, −0.11u | Promising ranking, but late evidence is thin and not monotone enough to claim a calibrated grade. |
| Spread | 26–25, −1.48u | 35–19, +12.58u | 10–4, +5.00u | Later discrimination improves, but early failure prevents assuming stable Best Angle quality. |
| Total | 31–20, +8.06u | 25–29, −6.09u | 8–6, +1.26u | The strong-total grade hypothesis is unstable. Do not promote high modeled EV alone. |

All 353 were an opened development cohort, not a fresh untouched holdout. These figures are **not** expected live returns, and per-block sorting was not a pregame deployable policy. The audit identifies separate moneyline/spread/total grade-calibration questions while maintaining the single coherent forecast score. A qualified grade rule would need prospectively timestamped quotes, source/identity coverage, frozen release/lock separation, calibrated probabilities, price-band/odds checks, promoted and demoted board counts, and a later holdout. November 1 currently has zero verified named-book quotes on the two private cards; there can be no honest grade calibration for those cards yet.

## Verification and remaining launch gates

- `node --import tsx scripts/test-cbb-team-identity.ts` covers abbreviation collision, source abbreviation mismatch, similar-mascot false match, ambiguous ESPN names, and duplicate BDL IDs.
- `node --import tsx scripts/operator/preview-cbb-prelaunch.ts --candidate=r5 --date=2026-11-01` produces a private JSON/HTML preview with identity receipts and no publication.
- Team identity now prevents wrong-logo fallback; it does **not** solve all upstream team aliases in every odds/stat provider. Those sources require source-specific exact ID or independently corroborated event binding, plus a coverage audit before launch.
- Model accuracy targets, market-reader qualification, live price chronology, injury/roster validation, grades, member snapshot/lock parity, load/freshness and production release remain open. No claim that CBB is launch-ready or that the user's margin/total MAE targets were met.
