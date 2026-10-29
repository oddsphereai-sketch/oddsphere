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

All 353 were an opened development cohort, not a fresh untouched holdout. These figures are **not** expected live returns, and per-block sorting was not a pregame deployable policy. The audit identifies separate moneyline/spread/total grade-calibration questions while maintaining the single coherent forecast score. A qualified grade rule would need prospectively timestamped quotes, source/identity coverage, frozen release/lock separation, calibrated probabilities, price-band/odds checks, promoted and demoted board counts, and a later holdout.

## Follow-up grade investigation on October 29

The first preview reused an October 28 market cache, so it correctly rejected every stale current quote and showed zero verified named-book prices. A fresh, read-only Owls capture restored **12** verified quote pairs for Notre Dame–Villanova and **3** for Liberty–High Point, across the three standard markets. The Owls split response was fresh but returned zero games with `status=partial`, so split coverage remains a separate gap. The private current-market capture command now automatically refreshes a cache older than 15 minutes; it does not silently reuse yesterday's snapshot. These refreshed prices are evidence for the preview, not calibrated grades or an accuracy claim.

The expanded audit distinguishes **directional confidence** from **price-adjusted value**, which need not map to the same grade:

| Market-specific question | Early block | Selection block | Later block | Readout |
| --- | ---: | ---: | ---: | --- |
| Moneyline: highest model-confidence third | 42–9, −2.87u | 49–5, +4.07u | 12–2, −0.23u | High win rate can support a directional Lean concept, but steep prices can erase the value; not automatically a Best Angle. |
| Spread: early-fixed high-EV cut | 26–25, −1.48u | 34–16, +14.67u | 14–5, +7.62u | More encouraging grade discrimination, still not uniformly positive across time. |
| Total: early-fixed high-EV cut with market side agreement | 21–10, +8.91u | 8–7, +0.19u | 5–4, +0.49u | Filtering adverse market context helped the weak selection block but is not a robust Total Best Angle rule. |

The early-fixed cuts were derived from the *distribution of predicted EV*, not outcomes, and then applied unchanged to later blocks. They are diagnostic candidate tests, not deployed thresholds. In a separate, overlapping **635-game Total-only** cohort across eight dates, the same high-EV/market-agreement idea went 9–9 (−0.91u) on the first two dates, 21–14 (+4.96u) on the next four, and 0–2 (−2.00u) on the last two. The final block is tiny because only 13 eligible games remained. This reinforces that totals need further calibration rather than a forced grade.

The intended grade architecture is market-specific: Moneyline Leans may reflect validated winner confidence while Best Angles also need defensible price economics; Spread and Total grades need their own correctness and exact-line evidence. Market agreement is context, not an automatic veto or automatic promotion. Every market must be capable of producing Leans and Best Angles when evidence supports them, but a grade is not required for each market on every individual slate. A representative forward board-count audit must show the system does not hide most plausible plays in Watchlist/No Play.

To test the board-flattening risk directly, the private audit also applies an **explicitly unapproved simple grade probe**. It uses positive model EV and a reasonable moneyline price for a Moneyline Best Angle; for Spread/Total, an early-distribution high-EV cut plus same-market reference agreement. A provisional Lean is weaker economic evidence or high directional confidence. This is a falsification baseline, **not** the proposed final grading technology. It fails: Moneyline produced **zero Leans** across all 353 games at the tested price/confidence combination; Spread Leans went 6–14 (−8.75u) early and 12–15 (−4.43u) in selection. Total Leans were 15–16 (−2.62u) early and 4–6 (−2.38u) later. The probe can populate a board, but it does not reliably promote the right plays. Merely relaxing a threshold would recreate the user's concern and is rejected.

Next calibration work must therefore train and assess the **Lean and Best Angle lanes separately by market**, with Moneyline directional win reliability distinct from price-adjusted value; Spread/Total exact-line and market-context reliability; explicit odds bands; and forward W/L/push, units and board-count reports. A private grade candidate is not a live grade or stake. Forced one-per-market-per-day promotion is also invalid: it would create a claim of confidence that the evidence may not support.

## Verification and remaining launch gates

- `node --import tsx scripts/test-cbb-team-identity.ts` covers abbreviation collision, source abbreviation mismatch, similar-mascot false match, ambiguous ESPN names, and duplicate BDL IDs.
- `node --import tsx scripts/operator/preview-cbb-prelaunch.ts --candidate=r5 --date=2026-11-01` produces a private JSON/HTML preview with identity receipts and no publication.
- Team identity now prevents wrong-logo fallback; it does **not** solve all upstream team aliases in every odds/stat provider. Those sources require source-specific exact ID or independently corroborated event binding, plus a coverage audit before launch.
- Model accuracy targets, market-reader qualification, live price chronology, injury/roster validation, grades, member snapshot/lock parity, load/freshness and production release remain open. No claim that CBB is launch-ready or that the user's margin/total MAE targets were met.
