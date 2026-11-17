# NFL sharp market-reading implementation audit

Status: implementation audit complete; no model change authorized.

Date: 2026-10-09

Production family audited: NFL Daily Edge r27 named-sequence release.

Shared contract: `docs/sharp-market-reading-standard.md`.

NFL contract: `docs/model-audits/2026-10-09-nfl-sharp-market-reading-adapter.md`.

## Decision

The current commit is an audit-and-governance commit, not an NFL model fix. It is suitable to publish as
the durable specification and evidence record only after that scope is understood. Approval of this
commit does **not** mean the NFL reader is complete, change any live prediction, or authorize a later CFB
implementation.

Do not describe NFL as a complete or bulletproof sharp-market reader yet. The active release is a real,
sport-specific market integration and the best currently qualified production option, but important
interpretation states and calibration work remain missing. The three October 9 replacement attempts were
correctly rejected; publishing one would have weakened Spread results or flattened the current board.

## What is actually proven now

The read-only active-r27 replay over the exact 18 settled stored games that have the paid independent score
shows the named-sequence market marriage at 11-7 Moneyline projections, 12-5-1 Spread projections, and 11-7 Total
projections. The corresponding evaluated decisions are 11-6 Moneyline, 11-4-2 Spread, and 10-7 Total.
It catches three of nine market-defined upsets with one false upset call. The independent-only ablation is
10-8 Moneyline, 5-12-1 Spread, and 9-9 Total projections, with two of nine upsets caught and one false
call. This is evidence that the NFL market reader adds useful information, especially on Spread, not
evidence that every component or threshold is correct.

The audit tool's variant named `current` is the immediate pre-named-sequence behavior; its Spread
projection is 11-6-1. The active r27 path is the tool's `namedSequenceOverride` variant. On these rows the
named sequence corrects one additional Spread projection (Philadelphia-Chicago) without changing its
selected exact-price decision. This naming distinction is documented here so a predecessor replay is not
misreported as active production.

The same replay is small, opened, and release-limited. Only four of the 18 paid-score games have a
complete named sharp split set. It cannot estimate narrow uncertainty or validate every interaction.
Across all 65 settled locked games, the stored releases are heterogeneous: only 18 have the paid score,
24 have any complete SharpAPI split set, and named Circa/Pinnacle chronology was not available in the
early releases. Results from those 65 rows cannot be blended and called r27 performance.

## Runtime conformance matrix

