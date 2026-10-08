# CFB complete market-reading audit — result

Status: SELECT-only research against retained 2026 pregame evidence. The initial discrete-signal
tournament is complete and a continuous market-reader candidate remains under release-gate review. No production
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

## Continuous evidence follow-up

The failed discrete rules were not the end of the audit. A second, CFB-specific architecture now
models the probability that the evidence-supported counterfactual will be closer than the released
forecast. It uses the independent forecast, source-separated same-book line and paired-price paths,
named-versus-retail disagreement, reversals, timing, and named/fallback/public split provenance and
acceleration. It does not target the market center and does not use a generic cross-sport weight.

The best audited candidate treats the three markets differently:

- Moneyline and Spread use a heavily regularized continuous margin correction only when a real
  movement sequence, reversal or split observation exists. The independent forecast remains
  primary; confirmation, resistance and a true side crossing are distinct outcomes. A crossing is
  allowed to flip the prediction, while same-side evidence may still improve the score axis.
- Total keeps the released score axis unless the continuous evidence posterior crosses the current
  Total side. A qualifying cross reflects the full score conviction to the other side instead of
  producing a cosmetic nudge or a line-hugging score.
- The final home and away scores are derived once from the final margin and Total, so the displayed
  score, Moneyline, Spread and Total cannot be assembled from contradictory axes.

The configuration was selected on games through September 27, then frozen before the October 2–4
confirmation block. The first continuous version changed Moneyline once (one correction, zero
harms), Spread once (one correction, zero harms), and Total four times (three corrections, one
harm). Exact intervention review then found that the harmful Total flip had no observed line move,
price move, reversal or split evidence; it was using static disagreement with the posted line as
if it were market reading. Every corrected Total flip had an actual sequence, split observation or
both. A structural authority rule now prevents a static line alone from overturning the independent
Total. This is an evidence-presence contract, not a movement-size threshold.

With that rule, the earlier September 25–27 block remains four Total corrections and zero harms.
The October 2–4 block becomes three Total corrections and zero harms: Total moves from 35-32 to
38-29, while Total MAE improves from 14.1662 to 13.6603. Moneyline remains 61-33 to 62-32 and Spread
37-28-1 to 38-27-1; margin MAE improves from 13.1208 to 12.9144. The three-game October 7 micro-holdout
has no directional changes; margin MAE improves from 9.0211 to 8.9522. Because the evidence-authority
rule was discovered during exact confirmation review, those improved October figures are opened
diagnostic evidence, not a newly untouched holdout.

A four-way comparison rejected the idea that the version making the fewest changes must be best.
Evidence-gated continuous margin adjustment improves margin and team-score MAE in development,
confirmation and the October 7 micro-holdout while preserving the directional gains. Continuous
Total adjustment is rejected: its October confirmation Total MAE worsens from 14.1662 to 15.0976
and one score-axis change reaches 52.7 points. The winning architecture is therefore continuous
evidence-conditioned margin plus evidence-backed, side-crossing Total correction.

An exact official-lock integrity comparison was also run separately. It improved confirmation
Moneyline 61-33 to 63-31 and Total 34-30 to 36-28, left Spread 33-30-1 unchanged, and improved all
three score-error measures. Those later records are not used to select or inflate the candidate.

A deliberately harsher date-by-date refit exposed an important failure mode: retraining after every
small slate can chase the immediately preceding results. Across 216 date-forward games, the candidate
improves Spread from 70-58-3 to 71-57-3 and Total from 72-65 to 79-58, while reducing margin MAE
12.4221 to 12.3019 and team-score MAE 9.3259 to 9.2480. But a refit after only four October 2 games
made the October 3 Total interventions one correction and four harms. That behavior is rejected.
The artifact must be release-frozen through the complete weekly slate and may be retrained only in
a newly identified, release-separated cycle.

Evidence regimes are not interchangeable. In the confirmation block, released Moneyline picks won
24-14 when the continuous evidence confirmed them and 36-17 when it resisted them; blanket
resistance demotion or reversal would therefore be wrong. Total resistance was less trustworthy
(12-15), while actual Total side-crossings finished 3-1 versus 1-3 for the released sides. This is
why confirmation, resistance and correction remain market-specific inputs rather than one threshold.

