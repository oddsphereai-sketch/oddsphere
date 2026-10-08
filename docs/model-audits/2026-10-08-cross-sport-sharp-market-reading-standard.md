# Market-tape reading playbook and model-by-model intervention audit

Date: 2026-10-08
Production base: `0af428981cdbbee281d88b95c229d7e356b07161`
Scope: each active Daily Edge model, MLB Player Props and NFL Player Props
Behavioral decision: audit and evidence-capture changes only; no live prediction, probability,
projection, side, grade, stake, writer, lock or tracking behavior changes

## Correction to the first audit framing

The first version of this report answered the wrong question. It concentrated on whether every
model followed a common independent-first governance contract. The actual question is narrower
and more useful:

1. What does a professional market read look for?
2. When did the move occur, who led it, who followed it, and did it persist or reverse?
3. What can be inferred with trustworthy money/ticket splits, and what can be inferred without
   them?
4. For each model separately, does the current market rule turn incorrect independent predictions
   into correct predictions more often than it damages correct predictions?
5. When the market changes a side, does the projection change coherently too?

This report answers those questions. Operational readiness and generic model-governance material
are no longer treated as the main result.

## Executive findings

- **A line move is not synonymous with sharp action.** A usable read needs a same-book chronology,
  a source identity, a time window, a decision boundary and a result measured only on cases where
  the rule would intervene. Leader/follower adoption and buyback are materially different states.
- **Splits are conditional evidence, not a label for professional money.** Tickets and handle must
  be complete, fresh, source-identifiable and matched to the exact event/market/side. A large
  money-minus-ticket gap without a confirming or resisting price response does not prove anything
  about the winning side.
- **The current models do not have one answer.** MLB full-game Total has a strong but retrospective
  correction result. NBA has evidence that a market blend can repair winner calls, but its study
  used closing benchmarks and is not deployable at T-60. CFB named-book movement and generic RLM
  mostly harm. EPL target-excluded Total consensus helps slightly, while adding a movement gate
  hurts. NFL Player Props benefits from the market posterior today, but its movement cohort is not
  precise enough to flip picks.
- **Correction and harm counts must be first-class metrics.** Improving aggregate accuracy can
  hide needless interventions. The minimum report for a market rule is side changes, corrections,
  harms, net rescues, proper-score change and projection-error change on the same rows.
- **No new live rule is justified by this audit.** Several shadow studies are justified, especially
  an NBA predecision score blend and model-specific intermediate tape capture. The existing MLB
  Total rule should remain narrowly scoped. Generic movement/RLM rules should remain disabled.

## 1. What a sharp market reader actually observes

### The atomic observation

Every observation must retain:

- exact event and scheduled start;
- market, side and exact point line;
- sportsbook and source family;
- American price and a complete same-book opposite-side price when no-vig probability is claimed;
- provider observation time and OddSphere capture time; and
- whether the observation was available before the model decision and lock.

A price change at the same line, a point-line change and a cross-book price difference are three
different facts. A FanDuel opener followed by a Circa current quote is not a movement trail. A
three-way soccer fair probability must come from one complete book, and a two-way fair probability
must not cross books or handicap points.

### The tape states

The market reader should classify the path before it changes a forecast:

| State | What happened | What it may mean | Default authority |
| --- | --- | --- | --- |
| Price discovery | A trusted source moves first, other independent families follow, and the move persists | New information is being incorporated | Candidate confirmation or correction |
| Continuation | Repeated same-direction moves with no material buyback | Information or sustained demand | Stronger than one endpoint, still model-specific |
| Resistance | Tickets/handle favor one side but a trusted book does not move, or moves the other way | Price maker disagrees, liability is tolerated, or split source is noisy | Context; demote only if validated |
| Buyback | An early move reverses materially before the decision | The first price overshot or a second information event arrived | Do not use the opening-to-current endpoint alone |
| Boundary cross | The qualified market state crosses the model's winner, spread or total decision boundary | It can actually repair or harm a pick | Only state eligible for a side flip |
| Retail-only drift | Followers move without a named leader, often late | Public demand or copied risk management | Never call it sharp by default |
| Source switch/stale reset | Apparent move comes from a different book, line, event mapping or stale opener | Data artifact, not market information | Reject |
| Market conflict | Moneyline, Spread and score-implied winner disagree; or related props move incompatibly | Mixed information or bad identity | Hold/fallback; never force coherence |