| NFL reading function | What r27 actually does | Status | Consequence |
| --- | --- | --- | --- |
| Independent opinion | Starts the active cohort from the paid away/home score and rebuilds every refresh from that base. | Implemented; lineage unverified | The downstream path is source-separated, but the paid provider has not established that its model is market-free. |
| Target-excluded consensus | Iteratively excludes the exact evaluated Moneyline/Spread family from the margin axis and the evaluated Total family from the Total axis; requires three fresh families and uses medians. | Implemented | Prevents direct target leakage, but raw logo count can overstate independent information and all retained books currently receive equal authority. |
| Exact current number and price | Preserves exact book, line, price, side, and observation time; grades against the executable quote and a leave-one-out same-line fair price. | Implemented | Prediction and wager value are properly separated. Simultaneous availability and receipt latency still require stronger proof. |
| Opening and quote lifecycle | Preserves `provider_opening` versus `first_observed` provenance and carries an operational opening forward. | Partial | It does not identify a market-wide opener, suspension/reopening, rejected/non-bettable quotes, max stake, or provider correction as separate lifecycle states. |
| True same-book movement | A strict same-book opening/current reader calculates line and no-vig price deltas and applies a bounded shift. | Partial | It is unavailable when the operational opening and retained current family differ or target exclusion removes the current family. It also averages number and price effects rather than modeling them separately. |
| Opening-to-consensus displacement | Compares the operational opening with a later synthetic target-excluded consensus for Spread direction. | Implemented but mislabeled/heuristic | This is not same-book movement. A half-point displacement can orient the Spread even when no named sequence qualifies. |
| Same-number price movement | No-vig price change is calculated, but the runtime does not isolate a stable-line price trail from a number move. | Missing as a distinct signal | It cannot separately learn whether juice pressure preceded a number change, stalled at a number, or reversed. |
| Hold/vig and side shading | Two-sided no-vig probability is calculated at snapshots. | Partial | Changes in total hold or asymmetric shading are not stored as their own time-series features, so raw price behavior cannot be fully attributed to fair-belief movement. |
| Current price lean | When Spread displacement is under 0.5, current target-excluded fair price chooses the direction. | Implemented but not separately calibrated | A snapshot belief can orient the score without proving who moved first or whether the signal persisted. |
| Public money/ticket gap | Fresh Playbook gaps are line-matched for Spread/Total, require eight percentage points for qualification, and receive a capped lower-authority shift. | Partial | Provider methodology and denominator are not stored; a gap is not proof of professional money. At exactly eight points the score shift is zero even though the sequence reader treats the split as qualifying corroboration. |
| Named sharp money/ticket gap | The forecast shift accepts only fresh Circa flow and requires ten points. The named-sequence path accepts the selected SharpAPI split without rechecking that its source is Circa. | Partial, sparse, and partly mislabeled | SharpAPI may fall back to DraftKings or BetMGM; a fallback can corroborate or veto a sequence even though the audit language calls it named sharp flow. The split payload has no associated market line, so exact-line matching cannot be proven. At exactly ten points the score shift is zero while sequence corroboration qualifies. |
| Absolute money and bet arrival | Current split payloads retain percentages only. | Not available | The reader cannot know actual dollars, ticket counts, bet sizes, incremental inflow, or arrival velocity and must not describe percentage shares as a known amount of money. |
| Named lead/follow sequence | Requires at least two agreeing named books, no observed opposing move, at least two-thirds persistence, and either three followers or a qualifying split. Enabled for Moneyline and Spread. | Implemented; small evidence and timing gap | Only Circa and Pinnacle are currently fetched for named price chronology; Bookmaker is listed in authority code but not collected. A retail follower need only occur after the earliest named move, not after both named books have moved, so the label can overstate strict two-leader chronology. |
| Steam speed and synchronization | Retains timestamps and the first named move. | Partial | It does not model seconds/minutes between leaders, follower lag, velocity, move magnitude, or price-before-number escalation. |
| Persistence, reversal, buyback | Rejects a named trail with any opposing moved observation and requires two-thirds directional persistence. | Partial | Persistence is observation-count based rather than time-weighted; buyback magnitude, duration, return to the opener, and late re-break are not separate states. |
| Resistance / reverse-line movement | Conflicting fresh evidence can veto a named sequence, and no-move split studies exist outside runtime. | Not implemented as an explicit state | The reader does not identify heavy handle with no move, a move against handle, book-specific resistance, or whether the book changed price instead of number. This is the clearest missing sharp-reading concept raised by the owner. |
| Book authority | Circa/Pinnacle can participate in named authority; current retail books can follow. | Partially implemented | Authority is reputation-plus-rule based, not learned by NFL market, lead time, or season. Limits and liquidity are unavailable and must not be inferred. |
| Moneyline/Spread interaction | A winner change needs Moneyline-specific price plus qualifying split support, a matching Moneyline/Spread named sequence, and no opposing sharp veto. | Implemented | Short-spread upset logic is genuinely cross-market. Sub-threshold independent evidence cannot combine continuously, and correlated derivatives can still be hard to distinguish. |
| Originating versus derivative market | Cross-market agreement is evaluated after observations arrive. | Missing | The runtime does not establish whether Moneyline, Spread, Total, alternate lines, exchanges, or related props originated a move, so mechanical follower repricing can look like corroboration. |
| Total interaction | Same-book Total movement can orient the Total; push-aware distribution and exact-price grading follow. Named Total sequence is deliberately disabled. | Partial | There is no qualified named Total lane. With the paid score, public/sharp gaps do not move the Total mean; the movement direction may reflect the distribution across the market line. |
| Key numbers | The discrete score distribution preserves push mass; grades add a cushion penalty near 3, 7, 10, and 14. | Partial | Direction strength does not model crossing versus landing on a key number. Current research supports demand discontinuities at 3/7 but not a return-predictability cliff, so key-number crossing cannot automatically become sharp authority. |
| News, injuries, quarterback, weather | These are captured, health-checked, and available in the evidence payload. | Captured, not sequence-aligned | The market reader does not classify whether a move preceded or followed verified news, or whether that news was already consumed by the paid score. |
| Time to kickoff and lock | Uses only pre-evaluation evidence, freshness windows, and immutable T-60 locks. All 65 audited locks landed within the allowed window. | Implemented | Final-hour data cannot rewrite the product. Provider observation time and local receipt time are not independently retained, leaving a latency/clock-skew gap. |
| Probability/score coherence | One joint distribution owns score, winner, Spread, Total, push mass, probabilities, and grades. | Implemented | Market evidence really can move or flip projected scores; it is not display-only. Contrary-side confidence is sometimes produced by reflecting the independent probability, which remains an uncalibrated heuristic. |
| Upset awareness | Reports market-defined upset catches, misses, precision, recall, and actionable underdogs. | Implemented as evaluation | No underdog quota is imposed. Current 18-game recall is 33.3%, so meaningful room remains without just manufacturing upset picks. |
| Board usefulness | Current release retains all three markets; replacement candidates must disclose promotions, demotions, and per-market coverage. | Implemented as governance | The rejected candidate's 19-to-2 contraction demonstrates why a higher opened hit rate alone is insufficient. |

