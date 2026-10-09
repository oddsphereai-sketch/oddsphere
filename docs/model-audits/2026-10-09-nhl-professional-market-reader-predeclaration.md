# NHL professional market-reader predeclaration — 2026-10-09

## Purpose and boundary

This document defines the NHL-specific standard before inspecting losses or
selecting a production candidate. It is not permission to change a live model.
The independent hockey forecast remains separately observable; the market
reader interprets only evidence available before the ordinary T-60 lock and
then, when warranted, reconciles that evidence into one final joint score
distribution. Existing locked public records remain immutable.

The objective is not zero changes, zero harms, maximum movement, a fixed number
of upsets, or a full board. The objective is the best release-pure final product:
net side corrections, calibrated probabilities, score error, exact-price return,
upset recognition, and useful but earned board coverage.

## Research boundary

The benchmark is deliberately conditional rather than a collection of betting
aphorisms.

- NHL Moneyline studies find that commission, price level, and line changes
  affect measured efficiency and return; they do not establish that every move
  should be followed. See Gandar, Zuber, and Johnson (2004),
  <https://doi.org/10.1177/1527002503257208>, and Woodland and Woodland's NHL
  work, <https://doi.org/10.1002/j.2325-8012.2001.tb00385.x>.
- An early NHL Total study reported an under bias, while a later and larger
  closing-line study found the market largely efficient. A universal Under or
  movement rule is therefore inadmissible. See Woodland and Woodland (2010),
  <https://ideas.repec.org/a/ebl/ecbull/eb-10-00729.html>, and Traugutt (2018),
  <https://digscholarship.unco.edu/dissertations/502/>.
- Broader betting-market research shows that line changes can incorporate
  informed trading, but the information content depends on the trader mix and
  market context. See Gandar et al. (1998),
  <https://doi.org/10.1111/0022-1082.155346>, and Krieger and Fodor (2013),
  <https://doi.org/10.1016/j.jeconbus.2013.04.002>.
- Real-time odds may overreact or reverse. Endpoints alone cannot establish
  steam, resistance, or price discovery. The full observed path must be used
  when it is available. See Ottaviani and Sørensen's information/odds work and
  the empirical real-time line-movement study at
  <https://doi.org/10.1287/mnsc.2022.00456>.
- NHL scores are low-count, correlated outcomes with a special overtime and
  shootout settlement process. A final winner probability, puck-line cover
  probability, and Total probability must come from one settlement-correct
  distribution, not three independent narratives. Relevant modeling references
  include MoneyPuck's pregame architecture, <https://moneypuck.com/about.htm>,
  and recent bivariate count work, <https://arxiv.org/abs/2409.17129>.

The product may use these findings to define hypotheses and safeguards. It may
not claim that a named sportsbook is sharp, that handle represents large bets,
or that a particular pattern is predictive unless the available data actually
identifies and validates it.

## The professional NHL evidence record

Each pregame evaluation should retain, when available:

1. The exact independent home/away scoring means, Moneyline probability, puck
   cover probabilities, Total distribution, and goalie/roster assumptions.
2. Complete two-sided, de-vigged Moneyline quotes by sportsbook and observation
   time; incomplete or regulation three-way pairs are rejected.
3. Complete paired puck-line quotes, normally +/-1.5, including both prices and
   every observed price change at the same book.
4. Complete paired Total quotes at each line, including both prices, half-goal
   moves, and every observed same-book price change.
5. Sportsbook class and chronology: an originator/named sharp-book lane, a
   retail follower lane, and market-wide breadth. A follower move cannot be
   mislabeled as originator discovery.
6. Split source, market, side, observation time, tickets, handle, provider
   agreement, and freshness. Unknown bet count, wager size, limits, customer
   identity, injury/goalie cause, or suspension lifecycle remains unknown.
7. The exact quote used for grading, kept separate from the target-excluded
   evidence used to confirm the read.

The complete observed path, not merely first and last, is the audit unit. It
must preserve timing relative to scheduled start and lock, persistence,
reversal, buyback, disagreement, leader/follower ordering, and breadth.

## Market-reading taxonomy

Every market lane is classified from observable evidence rather than a single
cliff threshold.

- **Stable discovery:** an originator or multiple independent named books move
  coherently, the move persists, followers broaden it, and opposing evidence is
  limited.
- **Broad confirmation:** multiple independent books reach the same economic
  direction even when one originator cannot be identified.
- **Resistance:** tickets or handle favor one side while stable price/line
  behavior moves toward or refuses to leave the other side. This is evidence
  for the resisted side only when chronology and two-sided economics support
  that interpretation.
- **Larger-money/lower-ticket pattern:** handle and tickets diverge. It is a
  contextual clue, not proof of sharp money, because the feed does not expose
  wager sizes or bettor identity.
- **Public steam:** tickets, handle, and prices all move together, led primarily
  by retail books. It can confirm market consensus but has less authority than
  persistent originator-led discovery.
- **False steam / reversal:** an early move is materially bought back or loses
  named-book and cross-book support. The endpoint cannot erase the reversal.
- **Disagreement:** named books, prices, lines, or cross-markets conflict. This
  normally reduces authority rather than being forced into either direction.
- **Unavailable:** the necessary two-sided chronology is absent. The product
  remains usable through its independent forecast and any other qualified lane;
  missing splits never make the whole reader display-only or inoperable.

