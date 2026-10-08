# NFL Daily Edge named-market sequence audit and r27 candidate

Status: implementation and verification candidate; publication requires explicit owner approval.

Date: 2026-10-08

## Scope and invariant

This audit is limited to NFL Daily Edge Moneyline, Spread, Total, their shared expected score,
the target-excluded decision resolver, the sole NFL forward writer, and the compact member reader.
It does not change NFL Player Props, stakes, member copy, labels, layout, provider budgets, cadence,
the `prediction_pipeline:nfl` lease, lock timing, settlement, or any stored locked payload.

The product invariant is one coherent result: the independent score and qualified market evidence
may jointly move the expected score, flip a Spread or Total, and in sufficiently corroborated cases
replace the outright winner. The expected score, representative score, probability distributions,
market sides, and exact-price decisions must always derive from that same final joint distribution.

## External market-reading basis

The implementation follows five findings from the literature rather than treating "market" as one
generic weight:

1. Closing NFL prices contain information beyond opening prices, but bettor sentiment can still
   create exploitable distortions. See Miller and Rapach (2013),
   <https://doi.org/10.1016/j.jempfin.2013.07.002>.
2. Money, ticket share, and bookmaker response interact non-monotonically; a large money-minus-ticket
   gap is not a universal instruction to follow or fade. See Shank (2022),
   <https://doi.org/10.1016/j.jbef.2022.100758>.
3. Sportsbooks need not merely balance action and may price into predictable bettor bias. See
   Levitt (2004), <https://doi.org/10.1111/j.1468-0297.2004.00207.x>.
4. Book-level disagreement matters; treating every sportsbook quote as one homogeneous consensus
   discards information about individual bookmaker efficiency. See Franck, Verbeek, and Nüesch
   (2020), <https://doi.org/10.1016/j.frl.2019.09.006>.
5. Informed trading can be expressed through the timing and persistence of price changes, not just
   the final line. Related evidence in basketball markets appears in Paul and Weinbach (2013),
   <https://doi.org/10.1016/j.jeconbus.2013.04.002>.

These findings support a chronological, source-aware evidence gate. They do not support blindly
averaging the independent score toward the current market or blindly fading public tickets.

## Audited evidence

- 64 settled 2026 NFL games and 192 original locked market records from Weeks 1-4 were inventoried.
- All 64 games had current odds, an operational opening, Playbook splits, contextual evidence, and
  a median of six comparable books.
- Paid independent team scores existed for 18 settled games. Exact SharpAPI split coverage remained
  sparse in that cohort.
- Named Circa/Pinnacle chronology was usable for 31 of 32 Weeks 3-4 games. Weeks 1-2 do not contain
  the same named-book history, so they cannot validate the sequence rule.
- Correction records were excluded from the original-record denominator. Mixed historical model
  releases were not described as current-release performance.

## Genuine shortcomings found

1. **Captured chronology was not consumed.** The writer stored named-book opening/current families
   with `productionDecisionEffect: false`. Production mostly read one selected same-book move, so it
   could not distinguish a sharp lead followed by retail from simultaneous consensus or late noise.
2. **Authority was mostly fixed rather than corroboration-dependent.** Public and named sharp splits
   could move the score, but the production path did not escalate or suppress authority based on the
   number and identity of confirming price sources.
3. **Buyback and conflict were not first-class sequence gates.** The existing selected-book reader
   handled direction, but named-book reversal, persistence, source disagreement, and opposing fresh
   split flow were not jointly evaluated before a multi-book signal could own direction.
4. **Outright-winner authorization omitted named lead-follow evidence.** R28 correctly required
   Moneyline-specific support before a Spread correction could cross zero, but two independently
   qualified Moneyline and Spread sequences could not authorize that same coherent winner change.
5. **Total chronology is under-validated.** The small sequence sample was 2-1 and never disagreed
   with the released Total. That is insufficient evidence for a new Total override; the candidate
   explicitly leaves Total sequence authority disabled.
6. **Money-ticket gaps are useful context but unsafe alone.** In Weeks 3-4, the generic public gap
   was 0-4 on Moneyline, 3-3 on Spread, and 6-5 on Total. The candidate retains current bounded score
   effects but does not elevate a standalone public gap into sequence authority.

## Rejected approaches

- Blanket all-book consensus was unstable: Moneyline 9-10, Spread 10-11-1, Total 15-7.
- Blanket named-book consensus was also too broad: Moneyline 9-6, Spread 8-6, Total 11-6.
- Three fixed blends that pulled the independent score toward the current market lost correct sides,
  reduced upset recall, and demoted actionables. Market authority is therefore event-driven, not a
  continuous slider.
- Removing public split score effects improved some error measures but violated the product goal and
  removed a winning Moneyline/Spread correction. Public splits remain active within their released,
  bounded role.

