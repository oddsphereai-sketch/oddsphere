# NFL Daily Edge professional market authority r29 result

Status: production candidate; publication requires protected-PR checks and explicit owner approval.

Date: 2026-10-09

Production base: `41cb2fc88d6c601d77a4932dbb1adcd1aaebfd93`.

Qualification record: `docs/model-audits/2026-10-09-nfl-professional-market-authority-r29-predeclaration.md`.

## Decision

Advance one target-excluded professional-market authority for future unlocked NFL Daily Edge computations.
The paid score remains the independent starting opinion, but qualified market evidence can materially move
the score, flip Spread or Total, and replace the outright winner when the separately qualified Moneyline and
Spread reads agree. One rebuilt joint distribution owns the final score, all three sides, probabilities, and
grades.

The 65-game and 18-game results below are opened retrospective evidence. They are useful for rejecting
known-bad interpretations and verifying deterministic behavior; they are not an untouched holdout or a
promised future hit rate.

## What the authority reads

The runtime retains same-book number movement, no-vig price movement, hold change, movement order,
persistence, reversal depth, buyback, key-number crossing, source class, split source/freshness, book
disagreement, resistance, and exact target-family exclusion. Circa and Pinnacle are the collected named
price books. A Circa SharpAPI split is named-book flow; DraftKings and BetMGM fallbacks remain retail flow.

The final rules are:

- Moneyline requires stable agreeing Circa and Pinnacle price movement. It can flip the winner only when
  qualified Spread authority agrees.
- Spread requires target-excluded same-direction number and price movement from at least two books plus
  aligned fresh qualifying money-minus-ticket flow. Opposing named flow vetoes.
- Total requires either two aligned named-book number moves, or five aligned stable target-excluded retail
  moves with no opposition, selected-book and all-book confirmation, and no reversal or buyback.

Absolute handle, ticket count, bet size, limits, originating market, and suspension/reopening lifecycle are
not captured and remain explicitly unavailable. They are not reconstructed from percentages.

## Why the side guard exists

The first integrated candidate treated agreeing number and price movement as sufficient Spread authority.
On ARI-NYG, that flipped the current r28 NYG Moneyline and Spread winners to Arizona and turned both winners
into losers. Arizona had no qualifying split evidence. PHI-CHI and ATL-NO, the two historical Spread
corrections, both had fresh aligned Circa money-minus-ticket flow. Requiring aligned flow blocks ARI-NYG
while retaining both supported corrections. This rejected intermediate version has no production path.

## Release-stratified 65-lock audit

The audit uses only evidence captured by each immutable lock. Each game is compared with the independent
and market release stored at that lock; releases are never blended and relabeled as current performance.

| Market | Historical projection | r29 candidate | Changes | Corrections | Harms |
|---|---:|---:|---:|---:|---:|
| Moneyline | 38-27 | 39-26 | 1 | 1 | 0 |
| Spread | 36-27-2 | 38-25-2 | 2 | 2 | 0 |
| Total | 32-32-1 | 36-28-1 | 4 | 4 | 0 |

The changed games are PHI-CHI Moneyline; PHI-CHI and ATL-NO Spread; and KC-MIA, TEN-NYG, HOU-IND,
and NE-BUF Total. All seven changes correct a loss and none harms a win. A final target-family-exclusion
review removed CAR-CLE from the qualified Total set because its broad confirmation depended on evidence
from the evaluated family. That result is intentionally not counted even though the removed change would
have been a historical correction.

| Score error | Historical | r29 candidate |
|---|---:|---:|
| Team-score MAE | 7.5999 | 7.5096 |
| Margin MAE | 10.0970 | 9.9467 |
| Total MAE | 10.9755 | 10.8666 |

The standalone professional signal covers 11 Moneylines at 7-4, two Spreads at 2-0, and 14 Totals at
10-4. Standalone Moneyline has three disagreement corrections and one harm, which is why it is not an
independent flip authority. Cross-market Moneyline/Spread agreement reduces the combined policy to one
Moneyline change, one correction, and zero harms. The qualified Total signal returns +5.1686 units at the
stored exact evaluated prices across its 14 observations. These small, selected development samples do not
establish a future expected return.