### Leader and follower logic

“Sharp book” is a source property, not an outcome guarantee. The more defensible no-split pattern is:

1. a named originator moves on its own same-book trail;
2. at least one independent source family follows;
3. the move remains through the model decision rather than immediately buying back;
4. the move crosses the exact model decision boundary; and
5. related markets do not contradict it.

One isolated Circa or Pinnacle move is evidence, but it is not enough to infer that the correct side
is the moved side. The CFB audit below demonstrates why.

## 2. Timing: what to capture and when

There is no universal “late money is sharp” cutoff. The checkpoints below are research bins. Their
purpose is to learn which window matters for each model, not to assume that every T-60 move has the
same meaning.

| Model family | Required tape checkpoints | Information events that must be tagged |
| --- | --- | --- |
| NFL / CFB | First trustworthy weekly open; T-72; T-24; T-6; T-90; T-60/lock; close for evaluation only | QB/injury status, weather, limits/liquidity, active roster, large boundary crossings |
| NBA / WNBA / NHL | First trustworthy open; T-24; T-6; T-180; T-90; T-60/lock; close for evaluation only | Starting lineup/goalie, rest, travel, late scratches, back-to-back status |
| MLB full game / first inning | First two-sided open; T-12; T-6; lineup confirmation; T-180; T-90; T-60/lock; close for evaluation only | Starting pitcher confirmation/change, lineup, weather/wind, bullpen availability |
| EPL / UCL | Opening board; T-24; T-6; T-120; confirmed XI around T-75; T-60/lock; close for evaluation only | Starting XI, goalkeeper/striker absence, rotation, competition incentives |
| NFL Player Props | First exact player/market/line quote; T-24; T-6; T-180; actives/inactives; T-90; T-60/lock; close | Starter status, route/snap role, teammate absence, weather, correlated team-total moves |
| MLB Player Props | First exact player/market/line quote; lineup/starter confirmation; T-180; T-90; T-60/lock; close | Batting order, handedness, pitcher change, pitch count, weather, related prop moves |

Rules for every checkpoint:

- Keep every changed observation, not just open and current.
- Record the first trustworthy complete market separately from a provider's claimed opener.
- Never use the close to make a T-60 prediction; the close is an evaluation benchmark.
- Split performance by window. An open-to-T-24 move may be informed discovery while a T-15 move may
  be public demand, news, or buyback—or the reverse. The data decides.
- Record move velocity, number of independent followers, persistence, maximum excursion and
  reversal from the maximum, not only endpoint delta.
- Evaluate important line thresholds separately: zero for winners, key spread numbers, 2.5 in
  soccer, integer baseball Totals and the exact prop half-point.

This timing treatment follows the empirical finding that later markets often contain more
information but do not improve monotonically. Simon's four-book, 3,681-game MLB study found
negative autocorrelation/overreaction and specifically found some weekend day-game prices worse at
start time than 90 minutes earlier. NFL intra-week work likewise found increasing information from
early to close alongside persistent sentiment inefficiencies.

## 3. Reading with splits and without splits

### With verified splits

A split row is usable only when all of these fields are present and fresh:

- named source or defined source family;
- exact event, market, side and point line;
- ticket percentage and money/handle percentage from the same snapshot;
- observation time before the decision;
- nonempty sample/coverage metadata when supplied; and
- no impossible or unexplained endpoint values.

Then classify it jointly with price action:

| Split plus price state | Interpretation to test | Default action |
| --- | --- | --- |
| Money share exceeds ticket share; leader and followers move that way | Larger average wagers plus price confirmation | Strong corroboration candidate |
| Money/tickets oppose model; price crosses model boundary and persists | Genuine correction candidate | Flip only after model-specific holdout proof |
| Tickets are lopsided; price resists or moves opposite | Potential public demand/resistance | Warning or demotion candidate, never automatic flip |
| Money/tickets point one way; price moves the other | Split source may be partial, stale or noncausal | Conflict/hold |
| Large split gap but no price response | Book may welcome the action or split sample may be unrepresentative | Context only |
| Split appears only after the model decision | Leakage | Exclude |

