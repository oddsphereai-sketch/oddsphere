# NFL sharp market-reading adapter

Status: active-release audit contract; r27 remains production, October 9 replacement candidates rejected.

Runtime conformance audit:
`docs/model-audits/2026-10-09-nfl-sharp-market-reading-implementation-audit.md`.

Date: 2026-10-09

Shared contract: `docs/sharp-market-reading-standard.md`.

This defines what “reading the NFL market correctly” means for NFL Daily Edge. It is not a generic
football weight and does not authorize changes to CFB, NBA, CBB, props, or any other model.

## 1. Eligible markets and settlement scope

The reader covers regulation/full-game Moneyline, Spread, and Total for the exact NFL event. Each quote
retains sportsbook, side, line, American price, observation time, and market family. Moneyline and Spread
share a margin distribution but remain separate decisions; Total owns the scoring-total axis.

Spread and Total selection uses the released push-aware distribution contract. Any audit probability must
state whether it includes push mass or normalizes over non-push outcomes. Exact no-vig comparison requires
both sides at the same line from one book; a line-aware modeled translation remains derived evidence and
cannot be relabeled as an observed two-sided price.

## 2. Evaluation and lock times

Unlocked projections may refresh from evidence available at evaluation time. The public record freezes
at the existing T-60 boundary. No post-lock or final-hour observation can rewrite a locked prediction,
probability, score, grade, price, or evidence payload. Final-hour movement is neither assumed helpful nor
harmful; it is outside this product's prediction boundary and may be studied only as a separate diagnostic.

The active payload preserves observation and evaluation times, but the next implementation audit must
also report provider-to-receipt latency, clock skew, duplicate observations, polling gaps, and the exact
last observation actually received before T-60. An earlier provider timestamp cannot rescue evidence that
arrived after lock.

## 3. Source hierarchy and target exclusion

- The paid NFL team-score projection is the independent starting opinion.
- Circa, Pinnacle, and Bookmaker observations are named/reference-book evidence, not interchangeable
  aliases. A book earns extra authority only through the qualified sequence rule.
- Later retail followers can corroborate a named lead.
- Playbook supplies lower-authority public multi-book lines and money/ticket splits.
- Named sharp splits remain source-specific and cannot be relabeled as consensus.
- The sportsbook whose exact quote is evaluated is excluded from the comparison consensus for that
  market family. Moneyline and Spread exclusion is margin-axis scoped; Total exclusion is Total scoped.
- At least three fresh target-free families are required for the current consensus anchor.

The active three-family count is raw sportsbook breadth, not yet an empirically estimated effective-
independence count. The next audit must identify operator families, shared feeds, consistent leaders and
followers, stale books, and copied moves so correlated books cannot overstate consensus strength. Circa,
Pinnacle, and Bookmaker authority must be re-earned by current NFL market/lead-time performance rather
than assumed permanently from reputation.

## 4. Line, price, key-number, persistence, reversal, and buyback

The implementation must keep four concepts separate:

1. same-book line movement: one sportsbook's chronological opening/prior/current number trail;
2. opening-to-consensus displacement: an operational opening compared with a later target-excluded
   multi-book consensus;
3. same-number price movement: price change while the line is unchanged; and
4. current no-vig price lean: a current belief estimate, not evidence of who moved first.

The active Spread rule was historically validated on opening-to-market displacement plus a price-only
flat lane, but its field naming currently conflates displacement with movement. That is a documented gap.
The current material-number threshold is 0.5 points. NFL key-number crossing, persistence duration,
reversal size, and buyback are not yet independently calibrated by number bucket; a replacement must
predeclare them rather than inventing extra authority. The 0.5-point value is an active-release rule, not
a claim that 0.49 contains no information and 0.50 contains full information. A replacement must compare
a continuous/tapered movement feature with discrete alternatives and publish every changed decision near
the boundary.

Time-to-kickoff is available, but the active reader does not possess verified sportsbook limit/liquidity
history and therefore cannot label a move high-limit or professional on that basis. The next sequence
study must align verified injury/designation, quarterback, weather, roster, and other material news times
with the quote trail. A move before news, a reaction after news, and buyback after news are separate states;
news already consumed by the paid score cannot be counted again as independent market corroboration.

## 5. Split sources, identity, freshness, and signed relationships