Weeks 1-2 contain market trails but predate stored two-named-book chronology and therefore cannot validate
named-sequence tactics. Weeks 3-5 contain 32 games with two named trails. No historical row contains absolute
handle, ticket count, bet size, limits, originating-market identity, or suspension lifecycle.

## Exact r28 comparison on the 18 paid-score locks

| Measure | r28 | r29 candidate |
|---|---:|---:|
| Moneyline projection | 11-7 | 11-7 |
| Spread projection | 12-5-1 | 12-5-1 |
| Total projection | 11-7 | 12-6 |
| Team-score MAE | 6.4020 | 6.4020 |
| Margin MAE | 8.0955 | 8.0955 |
| Total MAE | 10.0353 | 9.8787 |
| Moneyline decision Brier | 0.22827 | 0.22827 |
| Spread decision Brier | 0.22061 | 0.22061 |
| Total decision Brier | 0.26325 | 0.25892 |
| Moneyline actionables | 6 (4-2) | 6 (4-2) |
| Spread actionables | 5 (4-1) | 5 (4-1) |
| Total actionables | 12 (7-5) | 13 (8-5) |
| Complete actionable board | 23 | 24 |

Versus r28, NE-BUF changes from a losing Under Lean to a winning Over Lean. PIT-CLE stays Under but is
promoted from a losing Watchlist to a losing Best Angle. Promotions are one, demotions are zero, and the
board grows by one. There are no Moneyline or Spread changes versus r28. Upset calls remain four with three
correct across nine actual upsets: 75% precision and 33.3% recall. No claim is made that this recall is the
desired long-run endpoint; it simply does not regress in this release.

The separate zero-write Week 5 rehearsal uses current provider data for the 14 still-upcoming games and
produces 42 complete evaluations: 14 Best Angles, four Leans, 11 Watchlists, 13 No Plays, zero held games,
and 18 actionables. The stored live r27 snapshot for those same 14 upcoming games has the identical grade
counts. The rehearsal proposes 14 unlocked payloads and inserts zero rows. Because provider observations
are live rather than a frozen common input, this is an operational board/coverage proof, not an additional
performance comparison.

## Certification verdict and limitations

NFL r29 passes the candidate's direction, score-error, Brier, side-harm, board-count, cross-market coherence,
target-exclusion, and locked-reader gates on the available data. The audit and production both call
`buildNflProfessionalMarketAuthority`; there is no parallel scoring rule.

### Final pass / unverifiable matrix