“Reverse line movement” is therefore a joint state, not a standalone signal. It needs an exact
split snapshot, a true same-book trail and a causal time order. The CFB evidence shows that generic
RLM can be actively harmful.

### Without verified splits

The reader can still operate, but it must replace the missing evidence with real price-path
structure rather than a synthetic public/sharp label:

1. same-book open/intermediate/current chronology;
2. named leader versus independent follower order;
3. complete no-vig price movement at the same line;
4. persistence versus buyback;
5. decision-boundary crossing;
6. target-book exclusion; and
7. cross-market confirmation without double-counting the same price source.

Without splits, a high-quality leader-plus-followers move can be tested for forecast authority. A
single endpoint, a consensus assembled from correlated retail books, or an anonymous “sharp” flag
cannot.

## 4. When the market may change a prediction

The market can interact with a model in four distinct ways:

1. **Confirm:** same side, no boundary cross. It may affect grade or confidence only if that exact
   confirmation rule improved held-out calibration/action selection.
2. **Warn:** credible opposition that does not cross the boundary. It may demote only if a tested
   demotion rule improves outcomes and retains a valid promotion path.
3. **Correct:** credible opposition crosses the exact boundary. This is the only market state that
   may flip the side.
4. **Invalidate:** stale, incomplete, contradictory or misidentified evidence. Fall back or hold.

A correction candidate must be judged on its interventions, not the entire board:

```text
correction = independent wrong, market rule right
harm       = independent right, market rule wrong
net rescue = corrections - harms
precision  = corrections / (corrections + harms)
```

It must also improve Brier/log loss and the relevant margin, Total, team-score or player-projection
error. If it flips a side, the model must rebuild one coherent probability distribution and score
or player projection. Changing only the pick label is not a valid correction.

## 5. Model-by-model intervention results

### Summary

| Model | Market intervention tested | Corrections / harms | What the evidence says now |
| --- | --- | ---: | --- |
| MLB full game | Narrow Total opposition rule | 38 / 20 | Positive, strongest current rescue rule; keep narrow and provisional |
| MLB first inning | Market-heavy posterior / automatic movement flips | Old blend mixed; movement 6 / 1 on only 7 rows | Current architecture lacks a clean current-target-excluded validation; shadow both weights, do not infer from seven flips |
| WNBA | Target-excluded decision crossings | Winner 3 / 2; Spread-only 2 / 0 across 44 | Pooled net positive, final block net negative; current v1.6 has only 2 settled rows |
| NBA | 65% independent / 35% market closing-score blend | Winner 28 / 18 on 554 confirmation games | Strong shadow candidate, but closing benchmark is not a deployable predecision input |
| NFL | Current market marriage plus winner-coherence release | Total 11 / 7 on 47; later winner changes 3 / 1 on 14 | Positive but small/provisional; preserve strict winner corroboration |
| CFB | Named movement/RLM; separate validated Playbook Spread lane | Most named lanes net harmful; validated marriage +10 Spread wins on 256 | Do not generalize named movement. Retain only released split-specific lane |
| NHL | Public-split nudge; old generic movement; current discrete flip | Public split lost 3 net; old movement 40 / 40; current strict flip 1 / 0 | Correct to remove generic nudge; current flip is too sparse to expand |
| EPL | Target-excluded Total tilt; movement-gated variant | Consensus 2 / 1; movement gate 1 / 1 | Consensus tilt modestly useful; movement adds no value and worsens error |
| UCL | Corroborated opening-market crossing | Selection 3 / 0; confirmation 0 flips | Proper scores improve, but side-correction confirmation remains unproven |
| NFL Player Props | Published market posterior; Receptions discrete rule; movement | Receptions 2 / 0; movement support vs adverse imprecise | Market posterior currently protects bad independent calibration; movement remains shadow |
| MLB Player Props | Target-excluded market/model marriage | Side-level rescue count not isolated | Whole posterior improves Brier, but movement/split contribution is not separately proven |

### MLB full game