Money-minus-ticket divergence is computed only from a complete complementary pair with preserved source,
market, side, observation time, and line match where applicable. Fresh Playbook gaps require at least eight
percentage points for their existing lower-authority roles; named sharp gaps require at least ten. The
audit evidence is too sparse and unstable for either raw split family to originate a universal direction:
only four of the exact 18 settled games have complete named sharp split sets. Splits remain corroboration,
veto, or context unless a sport/market chronological study qualifies more. Eight and ten percentage
points are eligibility conventions in the active release, not cliffs in presumed bettor skill. The next
split study must test continuous signed gaps and neighborhoods around both values; a 9.9-point named gap
must not be treated as categorically unrelated to a 10.0-point gap without demonstrated outcome evidence.

The current feeds provide percentage shares, not verified absolute handle, ticket counts, individual bet
sizes, or incremental arrival velocity. NFL may therefore interpret relative money-versus-ticket shape but
cannot truthfully claim that a particular dollar amount, a whale bet, or unusually large total volume
arrived. Those fields require a provider that actually supplies them and their own NFL validation.

## 6. Evidence tiers, conflicts, and vetoes

- Tier 0: missing, stale, or mismatched evidence; preserve the independent forecast.
- Tier 1: isolated same-book move, displacement, current price lean, or one split family; only its already
  validated bounded role is allowed.
- Tier 2: genuinely independent agreement, such as movement plus line-matched splits, or selected-book
  movement plus target-excluded consensus.
- Tier 3: at least two named books move unanimously without buyback and three later retail followers or
  qualifying source-specific flow confirm; opposing fresh sharp flow vetoes.

Named-sequence authority has precedence over weaker direction inputs. Conflicting evidence is resistance
or conflict; missing evidence is unavailable, not agreement. Derived versions of one quote do not count
as independent corroboration. The two-book and three-follower requirements establish whether the strong
lead/follow claim is supportable; they do not assign maximum weight automatically. Leader quality,
agreement, move size, follower count, elapsed time, persistence, and buyback remain graded features.

## 7. Cross-market mapping

Spread evidence may change cover direction or compress/expand the projected margin without automatically
changing the winner. A winner flip requires Moneyline-specific corroboration: the existing gate uses a
same-book Moneyline no-vig move of at least one percentage point plus qualifying public or named sharp
flow, with a sharp veto, or matching qualified Moneyline and Spread named sequences. Total evidence moves
the scoring-total axis and both team scores without choosing a winner. On short spreads, Moneyline and
Spread are audited together for upset evidence and margin-versus-winner disagreement. The one-percentage-
point value is an active gate, not proof of a predictive discontinuity. A replacement should allow
independent sub-threshold Moneyline, Spread, sequence, and split evidence to combine through a calibrated
joint strength while preventing multiple derivatives of the same quote from being double-counted.

## 8. Marriage with the independent model

Every refresh starts from the immutable paid independent away/home score. Market evidence may confirm,
resist, correct, or flip it only through a qualified NFL lane. It may make a large score change when the
evidence tier validates that behavior; there is no universal small-adjustment cap. The adjustment is
rebuilt from the independent base on every refresh and never recursively compounds.

The runtime does not directly pass a line, price, book, consensus, movement, or split into the internal
paid-score marriage as an NFL market-reader feature. Because the upstream paid projection is third-party,
its methodology still needs a lineage statement before “independent” can mean proven market-free rather
than operationally source-separated. If upstream market inputs exist, the audit must estimate that
dependence and prevent the downstream reader from counting the same market belief twice.

The preferred replacement method is continuous: estimate market-evidence strength with uncertainty,
combine it once with the independent distribution, and let the final coherent probability cross the
winner, Spread, or Total boundary naturally. A flip at 50.1% is a real low-confidence side change, not a
Best Angle by definition. A 49.9% result remains the other low-confidence side. Grade and exact-price
value decide whether either is a wager. Evidence authority controls how much the distribution may move;
it should not create an arbitrary second winner-flip cliff.

The October 9 audit rejected a proposed blanket confidence replacement and a 1.5-point same-winner cap.
Those rules improved some opened metrics but flattened the live board. They are not active behavior.

## 9. Score/probability reconstruction and coherence

One final joint distribution owns expected team scores, representative score, outright winner, Spread,
Total, and their probabilities. Market-created directions must eventually receive confidence from a
chronologically calibrated signal model, not by borrowing the independent confidence from the opposite
side. The active reflection rule remains only because its larger 2021-2025 Spread evidence has not been
beaten by a replacement that also preserves coverage. Score/pick/probability contradictions fail closed.

## 10. Exact-price actionability and grades