## Nuance the active reader gets right

1. A market signal can move the actual projected score and can flip a side; it is not decorative.
2. Moneyline, Spread, and Total are mapped to their proper axes rather than treated as one generic vote.
3. The evaluated sportsbook is removed from the market anchor, reducing self-confirmation.
4. Missing, stale, mismatched, opposing, and unstable evidence does not count as agreement.
5. A Moneyline winner flip needs Moneyline evidence; Spread pressure alone is not allowed to invent an
   outright winner after the cross-market gate.
6. Exact-price value is evaluated after the prediction, so following a correct move does not automatically
   produce a bet at a bad price.
7. The NFL discrete distribution preserves push behavior and score/pick/probability coherence.
8. Locked T-60 public records are immutable.

## Genuine NFL shortcomings, in priority order

### P0: truthful signal identity

1. Store and expose same-book number movement, same-number price movement, opening-to-consensus
   displacement, and current price lean as four different fields. Do not call them all movement.
2. Store provider observation time and local receipt time. A quote received after lock cannot be treated
   as pre-lock merely because the provider timestamp is older.
3. Add quote lifecycle and tradability states for book/market opener, first product observation,
   suspension, reopening, correction, realistic availability, and observed stake/limit fields.
4. Preserve hold/vig changes and side shading separately from fair-probability and number movement.
5. Bind every split to its source methodology and, where supplied, its exact line/price snapshot. Treat
   missing denominator or line identity as lower authority.
6. Stop labeling DraftKings/BetMGM fallback splits as named sharp flow; either restrict that sequence lane
   to a validated named source or preserve the actual source and calibrate its separate authority.
7. Correct the named-sequence chronology so retail following begins only after the qualifying named lead
   state exists, not merely after the first of two named books moves.
8. Remove Bookmaker from the asserted named authority set until it is actually collected, or add and
   validate the feed in a separately approved release.

### P1: interpretations a sharp reader needs

1. Add explicit resistance states: heavy same-side flow with no material price/number response, movement
   against flow, price resistance before a number change, and cross-book disagreement.
2. Model lead/follow speed, magnitude, persistence time, reversal magnitude, buyback, and re-break instead
   of a single observation-count ratio.
3. Align verified quarterback, injury, weather, roster, and other news timestamps with the quote trail.
   Classify pre-news information, ordinary post-news repricing, and post-news buyback separately.
