# Cross-sport market-reading and CFB tracking audit

## Scope

This is a read-only audit of the active Daily Edge and player-prop market-reading contracts, plus
an exact reconciliation of the October 3, 2026 CFB tracking slate. It changes no prediction,
probability, projected score, side, grade, stake, provider cadence, member copy, label, layout,
lock, or tracking row.

The audit deliberately evaluates each sport's own released contract. A cross-sport market weight
would violate the product boundary: evidence that is predictive for one sport or market is not
assumed predictive for another.

## CFB tracking integrity

The committed SELECT-only audit is:

```bash
node --import tsx --env-file=.env.local \
  scripts/operator/audit-cfb-tracking-integrity.ts --date=2026-10-03
```

The production ledger reconciles exactly:

- 88 games and 264 records: 88 Moneyline, 88 Spread, and 88 Total.
- 264/264 records are resolved.
- Moneyline: 58-30.
- Spread: 48-38-2.
- Total: 48-40.
- Zero duplicate game/market keys, incomplete three-market games, missing locks, post-kickoff
  locks, missing grades, grade mismatches, or actual-score mismatches.
- The member tracking aggregate independently returns the same 264 rows and 154-108-2 combined
  record. The release mix (r36/r37/r38) is expected immutable-lock history rather than blended
  model evaluation.

## CFB market-reading replay

`audit-cfb-sharp-market-reading.ts` now reads the same bounded authoritative evidence set used by
the sole writer instead of attempting to download the entire season of multi-megabyte JSON
payloads. The audit compares each captured signal with both the football-only forecast and the
published authoritative forecast, and reports direction corrections, harms, and score-axis MAE.

The current captured sample does not support a broad new score or side rule:

- Circa movement was 8-14 on Moneyline, 26-27-1 on Spread, and 23-27-1 on Total.
- Circa reverse-line movement was encouraging only on Spread (14-9-1), but a full coherent
  boundary-reflection flip worsened margin MAE from 13.02 to 13.70 on disagreements.
- Circa Moneyline RLM corrected both published disagreements, but the sample is only two games.
- Circa Total RLM was 6-14 and worsened Total MAE on disagreements.
- Pinnacle Spread movement had only five published disagreements; its favorable 3-2 direction and
  MAE result is too small to authorize production behavior.
- DraftKings fallback and public split directions did not show stable improvement over the
  published forecast.

The released CFB behavior therefore remains the evidence-backed boundary: the independent joint
score distribution stays authoritative, the validated Spread arbitration and weather behavior
remain active, and market/sharp evidence can affect exact-price confidence and actionability.
The broader captured sharp-book trails remain audit evidence until a release-pure sample improves
both side accuracy and coherent score error. Activating the current broad candidates would be an
accuracy regression, not a repair.

The next CFB member slate was also checked after rollover: 86 games / 258 market slots, current
r39/r17/r27 authority, 86/86 open cards, a snapshot under three minutes old, and twelve consecutive
successful refresh logs. All 86 games have outcome forecasts. The 31 FCS-only games without posted
Spread/Total markets remain truthful line-specific holds; one FBS game (ODU at APP) also had no
posted market yet. No line or price is synthesized.

## Other active model contracts

- NFL Daily Edge r23 uses paid independent inputs plus verified same-book movement for real,
  reversible Spread/Total corrections; splits remain source-separated context. Its exact forward
  replay moved Moneyline 32-15 to 33-14 and Total 24-23 to 28-19 while Spread remained 27-18.
- NHL r12 removed the continuous market anchor. It flips a winner only when a multi-book current
  price, at least a one-point same-book probability move, and medium/high-confidence money/ticket
  evidence corroborate the opposite side. In 29 settled active-family games, the final Moneyline
  was 17-12 versus 16-13 independently; the sole qualified flip won. Totals were 11-17-1 versus
  10-18-1 independently, so a more aggressive Total rule is not authorized.
- MLB full-game uses target-excluded source breadth. On the current board, ATL at LAD had enough
  independent sharp and retail families for the released market-aware Moneyline context; SD at MIL
  and the ATL-LAD Total correctly stood down where breadth was insufficient.
- WNBA uses target-excluded market vectors with two independent source families. No current natural
  slate was available for a fresh result claim; historical captures had complete paired evidence
  and no singleton family was treated as confirmation.
- EPL r19 retains one coherent Dixon-Coles PMF, a validated draw selector, and only permits a Total
  tilt from at least two fresh, distinct, target-excluded exact-2.5 source families with unanimous
  direction. The exact 30-game forward replay improved Match Result from 11-19 to 13-17 and
  actionables from 2-5 to 4-1.
- UCL r6 keeps market vectors downstream of the forecast because the frozen historical price
  coverage could not validate a UCL-specific market correction. Current readiness is healthy at
  18/18 fixtures, zero incoherent games, and zero nonpositive-EV actionables; 21 missing-price
  markets truthfully remain held. This limitation is explicit rather than silently presented as
  a market-adjusted score.
- NFL player props currently expose 1,764 member rows with zero projection/side contradictions.
  The workload posterior uses target-book-excluded evidence; exact price remains downstream.
- MLB player props r43 currently have 361 rows, 213 target-excluded references, 22 opening-movement
  rows, 51 coherent related-market movement rows, and zero supplied exact prop-split rows. Four
  rows are actionable and none has a projection/side contradiction. Raw contradictory offers are
  non-actionable by the released integrity gate.

## Decision

No production prediction rule is changed by this audit. The available evidence supports the active
sport-specific contracts and rejects blanket split-following, blanket movement-following, and a
cross-sport market anchor. The audit tooling is repaired so future evidence can be evaluated on the
actual authoritative payload set and yesterday-style tracking concerns can be reconciled exactly
without provider calls or writes.
