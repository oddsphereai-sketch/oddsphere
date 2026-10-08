# CFB complete market-reading audit — result

Status: SELECT-only research completed against retained 2026 pregame evidence. No production
prediction, score, probability, grade, stake, lock, tracking row, writer, cadence, provider hierarchy,
copy, label or layout changed.

## Bottom line

The current CFB release is not yet the complete independent-model-plus-market-reader product. It
captures useful same-book price/line history, public splits and named/fallback split evidence, but
most of the computed sharp, public and movement shifts do not reach the final score distribution.
The final PMF currently applies kickoff weather and the separately validated public-spread
arbitration. `adjustedAnchor`, combined sharp movement and Total movement remain descriptive rather
than authoritative score inputs.

Blindly wiring those captured signals into the score would make the product worse. The 2026
sequence replay rejected generic line following, generic price following, generic RLM, named-book
following, key crossings and simple two-book confirmation. None passed the frozen production gates.

## Evidence and controls

- 299 settled 2026 CFB games with official scores.
- 10,331 retained snapshots observed strictly before kickoff.
- 16,720 deduplicated game/candidate/market signal rows in the final tournament.
- Exact released target line used for authoritative-vs-counterfactual comparison. Source-book lines
  are used only to define the movement sequence.
- Circa, Pinnacle and Bookmaker evaluated separately from retail books.
- Named sharp splits, fallback money/ticket evidence and public consensus remain separate.
- Split absence is unknown. Freshness is measured relative to the corroborating move, not treated as
  neutral support.
- Development: through September 27. Confirmation: October 2–4. Holdout: October 7 and later.
- Every signal is deduplicated to one observation per game, market and fixed candidate.
- All database operations were reads. Historical provider caches were reused; this audit made zero
  additional provider requests.

## What a sharp reader was tested for

The tournament separately tested source identity and leadership, price-before-line sequences,
movement magnitude, moves first seen within six and two hours of kickoff, one-way holds, buyback,
Spread and Total key crossings, named-book agreement, named-to-retail leadership, public-ticket RLM,
money-before-move, move-before-money, contemporaneous splits, split freshness, money acceleration,
market resistance to splits and independent-model conflict strength.

This is intentionally not a generic cross-sport coefficient or a market-consensus anchor.

## Fixed-gate result

Zero candidates passed all frozen gates.

| Market pattern | Games | Candidate W-L | Authoritative W-L | Corrections-harms | Confirmation corrections-harms | Holdout evidence | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Moneyline, two retail books agree | 176 | 85-91 | 130-46 | 29-74 | 16-25 | 0-2 | Reject |
| Moneyline, two named books agree | 16 | 11-5 | 10-6 | 4-3 | 3-3 | none | Reject |
| Spread, named plus two retail line books agree | 51 | 30-21 | 27-24 | 15-12 | 13-9 | none | Prospective only |
| Spread, two named books agree | 35 | 19-15-1 | 19-15-1 | 10-10 | 7-8 | 1-0 | Reject |
| Total, two named books agree | 31 | 15-16 | 18-13 | 7-10 | 5-9 | 1-1 | Reject |
| Total, named plus two retail line books agree | 52 | 27-25 | 30-22 | 15-18 | 13-12 | 1-1 | Reject |
| Total, two retail line books agree against a strong independent opinion | 43 | 26-17 | 16-27 | 25-15 | 10-3 | no qualifying game | Prospective only |
| Total, held two-retail-line agreement against a strong independent opinion | 27 | 17-10 | 10-17 | 16-9 | 6-2 | no qualifying game | Prospective only |

The unrestricted strong-conflict Total row has a material correction advantage and improves
reflected Total error (14.51 to 12.68 points on disagreements), but its paired one-sided correction
test is 0.077 and eight of ten confirmation corrections occurred on October 3. Requiring every move
to hold leaves 16 corrections and nine harms (17-10 direction) with a 0.115 paired p-value; it is
neutral or worse on three of five represented dates. Adding a named sharp book to two retail books
leaves only two corrections and four harms. Adding current fallback money/ticket agreement produces
three corrections and four harms; current public agreement is one and one; no current named-sharp
split cell has usable coverage. No qualifying October 7 holdout game exists. These patterns remain
frozen prospective candidates, not production rules.

## Important rejected shortcuts

- Retail Moneyline RLM was especially harmful: the earlier exact-line audit produced 24-91 versus
  the authoritative 93-22 on the same population.
- Circa/Pinnacle movement was not automatically informative. Named Moneyline price movement,
  named Spread line movement and named Total line movement all failed stability or score-error
  gates.
- Two named books moving together did not create a safe automatic flip.
- Price pressure before a line move did not produce a stable cross-date advantage.
- Key-number crossings did not justify automatic promotion or reversal.
- Fallback splits sometimes formed encouraging small cells, but fallback provenance did not become
  Circa-quality evidence and no such rule passed the holdout gates.

## Research consistency

The result matches published evidence that college-football market movement can contain information
when it is unexplained by already-public inputs, while generic reverse-line and key-number rules do
not reliably create excess returns:

- [Informed trading in college football betting markets](https://ideas.repec.org/a/taf/apfiec/v15y2005i3p143-152.html)
- [Reverse line movement in college football totals](https://ideas.repec.org/a/spr/jecfin/v43y2019i4d10.1007_s12197-019-09479-3.html)
- [Weather and NCAA football totals](https://ideas.repec.org/a/taf/apeclt/v31y2024i8p779-782.html)
- [Joint spread and team-total censoring](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4197428)
- [Nonmonotonic market-sequence response](https://ideas.repec.org/a/inm/ormnsc/v70y2024i12p8583-8611.html)
- [Key-number demand discontinuities and returns](https://ideas.repec.org/a/eee/finlet/v104y2026ics154461232600721x.html)

## Production decision

Do not apply a generic market weight, capped cosmetic nudge, RLM flip, named-book flip or consensus
flip. Do not change CFB live grades or flatten the board from this result. Keep the active release
intact and evaluate the frozen strong-conflict Total rule prospectively after additional settled
dates. A future candidate must regenerate one coherent PMF so expected score, representative score,
Moneyline, Spread, Total and exact-price grading cannot contradict one another.

The audit remains reproducible with
`scripts/operator/audit-cfb-2026-sharp-sequence-tournament.ts`.
