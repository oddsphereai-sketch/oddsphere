# WNBA professional market evidence v1.7 — predeclaration

Date: 2026-10-09  
Starting production base: `c323a37dfff94258355e32c763160b9f0175b40b`  
Status: candidate only; not live until owner approval, protected PR publication,
and post-deploy proof

## Product objective

Keep the WNBA independent model and the market reader as two identifiable
pieces of one coherent decision. The independent score is the starting opinion.
Fresh complete same-book prices, target-book exclusion, originator/source-family
breadth, Moneyline/Spread agreement, and an actual winner or quoted-spread
decision-boundary crossing determine when the market may move or flip that score.
One final distribution must own the projected score, Moneyline side, Spread side,
probabilities, and grades. Totals remain owned by the independent Total head.

Public money/ticket splits and line movement are evidence, not labels that are
automatically synonymous with professional money. Their production authority
depends on provenance, observation time, same-line identity, chronology, and
corroboration. Missing evidence is neutral. Existing immutable locks are never
reinterpreted under a newer reader.

## Outside evidence used

- The WNBA efficiency study found evidence inconsistent with perfect market
  efficiency, but its public betting strategies were not statistically
  profitable and ticket/dollar percentages were highly correlated. That supports
  treating split gaps as context rather than automatic sharp-side authority:
  <https://www.mdpi.com/2227-7072/2/2/193>.
- Research on professional basketball closing-line movement found that movement
  improved forecast accuracy on average and interpreted it as informed-trader
  influence. It supports preserving chronological line/price sequences, not
  blindly following every endpoint: <https://onlinelibrary.wiley.com/doi/pdf/10.1111/0022-1082.155346>.
- An older NBA totals study found market movement was generally in the correct
  direction but did not fully remove early-season bias. It reinforces bounded,
  sport-specific interpretation rather than a universal steam rule:
  <https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID2149603_code1886702.pdf?abstractid=2149603&mirid=1>.

## Incumbent strengths retained

The candidate retains the complete v1.6 forecast path:

- evaluated sportsbook and line fixed from the independent forecast, then
  excluded from forecast evidence;
- fresh, complete, paired, same-book quotes only, with 15-minute maximum age and
  30-second pair skew;
- at least two alternative books from two conservatively independent source
  families for market authority;
- Circa, Pinnacle, and Bookmaker as distinct originators, while unverified
  non-originator SharpAPI books share one correlated family;
- Moneyline/Spread contradiction causes an exact independent fallback;
- qualified market center affects the forecast only when it crosses the
  independent winner or the exact evaluated Spread boundary;
- a crossing regenerates the projected margin, Moneyline probability, Spread
  probability, and both decimal team scores coherently;
- evaluated price affects break-even economics and grade, never forecast side;
- no split requirement, so the complete model works when Playbook is absent.

The expanded 44-game forward replay changed seven projections. Relative to the
independent score, the retained crossing rule produced five directional
corrections and two harms, improved winner accuracy from 34/44 to 35/44,
improved non-push Spread accuracy from 26/43 to 28/43, and reduced margin MAE
from 11.2214 to 11.1653. This is historical evidence, not a promised hit rate.

## Gaps found

1. The authoritative writer read `line_history` without pagination. A server cap
   could silently discard the opening and middle of the same-book sequence.
2. The writer hard-coded `sourceAwareSplitRows: []` even though the append-only
   source-aware archive existed.
3. `sharp_signals` omitted `computed_at`, so the frozen evidence could not prove
   when its public split was computed.
4. Generic cross-sport split thresholds could alter WNBA grade strength or block
   a promotion even though row-level provider lineage and source observation time
   were absent.
5. The active-release operator audit was hard-coded to v1.5 rather than the
   machine registry.
6. WNBA injury news is still not an input to the incumbent independent model.
   That is explicitly retained as unavailable evidence here; this market-reader
   release must not guess an injury from price action or silently change the
   independent model.

## Complete loss and counterfactual review

The season audit covered 217 settled games and 651 Moneyline/Spread/Total
records, with 96,148 source-aware split observations. Zero observations carried
a verified provider source timestamp.