**What production does.** The r90 Total rule considers only a low-confidence model side (at most
57.5%) opposed by a target-excluded two-sided price, a continuous adverse same-book trail and a
second corroborator. The corroborator may be a verified opposing money-versus-ticket pattern or
the sport-owned internal sharp-resistance state. A real opposite quote is mandatory. The final
Total is reflected across the listed line when necessary while the independent margin is
preserved.

**Does it rescue bad predictions?** On the fixed 58-row retrospective selector, the original side
was 20-38 and the correction was 38-20: 38 corrections, 20 harms, net +18. Total MAE improved in
all four chronological segments, including 3.3346 to 1.9409 from September 19 onward.

**Decision.** This is the best current example of the requested behavior, but it remains
retrospective and highly selected. Keep it exactly scoped. Break future results out by split-backed
versus internal-resistance corroboration, move window, leader book, reversal and release. Do not
extend it to Moneyline or generic Total movement.

### MLB first inning

**What production does.** The current r85 path uses a 65% independent / 35% target-excluded
multi-book posterior, with an independent-only Toss-Up band when corroboration is absent. Opening
and current evidence is displayed, but movement does not automatically flip NRFI/YRFI.

**Does it rescue bad predictions?** The earlier 25% independent / 75% market bridge produced 246-172
across 418 actions, but its August 1-10 validation was only 36-30 with negative ROI. Automatic FI
movement flips were 6-1 on seven rows—far too small to authorize a rule. The present 65/35 rollback
was weaker than the older bridge in one replay, but historical target-exclusion and architecture
did not match current production, so that comparison cannot choose the live weight.

**Decision.** Current market reading is not proven optimal. Run a current-architecture,
target-excluded shadow at 25/75, 50/50, 65/35 and independent-only, evaluated at lineup/T-180/T-90/
T-60. Separate NRFI and YRFI and report corrections/harms, Brier/log loss and run-projection error.

### WNBA

**What production does.** v1.6 starts from the independent coherent margin and grants the
target-excluded market center side-changing authority only when at least two source families cross
the winner or exact Spread boundary without a contradictory winner regime. Total remains
independent.

**Does it rescue bad predictions?** Across 44 opened games, seven boundary crossings generated
three winner corrections and two winner harms. Two additional spread-only crossings were both
corrections. That moves winner accuracy 34/44 to 35/44 and Spread 26/43 to 28/43. But the final
14-game block's three winner flips were one correction and two harms. Only two of 44 games had
qualified same-book movement and only one had originator movement; no movement- or split-confirmed
candidate intervened. After correcting the audit's stale active-release filter, the actual v1.6
cohort contains only two settled games, both directionally correct with no boundary arbitration.

**Decision.** The crossing idea is promising but not yet proven sharp by timing/source evidence.
Retain the narrow release, call it provisional, and do not add a movement or split gate until the
checkpoint tape has enough coverage.

### NBA

**What production does.** The regular-season r1 forecast currently keeps market prices downstream
for exact-line probability, economics and grade; it does not use the market to change the score or
winner.

**Does the rejected market approach rescue bad predictions?** Yes, in the available audit. On the
554-game confirmation block, the 65% independent / 35% market score blend changed 46 winner calls:
28 corrections and 18 harms, net +10. Winner accuracy improved 64.80% to 66.61%; team-score MAE
9.6001 to 9.3873; margin MAE 10.9252 to 10.6949; Total MAE 15.6065 to 15.2636. The selection block
was also positive at 55 corrections and 40 harms. Because a convex blend toward the market line
cannot cross that same Spread/Total line, Spread and Total side changes were zero; it improved
scores and winner calls, not against-market side selection.

The narrower 65% market-favorite crossing changed 12 confirmation winners with seven corrections
and five harms, but slightly worsened team-score and margin MAE. It is inferior to the continuous
blend in this audit.

**Critical limitation.** The historical file uses closing market benchmarks. It does not prove
what was available at T-60, target-book exclusion or leader/follower timing. The prior rejection
because the blend violated an “independent-first” product principle was not an accuracy finding;
the real reason it cannot ship is predecision evidence mismatch.

**Decision.** NBA is the clearest missing shadow study. Rebuild the same 65/35 candidate from
target-excluded open/T-24/T-6/T-90/T-60 snapshots. If T-60 retains the correction surplus and error
improvements on an untouched block, the score blend should be reconsidered on evidence rather than
ideology.