| Requirement | Status | Evidence or boundary |
|---|---|---|
| NFL-specific research and market ontology | **Pass** | The NFL profile separates number, no-vig price, hold, timing, source class, key crossings, resistance, and related-market semantics. |
| Exact event/book/market/side/time provenance | **Pass** | All 65 locks have at least one honest trail in every market; 289 book-level trails are scored per market. |
| Named-book chronology | **Pass where captured** | Weeks 3-5 provide 32 games with two named trails; Weeks 1-2 predate that capture and are not backfilled. |
| Weeks 1-2 named-sequence behavior | **Unverifiable** | The needed two-named-book history was not stored. Those weeks contribute only to signal families their evidence can honestly support. |
| Splits and flow identity | **Pass where captured** | Moneyline/Spread/Total have 21/17/16 named-book split rows and 9/14/26 public-consensus rows. Percentages are never relabeled as dollars, counts, bet size, limits, or bettor identity. |
| Absolute handle, ticket count, bet size, limits, origin, suspension lifecycle | **Unverifiable / unavailable** | Providers do not supply these fields. Runtime marks them unavailable and gives them no authority. |
| Same-book number, price, hold, order, persistence, reversal, buyback, breadth, timing, magnitude, and key-crossing analysis | **Pass** | Each family is scored separately across retail/named class, timing and magnitude bins; the audit records 44/20/23 buybacks and 19/47/38 reversals at book-row level for Moneyline/Spread/Total, plus 68 Spread key-crossing rows. |
| Raw movement as a universal sharp signal | **Fail; correctly rejected** | Unfiltered movement is not consistently beneficial. Production does not follow it blindly and requires market-specific corroboration. |
| Target-family exclusion | **Pass** | Authority is constructed only inside the evaluated-family exclusion loop. CAR-CLE was removed from credited results when its broad confirmation depended on the target family. |
| Moneyline/Spread interaction | **Pass on available development evidence** | Standalone Moneyline has three corrections and one harm; requiring separately qualified Spread agreement reduces the applied policy to one correction and zero harms. |
| Total authority | **Pass on available development evidence** | Four applied corrections and zero harms across 65 locks; standalone qualified Total is 10-4 at +5.1686 exact-price units. The sample is small and selected. |
| Projection/pick/probability/grade coherence | **Pass** | One rebuilt joint distribution owns final score, all three sides, probabilities, and grades. |
| Release-pure independent/market interaction | **Pass** | All 65 games retain their historical independent release; 11 release eras are reported separately before aggregation. |
| Loss, upset, correction, harm, promotion, demotion, and conflict review | **Pass** | The audit contains 149 loss/conflict ledger rows and 20 joint Moneyline/Spread rows, plus every applied change. |
| Upset-awareness improvement | **Unverifiable** | On the exact 18-lock replay, upset precision/recall remain 75%/33.3%. R29 does not regress them, but this release does not prove a new upset edge. |
| Final-hour movement after the member lock | **Unavailable by product contract** | T-60 locks are immutable. Post-lock evidence is prohibited from changing a published forecast; r29 makes no claim that final-hour movement is predictive. |
| Pristine untouched forward hit rate | **Unverifiable** | The historical outcomes were opened during development. The figures reject bad rules and prove deterministic integration, not a guaranteed future rate. |
| Current-board utility | **Pass operationally** | Zero-write Week 5 produces all 42 evaluations, 18 actionables, and zero held games; the exact historical board moves 23 to 24 with one promotion and zero demotions. |
| Locked writer/reader immutability | **Pass** | r28/r27 snapshots retain exact stored payload and release identity; regression tests cover writer immutability and reader precedence. |
| One writer, sport lease, bounded load | **Pass** | The existing writer and `prediction_pipeline:nfl` lease remain authoritative; no new schedule, writer, or per-card call path is added. |
| Focused and full model safety | **Pass** | NFL production tests, TypeScript, scoped lint, and `npm run verify:model-change` pass; integration safety passes against current `origin/main`. |
| Protected PR and live runtime proof | **Pending** | The branch is pushed, but no PR has been submitted or merged. It is not live until required checks and post-deploy release/writer/reader/lock verification pass. |

The correct overall label is therefore **provisional professional production candidate**, not “proven
bulletproof winner.” It is professional in evidence identity, chronology, market interpretation, target
exclusion, coherent projection construction, and failure behavior. Its long-run predictive lift remains a
forward result that only future immutable locks can establish.

The product is not omniscient. It cannot read evidence the providers do not supply, and the current cohort
is too small and too opened to support a bulletproof accuracy guarantee. The professional standard therefore
requires the same missingness report, release-pure loss ledger, exact target exclusion, current-release
replay, board audit, and explicit pass/fail record for every later sport rather than copying NFL thresholds.

## Release and rollback

The r29 publication family is member/model/calibration/decision/grade
`r29/r26/r25/r31/r31`; weekly outcome/distribution/probability/representative score
`r14/r13/r13/r13`; market outcome/Spread/Total/target exclusion `r14/r14/r10/r12`; writer/fixture/snapshot
`r59/r41/r33`. The context capture remains the truthful r8 market-state schema and the sole writer retains
the shared `prediction_pipeline:nfl` lease.

Existing r28 and r27 locks retain exact stored payload and reader precedence. Rollback means reverting the
complete r29 family to r28 for future unlocked computations only. No locked row may be rewritten,
reconstructed, suppressed, or relabeled.