Blindly flipping the selected side whenever its money percentage trailed its
ticket percentage failed:

| Market | Covered decisions | Flips | Corrections | Harms | Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| Moneyline | 213 | 67 | 20 | 47 | -27 |
| Spread | 189 | 107 | 48 | 59 | -11 |
| Total | 179 | 96 | 52 | 44 | +8 |

The Total result repeated at +4 in each chronological block, but the actionable
subset was 5 corrections and 7 harms (-2). The apparent all-board result is
therefore not permission to flip or promote a bet, especially with zero verified
source timestamps. The actionable Spread subset was only 15 observations and
did not retain a meaningful late confirmation sample. No money/ticket flip,
threshold, or weight is promoted.

Across the 46-game forward-capture cohort, the incumbent generic split helper
changed four grade-strength labels: two settled winners and two settled losses.
All four remained actionable, so it added no actionable coverage and provided no
predictive separation. The candidate restores the exact pre-split grade and
retains the observed support/conflict only as audit context.

The fully paginated movement reconstruction loaded 18,006 rows for the 44-game
forward cohort. Only the latest two settled games had repeated same-book captures
sufficient to reconstruct movement. Blind movement following would have opposed
both winning Moneyline picks; Spread and Total were mixed. This rejects a
movement-only override while justifying complete sequence capture for future
qualified research.

## Candidate behavior

- Model: `wnba_v1_7_professional_market_evidence`
- Distribution: unchanged
  `wnba_coherent_normal_2026_10_06_v8_independent_first_decision_crossing`
- Grade policy:
  `wnba_grade_policy_v12_provenance_qualified_market_context_2026_10_09`
- Reader:
  `wnba_daily_edge_reader_2026_10_09_r2_provenance_qualified_market_context`
- Split context:
  `wnba_public_market_context_v1_provenance_qualified_observation_only_2026_10_09`

The writer now paginates all relevant `line_history`, freezes `is_opener`, joins
the canonical WNBA source-aware split archive, and freezes public-signal
`computed_at`. Split observations expose both the observed support/conflict and
the reason they lack production authority. They cannot change a side, score,
probability, grade, promotion, demotion, or stake. The validated line/price
crossing reader remains fully active and can still move or flip the projected
score when its evidence contract qualifies.

## Board and lock impact

At rehearsal time there were no WNBA games more than 60 minutes from start, so
the zero-write natural writer correctly had zero eligible rows and zero errors.
The two current games were already locked under v1.6 and remain untouched.

On the settled forward split cohort, v12 would restore four Lean labels to their
pre-split Best Angle strength (two winners, two losses), with zero side,
probability, projected-score, stake, or actionable-count changes. Structural
tests prove that missing splits and extreme unverified split values are
prediction-neutral. No board quota or forced recommendation is introduced.

## Required publication gates

Before merge:

1. Run the focused WNBA core, target-excluded market-decision, forward-evidence,
   public-context, prediction-record, reader, tracking, and promotion tests.
2. Run `npm run verify:model-change`.
3. Rehearse the next eligible WNBA slate with zero writes and report exact side,
   score, probability, grade, promotion, demotion, and actionable counts.
4. Prove every current locked payload is byte-identical.
5. Refresh latest `origin/main`, integrate if needed, and pass
   `scripts/verify-integration-safety.mjs` from a clean committed worktree.
6. Publish only through a protected PR.

After merge, verify the deployed commit; v1.7/v12/r2 release tuple; the sole WNBA
writer and `prediction_pipeline` lease; cron health; complete line-history and
source-aware capture telemetry; member score/prediction coherence; board counts;
and unchanged v1.6 locks.

## Rollback

For future unlocked computations, roll the complete v1.7/v12/r2 family back to
v1.6/v11/r1 if pagination truncates, source rows cross event or decision-time
boundaries, the board unexpectedly flattens, a score contradicts Moneyline or
Spread, mixed releases appear, the sole writer/lease fails, or any locked row
changes. Never rewrite or relabel an existing lock during rollback.