### NFL

**What production does.** The paid team-score model is combined with target-excluded current market
families. Same-book Spread/Total movement can make a real direction correction. A Spread-driven
outright-winner change additionally requires a same-book Moneyline no-vig move of at least one
percentage point, a fresh named sharp gap of at least ten points or lower-trust Playbook gap of at
least eight, and no sharp veto.

**Does it rescue bad predictions?** In the 47-game r23 replay, 18 Total side flips were 11
corrections and seven harms; Total direction improved 24-23 to 28-19 and Total MAE 11.5966 to
11.1901. In the later 14-game r28 replay, four Moneyline changes were three corrections and one
harm; Moneyline improved 8-6 to 10-4, Spread 6-6-2 to 9-3-2, and margin MAE 7.5731 to 5.7677.

The audit's `winnerCoherence: rejected` rows are not proof that the veto was bypassed. They describe
a possible additional Spread-driven crossing inside the target-excluded candidate; the candidate
versus incumbent side can still differ because the target-excluded market family itself changed.

**Decision.** Current results are positive but small. Keep the strict Moneyline corroboration and
do not relax to a generic Spread-following winner rule. Add intermediate weekly tape so opener,
injury window, late move and buyback can be tested separately.

### CFB

**What production does.** The only score-changing market lane with substantial evidence is the
sport-specific Playbook Spread arbitration: at least eight-book coverage, at least a five-point
money-minus-ticket divergence and conflict with the independent cover side. It reflects the margin
across the exact Spread line and preserves the independent Total. Separate named-book movement,
RLM and split feeds are captured for context and grade rules. The current anchorless Spread lane
keeps the independent PMF and merely permits a tightly qualified Lean; it is not a score flip.

**Does it rescue bad predictions?** The validated 256-game marriage improved Moneyline 213/256 to
220/256, Spread 125/256 to 135/256, margin MAE 13.9567 to 13.2372 and team-score MAE 9.5227 to
9.2880. On untouched Weeks 3-4 it retained 120/140 Moneylines and 74/140 Spreads while improving
both errors. This supports that exact split-dependent lane.

It does **not** support generic sharp-book movement:

- Circa Moneyline movement disagreements: 2 corrections, 6 harms.
- Circa Spread movement: 7 corrections, 10 harms, with worse disagreement MAE.
- Circa Total movement: 5 corrections, 9 harms.
- Pinnacle Moneyline/Spread/Total: 1/2, 2/2 and 3/4 corrections/harms.
- Circa RLM Total: 1 correction, 4 harms; RLM Spread was roughly even and worsened MAE.
- DraftKings split versus Circa was 1/1 Moneyline, 4/4 Spread and 3/4 Total.
- Public-split opposition was sparse and generally harmful.

**Decision.** CFB currently handles the distinction correctly only if these lanes remain separate.
Retain the validated Playbook Spread rule and its continuity constraints. Do not call Circa/Pinnacle
movement or generic RLM a correction signal. Continue prospective source/timing capture and require
a new untouched block for every named-book rule.

### NHL

**What production does.** A discrete Moneyline flip requires independent/market conflict, at least
two complete books with the market side at 54%+, a one-point same-book move and complete money plus
ticket support at 55%+ with medium/high agreement. Total remains independent.

**Does it rescue bad predictions?** On 147 confirmation games, a bounded 20% no-vig price sanity
input improved winner accuracy 55.78% to 56.46% and slightly improved Brier/log loss. Adding the old
public-split nudge reduced winner accuracy to 54.42%, losing three net winner directions. Generic
2017-21 five-point movement changed 80 decisions with exactly 40 corrections and 40 harms. The
current strict discrete flip changed one three-game replay winner and was correct, but one result
cannot validate expansion.

**Decision.** Removing the generic public-split nudge was correct. Keep the small price-sanity input
and strict discrete rule. Build current-era intraday named-book history; the recovered public-split
archive cannot validate steam velocity, resistance or RLM.

### Premier League

**What production does.** One Dixon-Coles PMF owns Match Result, Double Chance, Total, BTTS and
projected goals. A strictly target-excluded, source-family-qualified Total consensus may tilt the
PMF. Same-book movement is retained but has no forecast authority. The separate r19 draw lane is a
score-model rule, not a market rule.