Magnitude, duration, timing, book quality, breadth, and cross-market agreement
are continuous evidence. Thresholds may reject corrupt or economically trivial
observations, but no one arbitrary cutoff may decide the final prediction.

## NHL cross-market interpretation

### Moneyline and puck line

Moneyline and puck line must be interpreted together because both describe the
same goal-margin distribution.

- Moneyline support plus favorite -1.5 price strengthening is evidence of both
  winner confidence and separation.
- Moneyline support plus underdog +1.5 price strengthening can support the same
  outright winner while forecasting a close game; it should pull the expected
  margin inward rather than manufacture a contradiction.
- A dog Moneyline strengthening while its +1.5 becomes more expensive is the
  strongest coherent upset/close-game configuration.
- A favorite Moneyline strengthening while its -1.5 weakens is disagreement or
  a one-goal-game signal, not automatic favorite confirmation.
- A Moneyline winner flip needs stronger evidence than a puck-side change. It
  normally requires persistent target-excluded Moneyline discovery and puck-line
  agreement; a documented missing-puck fallback may use stronger Moneyline
  breadth and sequence evidence.

Because NHL puck lines are usually fixed at 1.5, the price path often carries
more information than the number. Comparing only line values is insufficient.

### Total and game script

The Total lane reads both number and juice.

- A stable half-goal move supported by two-sided price progression has more
  authority than a transient touch.
- A flat 6.0 or 6.5 with material, persistent juice migration is real movement
  and must not be recorded as zero.
- Crossing between 6.0 and 6.5 changes push/tail economics and is not equivalent
  to the same price move at a fixed line.
- Moneyline/puck behavior may support a game script, but cannot by itself dictate
  Over or Under. Low-event one-goal games, empty-net tails, overtime, and goalie
  news make simplistic favorite-equals-Over rules inadmissible.

### Splits

Splits are supplementary evidence:

- aligned tickets and handle can increase confidence when price discovery agrees;
- lower-ticket/higher-handle divergence can identify a resistance hypothesis;
- heavy public exposure with no expected price response can identify resistance;
- stale, low-confidence, duplicated, or source-conflicted splits cannot move a
  projection;
- no-split games still receive a complete price/line/sequence and cross-market
  read.

## Reconciliation with the independent model

The market reader produces signed, separately auditable authority for the
Moneyline/margin and Total dimensions. Authority is graduated by evidence
quality and learned from chronological data; it is not a generic fixed weight.

Permitted outcomes are:

1. **Independent:** qualified market authority is unavailable or genuinely
   inconclusive.
2. **Confirmed:** the market supports the independent side; the final probability
   or score may still move when magnitude evidence is predictive.
3. **Tempered:** the market opposes part of the independent forecast without
   sufficient authority to flip it; margin/Total and grade may move toward the
   market.
4. **Boundary correction:** the final distribution crosses a puck or Total
   decision boundary while retaining the Moneyline winner.
5. **Winner flip:** qualified evidence overcomes the independent winner. The
   complete final distribution is rebuilt so the score, Moneyline, puck line,
   Total, probabilities, and grades agree.

The market may move a projected score substantially or flip it when the evidence
and validation support that action. It may also leave a correct independent
forecast unchanged. The product never changes only a text label or pick while
leaving a contradictory score.

## Evaluation protocol fixed before loss review

1. Reconstruct one authoritative record per NHL game from its own immutable
   release and lock timestamp. No post-lock or final-hour evidence enters the
   candidate because the product locks at T-60.
2. Preserve an explicit independent baseline, incumbent final product, and each
   candidate final product. Do not compare only two already-market-aware releases.
3. Use official settlement scores, including shootout-deciding goals.
4. Evaluate Moneyline, puck line, and Total separately and jointly: accuracy,
   Brier/log loss, team-score/margin/Total MAE, exact-price units/EV calibration,
   corrections, harms, net corrections, upset recall, promotions, demotions,
   grade hit rate, and actionable board count.
5. Review every incumbent loss and every candidate harm at the lock. Label
   qualified missed evidence, false steam, independent-model error, unavailable
   evidence, cross-market disagreement, or irreducible outcome noise.
6. Tune only on a chronological selection segment. Report later games separately
   as confirmation. Because the current 2026 sample is owner-opened and small,
   label it honestly; older NHL archives can validate broad hypotheses but cannot
   fabricate unavailable current-era intraday or split features.
7. Test missing-split, missing-originator, thin-book, stale-split, reversal, and
   target-book-exclusion behavior explicitly.
8. Report the current unlocked board exactly: every score, side, probability,
   grade, promotion, demotion, upset, and actionable-count change.

## Production acceptance gates

A candidate is eligible for owner approval only if it:

- improves the complete objective with positive net corrections and no hidden
  collapse in calibration, score error, exact-price return, or upset behavior;
- explains every harm and loss cohort rather than selecting solely for zero harms;
- retains a tested promotion path for every actionable demotion policy and makes
  board-count impact explicit;
- works with and without splits and never infers unavailable sharp-money facts;
- excludes the evaluated target book/family from confirmation where the evidence
  supports exclusion;
- stores enough evidence to replay the decision at lock;
- produces one coherent final distribution and aligned member output;
- bumps the complete NHL release family, retains one writer and the NHL prediction
  lease, passes the NHL focused suite and `npm run verify:model-change`, and is
  published only through the clean latest-main PR and post-deploy verification
  process.

If those gates are not met, the candidate remains audit-only. The audit must
still report the gap; it may not call the incumbent professional merely because
the safer path changes fewer games.