Prediction and wager remain distinct. The final joint probability is compared with the exact offered line
and price after target exclusion. Existing EV, edge, reliability, cushion, and NFL grade rules remain
authoritative. A market-confirmed forecast is not automatically a good bet after the price moves; a lagging
quote may be a good bet even when consensus moved. Missing exact-price evidence may hold a grade but cannot
erase an otherwise valid prediction.

## 11. Upset-awareness definition and metrics

An upset is a win by the team that was the frozen target-excluded market underdog at evaluation. Every
audit reports actual upsets, predicted upsets, catches, misses, false calls, precision, recall, actionable
underdogs, and underdog wins. It also identifies whether the independent model or market integration
created the call. The October 9 opened diagnostic improved catches from one of nine to three of nine, but
failed Spread and board gates; it therefore does not qualify for production.

## 12. Historical evidence

The active opening-to-market Spread direction rule cleared 2021-2023 selection at 413-374 (52.48%) and
2024-2025 chronological confirmation at 281-257 (52.23%). The analogous Total rule failed selection and
was not promoted. The r27 named-sequence evidence is encouraging but small. October 9 adds an exact
18-game paid-score diagnostic and a current 15-game board replay; both are opened evidence and cannot
supersede the larger chronological result by themselves.

Future reports must preserve every tested variant, not only the winner, and compare independent-only,
market-only, active marriage, and candidate marriage on identical rows. Uncertainty must be paired and
clustered by game/week/season; Moneyline, Spread, and Total from one game are not three independent
samples. Component ablations, covered-versus-missing evidence, source/time-to-start slices, and placebo
timestamp/source/direction tests are required before attributing improvement to a specific signal.

## 13. Current-board impact and coverage gate

The active current replay begins with 19 actionables: seven Moneyline, five Spread, and seven Total. The
October 9 candidates reduced that to two and took Total to zero; the final round produced one promotion,
25 grade demotions, and a net loss of 17 actionables. Every candidate is rejected. Future candidates must
report grade counts by market, promotions, demotions, retained actionables, side changes, and data-missing
holds. Board size is not a quota, but a rule that removes more than half of actionables or zeros an active
market is presumptively unacceptable absent explicit owner approval and overwhelming evidence.

## 14. Releases, writer, locks, and rollback

Production remains the r27 named-sequence family recorded in `docs/current-model-releases.md`, with sole
writer `nfl_forward_evidence_writer_2026_10_08_r57_named_sequence`, context capture
`nfl_daily_edge_forward_context_capture_2026_10_08_r7_named_sequence`, fixture
`nfl_weekly_member_fixture_2026_10_08_r39_named_sequence`, and compact snapshot
`nfl_forward_member_snapshot_2026_10_08_r31_named_sequence`. It retains the single
`prediction_pipeline:nfl` lease. Locked payloads take exact reader precedence and are never recomputed.
The October 9 r28 identifiers were rejected research identifiers and are not transition fallbacks.

A future NFL release must predeclare operational monitoring for evidence age/coverage, effective source
count, interpretation-state mix, score/probability shifts, flips, promotions/demotions, per-market board
coverage, and settled calibration. A provider methodology change, after-lock receipt used pre-lock,
target leakage, mixed-book movement, coherence failure, or missing-evidence market collapse is a stop and
rollback condition for future unlocked decisions; locked r27 records remain unchanged.

## Completion gaps

NFL is not yet “bulletproof.” The active reader has meaningful validated components, but these gaps remain:

- split and relabel same-book movement versus opening-to-consensus displacement in stored diagnostics;
- prove paid-score information lineage and measure effective sportsbook independence;
- measure provider-to-receipt latency, clock skew, and missing-not-at-random evidence coverage;
- calibrate probability strength for contrary market-created sides without blanket compression;
- enlarge release-pure split and named-sequence samples;
- validate NFL key-number, persistence, reversal, and buyback buckets;
- align market sequences with verified news and time-to-kickoff regimes without inventing unobserved limits;
- replace unvalidated predictive cliffs with continuous/tapered strength or prove their discontinuities
  through below/above boundary ledgers and chronological confirmation;
- build a qualified Total confirmation/correction lane without eliminating Total actionability;
- define numerical post-release monitoring bands and rollback triggers; and
- rerun loss and matched-win ledgers, calibration, upset, exact-price, and current-board gates on every
  candidate.

Until then, “sharp” means source-aware, chronological, target-excluded, coherent, and empirically bounded.
It does not mean automatically following a move, a money/ticket gap, or a so-called sharp book.