**Does it rescue bad predictions?** Across 30 forward captures, the incumbent target-excluded Total
tilt made three Total side changes: two corrections and one harm. Total direction improved 15/30
to 16/30 and Brier 0.25009 to 0.24878, with a tiny Total-MAE improvement. Requiring named movement
reduced the rule to two side changes, one correction and one harm, and worsened Total Brier to
0.25298 and MAE to 1.64582. In the final ten, the target-excluded tilt made one correction and no
harm; the movement gate made no side change.

**Decision.** Keep the target-excluded consensus tilt. Do not promote movement to a gate or flip
signal. Capture confirmed-XI timing because the current 30-game sample cannot distinguish lineup
information from ordinary price discovery.

### Champions League

**What production does.** When at least two target-excluded opening 1X2 books lead away from the
independent result by at least five percentage points, r7 applies a 70% independent / 30% market log
pool and solves one coherent score distribution while preserving the independent expected Total.

**Does it rescue bad predictions?** In the 38-match selection block, four side flips produced three
corrections and zero harms. In the untouched 20-match confirmation block, the rule applied three
times but made zero side flips. Confirmation still improved multiclass Brier 0.198784 to 0.195149,
log loss 0.988708 to 0.974952 and team-score MAE 1.170749 to 1.160122.

**Decision.** Retain r7 for probability/score calibration. Describe side-correction evidence as
selection-only until an untouched block contains actual flips. Add post-lineup checkpoints rather
than importing EPL movement logic.

### NFL Player Props — each family remains separate

The active product contains Anytime TD, Passing Attempts, Passing Completions, Passing Yards,
Rushing Attempts, Rushing Yards, Receptions and Receiving Yards. They cannot share a generic prop
market coefficient.

**Published posterior.** On 183 genuinely independent 2026 actionable scopes, the raw independent
probability was severely overconfident: 49.73% direction, 0.31339 Brier and 0.85102 log loss. The
same-row market was 0.24916 / 0.69147 and the published model/market marriage was 0.25231 / 0.69799.
The independent-minus-published Brier gap's game-clustered 95% interval was entirely unfavorable to
the independent model. Across 207 point scopes, published projection MAE was 19.2661 versus 21.8400
independent. Removing market influence now would make the product worse.

**Discrete intervention.** The released Receptions disagreement rule made two side changes in Week
4 and both were corrections, improving Receptions direction 42-43 to 44-41 and improving Brier/log
loss with no board inflation. No other family earned that discrete rule.

**Movement.** Same-book open-to-lock movement supporting the published pick was 21-16 (56.76%);
adverse movement was 42-48 (46.67%); mixed/neutral was 44-36 (55.00%). The support-minus-adverse gap
was about ten points, but the game-clustered 95% interval was -11.3 to +33.2 points. Those rows do
not contain complete historical sharp-book identity, so this is movement—not sharp action.

**Family decisions.** Keep the Receptions rule. Keep the existing market safety rail for the other
families while rebuilding their independent distributions. Run the timing/movement study separately
for all eight families. The current observer has real line/price changes but only seven current
sharp observations, all Circa, so Pinnacle/Bookmaker authority cannot be estimated.

### MLB Player Props — each category remains separate

**What production does.** The evaluated book is excluded from its own current consensus,
opening/current movement, related-market movement and any verified split adjustment. The final
posterior generates one side, probability and decimal projection. A crossed side cannot become
actionable without the exact complementary quote.

**Does the marriage help?** Across release-pure windows, the final posterior beat both the
independent model and target-excluded market on Brier:

| Window | Final | Independent | Market |
| --- | ---: | ---: | ---: |
| Through September 11 | 0.21946 | 0.22613 | 0.24308 |
| September 12-16 selection | 0.22113 | 0.22841 | 0.24018 |
| September 17-20 confirmation | 0.21556 | 0.22230 | 0.24468 |

That proves the complete per-category posterior is useful. It does **not** isolate whether same-book
movement rescued bad picks. The r38 live replay changed thousands of probabilities and 205 sides,
but it was unsettled. The capture contained zero exact fresh split rows, so split impact was exactly
zero. No current report supplies settled per-category corrections versus harms attributable only to
movement.