Grade-conditioned evidence makes the distinction sharper. In the October confirmation block,
Moneyline Best Angles that resisted the evidence went 3-5 for -2.813 units, while resistance-level
Watchlists went 16-1 for +1.496 units. The latter are mostly price-sensitive winner calls, so their
high hit rate is not permission to erase the existing price-tier ceiling. Spread Leans remained
positive both when confirmed (7-4, +2.542 units) and when resistant (17-13, +2.826 units), so a
generic Spread resistance demotion would discard useful independent-model decisions. Total Best
Angles with resistance went 0-3 for -3 units, while confirmed Total Leans went 4-2 for +1.704 units.
Those cells identify a real calibration concern, but the small counts do not by themselves authorize
a production demotion. Any demotion still requires a paired, exact-price promotion replay.

The current 86-game board was replayed inside the sole writer from its exact in-memory PMF, with zero
writes. All 86 baseline games reproduce the existing grades, prices and probabilities within the
strict audit tolerance. The candidate has no negative scores, adjusts the margin axis in 84 games,
and classifies evidence across the whole board rather than only changed cards: Moneyline contains
44 confirmation and 41 resistance regimes; Spread contains 28 confirmation and 26 resistance
regimes; Total contains 19 confirmation, 30 resistance and five raw crossing regimes. Four Totals
cross the final side: WAKE-NCSU, SC-FLA, MISS-VAN and UGA-ALA. The fresh exact replay has zero
Moneyline flips and zero Spread flips.

Best Angle counts remain unchanged. One Spread Lean becomes Watchlist, one Spread No Play becomes
Watchlist, and one Total Watchlist becomes No Play. Best Angle plus Lean count moves from 92 to 91;
there is no hidden board flattening beyond the one Spread Lean demotion. Two Total Best Angles and
one Total Lean retain their grades while changing sides.

Missing splits are not an automatic No Play. The exact board contains three actionable Spreads and
six actionable Totals without eligible split evidence; no Spread No Play and only one Total No Play
lack splits, and no grade reason code treats missing splits as resistance. The larger apparent No Play
block is 32 Held games. Removing only the canonical-anchor global hold recovers zero exact-price
decisions: 30-31 of those markets still lack two target-excluded books at the identical line, while
one or two lack a target quote. This is a target-excluded consensus coverage limitation, not a split
gate. The independent side and projected score remain available, but an exact-price Lean is not
manufactured without a defensible market denominator.

This candidate is not live. The October 7 holdout contains only three games and the evidence-authority
rule is outcome-informed diagnostic work. The exact replay satisfies coherence and board-shape gates,
but it does not create a new untouched performance sample. Under the model-change safety contract,
the candidate remains audit-only until an owner-approved provisional exception or release-separated
forward evidence authorizes a new model release.

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
- [The degree of inefficiency in football betting markets](https://www.sciencedirect.com/science/article/pii/0304405X9190034H)
- [Reverse line movement in college football totals](https://ideas.repec.org/a/spr/jecfin/v43y2019i4d10.1007_s12197-019-09479-3.html)
- [Weather and NCAA football totals](https://ideas.repec.org/a/taf/apeclt/v31y2024i8p779-782.html)
- [Joint spread and team-total censoring](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4197428)
- [Nonmonotonic market-sequence response](https://ideas.repec.org/a/inm/ormnsc/v70y2024i12p8583-8611.html)
- [Key-number demand discontinuities and returns](https://ideas.repec.org/a/eee/finlet/v104y2026ics154461232600721x.html)

## Production decision

Do not apply a generic market weight, capped cosmetic nudge, RLM flip, named-book flip or consensus
flip. The best audited candidate is the evidence-gated continuous margin reader paired with the
evidence-backed Total side-correction reader. It must be frozen for the full slate and regenerate one
coherent PMF so expected score, representative score, Moneyline, Spread, Total and exact-price grades
cannot contradict one another. Keep the active release intact until the provisional-release gate is
explicitly satisfied.

The audit remains reproducible with
`scripts/operator/audit-cfb-2026-sharp-sequence-tournament.ts`.