## Candidate rule

For Moneyline or Spread, named sequence authority is available only when:

1. at least two of Circa, Pinnacle, and Bookmaker move at least 1 fair-probability point on Moneyline
   or 0.5 points on Spread;
2. every moved named book agrees on direction;
3. the named move persists for at least two-thirds of its material observations and never reverses;
4. confirmation comes from either three later retail followers, a fresh exact-line Playbook
   money-minus-ticket gap, or fresh named sharp flow in the same direction; and
5. no fresh qualifying public or named sharp split opposes the move.

Three retail followers are required because the eventual evaluated sportsbook is not known until
the target-exclusion loop settles. Removing any one possible target family still leaves two followers.
Named sharp books are capture-only and cannot own the evaluated member quote. Missing or stale
evidence is neutral.

A qualified Spread sequence can move the projected margin across the listed Spread. It cannot cross
zero unless a separately qualified Moneyline sequence supports the same winner. Opposing fresh named
flow remains a winner-flip veto. The final margin and unchanged independent Total rebuild one joint
distribution; no side is patched after score generation.

## Results

### 32-game Weeks 3-4 signal audit

- Release gate: Moneyline 1-0, Spread 3-2, Total disabled.
- The five qualified Spread signals disagreed with the released authoritative Spread once. That one
  disagreement was a correction; harms were zero.
- The broader two-follower research signal was 3-0 on Moneyline and 4-2 on Spread, but the release
  gate deliberately sacrifices coverage for target-exclusion safety and conflict handling.

### Exact 18-game paid-score replay

| Metric | Current | Candidate |
|---|---:|---:|
| Projection Moneyline | 11-6-1 | 11-6-1 |
| Projection Spread | 11-6-1 | 12-5-1 |
| Projection Total | 11-7 | 11-7 |
| Team-score MAE | 7.46786 | 7.38367 |
| Margin MAE | 7.81942 | 7.65104 |
| Total MAE | 12.25756 | 12.25756 |
| Spread actionables | 5 (4-1) | 5 (4-1) |
| Promotions / demotions | 0 / 0 | 0 / 0 |

The only changed forecast is PHI at CHI. Current production projected Philadelphia 23.038 to
Chicago 18.035 (Philadelphia by 5.003). Circa and Pinnacle moved persistently toward Chicago and
fresh named sharp flow confirmed the Spread, while opposing Moneyline flow blocked an outright-winner
change. The candidate projects Philadelphia 21.522 to Chicago 19.550 (Philadelphia by 1.972), which
preserves Philadelphia Moneyline, flips the Spread to Chicago, and preserves the 41.072 Total.
Chicago won 27-7. The stored spread decision was absent for incomplete exact-price evidence, so no
historical grade or wager is retroactively invented.

Upset metrics remain 75% precision and 33.3% recall, with four actionable underdogs going 3-1. The
candidate does not claim an upset improvement from this sample; it preserves the R28 winner safeguards
and merely adds a stricter prospective authorization path.

### Current Week 5 no-write comparison

Forced-refresh no-write runs of the recorded r56 baseline and r57 candidate each produced 14 games,
42 evaluated markets, 14 Best Angles, 4 Leans, 11 Watchlists, 13 No Plays, and zero held games. Thus
the current-board impact is zero promotions, zero demotions, and no actionable-count change. Both runs
made zero database inserts and no member publication or tracking write. The candidate's ordinary
release-refresh run also proved the prospective sequence construction can complete from live inputs.

## Release and rollback

Candidate release family:

- sequence `nfl_named_market_sequence_2026_10_08_r1_strict_lead_follow`
- member/model/calibration/decision `r27/r24/r23/r29_named_sequence`
- weekly outcome/distribution/probability `r12/r11/r11_named_sequence`
- market outcome/Spread/target exclusion `r12/r12/r10_named_sequence`
- writer/context/fixture/snapshot `r57/r7/r39/r31_named_sequence`

R26/R28/R38/R30 remains the immediate availability and immutable-lock predecessor. Existing locked
rows must render their exact stored payload first and are never recomputed under r27. Roll back or
hold before publication on a mixed release, failed sequence provenance, source reversal treated as
confirmation, unexpected Total change, Moneyline flip without separately qualified Moneyline and
Spread evidence, opposing fresh sharp evidence bypass, actionable-board collapse, lease overlap,
writer failure, reader failure, or any lock mutation.

## Known limit

The useful named-book history covers only two complete settled weeks, and the exact paid-score cohort
contains 18 games. This is enough to reject broad weighting and identify one clean missing sequence correction;
it is not enough to claim a durable edge or activate the Total path. Results must continue to be
reported by immutable release and locked timestamp after any approved publication.