**Decision.** Retain the whole marriage, but mark movement and splits as unproven components. Grade
the prospective tape separately for pitcher strikeouts, outs, hits allowed, walks and earned runs;
and for each batter category. Cluster correlated props by player/game. Do not transfer the narrow
Doubles Under, Batter Strikeouts Over or H+R+RBI Under selection sleeves to other categories.

## 6. External research: what it supports and what it does not

- Krieger and Fodor found closing college-basketball lines more accurate than openings, especially
  in lower-profile games with more informed-trader concentration; movement in public-heavy markets
  was more likely noise. This supports source/liquidity stratification, not following every move:
  <https://doi.org/10.1016/j.jeconbus.2013.04.002>.
- Simon's real-time four-book MLB study found markets mostly reliable but not monotonically better;
  price changes showed negative autocorrelation/overreaction, and some start-time prices were worse
  than 90 minutes earlier: <https://doi.org/10.1287/mnsc.2022.00456>.
- Miller and Rapach found information content increased across the NFL week while sentiment-related
  inefficiencies persisted and identified professional bettors were profitable. Timing and trader
  type both matter: <https://doi.org/10.1016/j.jempfin.2013.07.002>.
- Dare and colleagues found that movement explained by already-known information can be noise while
  unexplained movement may contain private information in CFB: <https://doi.org/10.1080/0960310042000306961>.
- Shank's NFL study found no evidence that sportsbooks were uniformly more informed than bettors;
  some split/line configurations suggested informed bettors. “The book knows” is not a sufficient
  rule: <https://doi.org/10.1016/j.jbef.2022.100758>.
- Flepp, Nüesch and Franck found more than 80% of soccer Total volume on Over but no systematic
  return bias from that imbalance. Popularity/handle imbalance alone is not a side signal:
  <https://doi.org/10.1177/1527002514521427>.
- Levitt showed that sportsbooks may shade prices to exploit bettor preferences rather than merely
  clear equal action. A quote is an information-rich price, not ground truth:
  <https://doi.org/10.1111/j.1468-0297.2004.00207.x>.

The common conclusion is conditional: markets aggregate valuable information, but information
content varies by source, liquidity, time, sport, market and path. None of this literature validates
a universal RLM, money-minus-tickets or closing-line-following rule.

## 7. Required implementation and research order

1. Preserve every model's existing live authority while these studies remain shadow/audit-only.
2. Add the model-specific tape checkpoints above to the already append-only observation paths.
3. Store leader/follower order, maximum excursion, reversal, boundary cross and source-family count.
4. For every candidate, publish corrections, harms, net rescues, Brier/log loss and projection error
   by timing window. Do not report only whole-board accuracy.
5. NBA: rebuild 65/35 from target-excluded predecision snapshots first.
6. MLB FI: compare posterior weights on current-architecture, target-excluded checkpoints.
7. WNBA/UCL/NHL: accumulate actual active-release interventions; current samples are too small.
8. NFL/CFB: keep split-dependent and movement-dependent rules separate. Never relabel retail
   consensus as sharp-book evidence.
9. NFL Player Props: retain full T-60 boards and study all eight families separately. MLB Player
   Props: do the same for every category and cluster by player/game.
10. A live flip requires a new release and untouched confirmation. Close is evaluation-only, locked
    records remain immutable, and a projection must be regenerated from the same final distribution.

## 8. Audit tooling corrections made with this report

- The NBA chronological audit now reports side changes, corrections and harms for both the
  continuous market blend and winner-crossing candidate.
- Both WNBA market-arbitration audits now import the current runtime release constant instead of
  incorrectly labeling superseded v1.5 rows as `active_release_only`.
- The EPL movement audit now reports Total side changes, corrections and harms against the
  independent PMF.
- The all-model readiness audit retains its separate pagination repair, but that operational fix is
  not evidence that any market-reading rule is accurate.

The intended standard is not “always trust the model” or “always follow the market.” It is: retain
the exact tape, identify the market state truthfully, and grant each model-specific intervention
only the authority it has demonstrated by correcting more bad predictions than it destroys.