4. Estimate effective book independence and NFL-specific leadership by market and time-to-kickoff. Do not
   turn shared feeds or copied moves into multiple votes.
5. Identify the originating main, alternate, exchange, derivative, or related-prop market before treating
   correlated follow-through as independent confirmation.
6. Build a separately validated Total authority path. Spread evidence cannot be copied into it.

### P2: calibrated marriage and wagering

1. Replace unvalidated probability reflection and hard predictive cliffs with a chronologically fitted,
   uncertainty-aware NFL residual reader, while preserving the active path until a candidate beats it.
2. Allow multiple independent sub-threshold signals to accumulate smoothly, but collapse derivatives of
   the same quote into one information family.
3. Audit the paid score's input lineage and estimate dependence on the market anchor before assigning a
   downstream market weight.
4. Calibrate Moneyline, Spread, and Total separately by lead time, line bucket, favorite/underdog status,
   and evidence availability. Report proper scores and calibration, not only sides.
5. Preserve exact-price shopping, push-aware EV, current board coverage, and upset precision/recall as
   separate gates.

## NFL-specific next candidate plan

The next candidate must be NFL-only and predeclared before code changes. It should add an observational
feature ledger first, then compare these release-pure paths on identical games:

1. paid independent score only;
2. market-only target-excluded consensus;
3. active r27 marriage;
4. active marriage plus corrected signal identities;
5. resistance/news/sequence features with continuous shrinkage; and
6. the full candidate after ablations and interaction tests.

It must use chronological fit/validation splits, retain every tested variant, cluster uncertainty by game
and week, and publish threshold-neighborhood ledgers. The decision report must include side accuracy,
Brier/log loss, calibration, team/margin/Total error, exact-price units, closing-line value where available,
upset precision/recall, promotions/demotions, and per-market current-board counts. A candidate may move a
score substantially or flip it when evidence earns that authority. It may not win by erasing the board.

## Research interpretation for NFL

- Miller and Rapach find information content increased across sequential NFL lines in their historical
  setting; chronology therefore matters, but the result does not make every later move correct.
- Shank finds particular money/line-response interactions in 2003-2017 NFL data, including informative
  no-adjustment and contrary-Total cases. That supports explicitly testing resistance rather than merely
  following the move; it does not justify copying those historical cutoffs into production without a
  current-data confirmation.
- Fodor, Onuk, and Shank find crossings at NFL key numbers 3 and 7 cause demand discontinuities but not
  realized-return discontinuities. Key numbers matter for contract value and push mass, not as automatic
  proof of informed direction.
- The broader forecasting literature requires calibrated probabilities and warns that selecting the best
  result from many opened backtests can manufacture apparent edge.

References:

- https://doi.org/10.1016/j.jempfin.2013.07.002
- https://doi.org/10.1016/j.jbef.2022.100758
- https://doi.org/10.1016/j.frl.2026.110193
- https://doi.org/10.1198/016214506000001437
- https://doi.org/10.2139/ssrn.2326253

## Approval meaning

Approving this commit means publishing the shared standard, the NFL-specific adapter, this implementation
audit, the rejected-candidate evidence, and a small read-only audit-script robustness fix. It does not
deploy a model, change a score, alter a grade, bump a release, publish to production, or approve CFB.

The recommended decision is to approve it only as the completed **NFL audit foundation**. Keep the NFL
model itself on r27 while the P0/P1 candidate is designed and tested. If the desired meaning of approval is
“NFL market reading is fully fixed and ready,” do not approve this commit, because that claim is false.

## What happens after this audit is approved

Approval publishes the audit record; it does not “run the audit later.” The read-only code trace, stored-
evidence replays, component ablations, coverage review, current-board comparison, and research review have
already been performed. The approved documents make their conclusions durable.

The actual NFL fix is the next, separate model-changing release: add or correct the required evidence
fields, predeclare one NFL candidate, replay it chronologically, report corrections and harms plus board
impact, obtain owner approval for the winning candidate, bump every affected release identifier, publish
through a protected PR, and verify the live reader. Until that succeeds, r27 remains unchanged.
