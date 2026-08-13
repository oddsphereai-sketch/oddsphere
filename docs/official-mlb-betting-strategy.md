# OddSphere MLB betting strategy

Strategy release: `oddsphere_mlb_betting_strategy_2026_07_23_r6`

Daily Edge decision release: `mlb_daily_edge_decision_2026_07_23_r2`

Player Props release: `mlb_props_2026_08_13_r33`

Reference unit: **1u = $25**

This is an all-qualifier strategy except for the released rare-event Home Run
portfolio, which has its own slate and game diversification caps. The approximately
$250 daily preference is a target for the strategy's typical slate, not a
ceiling that removes or shrinks otherwise qualifying wagers.

## Official card

Use only the final locked OddSphere decision. Bet every row that satisfies one
of these rules.

| OddSphere section | Final decision | Stake |
|---|---|---:|
| MLB First Inning | Lean — YRFI | **0.50u / $12.50** |
| MLB First Inning | Lean — NRFI | **0.25u / $6.25** |
| MLB Moneyline | Genuine final-side inversion Lean | **0.25u / $6.25** |
| MLB Total | Best Angle | **0.50u / $12.50** |
| MLB Total | Lean carrying the released validated-Lean rule | **0.25u / $6.25** |
| MLB Player Props — batter home runs | Up to three released portfolio Leans, max one hitter per game | **0.10u / $2.50 each** |
| MLB Player Props — pitcher earned runs | Final qualified actionable Lean/Best Angle | **0.50u / $12.50** |
| MLB Player Props — batter runs scored | Final qualified actionable Lean/Best Angle | **0.10u / $2.50** |

The home-run rule uses a prior-only 20-game HR-per-plate-appearance projection,
a 100-PA league prior, batting-order and verified environment opportunity
adjustments, and a 25% multi-book market anchor. It requires nonnegative edge
and EV at +150 through +1000, uses the best available price, and ranks up to
three Leans by EV with at most one hitter per game.
The earned-runs rule requires an approved price and at least 5% locked EV. The
runs-scored rule requires the released price, confidence, probability, edge,
and EV gates.

Pitcher-outs `r7` improves the site's probability and projection layer but
does not add pitcher outs to this official wagering card. Historical action
returns remain too uncertain to make that separate strategy claim.

An ordinary Moneyline Best Angle is not yet in the official card. The exact r2
release has no settled sample, while the broader historical label was
unprofitable. A genuine inversion is different: it means the inversion
survived every downstream decision layer and changed the final published side.

## Daily procedure

1. For Daily Edge, use the final locked row. For Player Props, use the
   authoritative game membership locked at T-60.
2. Place every qualifier at the listed stake. Do not rank them or stop after a
   certain number of wagers.
3. Accept the locked price or a better price. If only a worse price is
   available, the locked EV no longer describes the offered wager; do not
   chase it.
4. Do not add an omitted market because it is a Best Angle or has positive EV.
   The market-specific rule in the table must qualify.
5. Do not enlarge stakes on a quiet slate or after wins, and do not chase
   losses.

Multiple qualifying wagers from one player or game remain separate bets. They
are not capped or ranked away. Performance and uncertainty must nevertheless
be measured by player/game clusters so correlated rows are not mistaken for
independent evidence.

## Parlays

The official card is currently singles-only. Do not combine two same-game
qualifiers merely to improve a short favorite's payout. Historical straight
prices cannot reproduce the sportsbook's correlation-adjusted SGP quote.

The leading parlay candidate pairs a qualified batter runs-scored Under priced
at -150 or shorter with a qualified pitcher earned-runs wager from a different
game. Chronological frozen-field tests were positive across -150, -175, -200,
and -225 runs-Under thresholds, including the three-slate holdout. This is not
yet an official wager rule because only three forward holdout slates exist.
Promote it only after at least seven additional forward slates using stored
offered parlay prices. Until then, place both qualifying legs as their
prescribed singles.

## How the $250 preference works

The proposed stakes produced approximately **12.5u per active slate** when
applied to the July 16–22 frozen-field evidence for the included first-inning,
total, home-run, earned-runs, and runs-scored rules. At $25 per unit, that is
about **$312 typical daily risk**. Individual slates can be materially higher
or lower.

To target approximately $250 in typical daily risk, use an initial operating
unit of **$20** while retaining $25 as the reporting reference unit. Once per
week, calculate the preceding
14 active slates' average qualifying units:

`operating unit dollars = $250 / average qualifying units`

Change the dollar value only prospectively for the next week, and only if the
rolling average is persistently outside roughly 8u–12u. Apply the new dollar
unit to every sleeve. Never resize a single busy slate, discard late games, or
favor whichever wagers appeared first.

This preserves every qualifying wager while controlling typical bankroll
turnover. A bettor whose bankroll cannot safely tolerate the busiest full
slate should set a smaller operating unit before the slate begins.

## Evidence by market

### First inning

- Lean YRFI: 33 bets, 23–10, **+27.6% ROI**.
- Lean NRFI: 74 bets, 42–32, **+5.8% ROI**.
- Since June 22, those cohorts remained positive at +26.2% and +11.4%.
- First-inning Best Angles were slightly negative. Grade names therefore do
  not override the market-specific evidence: the official signal is Lean.

### Totals

- Final Total Best Angles: 126 bets, 68–53–5, **+8.394u and +6.7% ROI**.
- Since June 22: 63 bets, 36–25–2, **+12.2% ROI**.
- Generic Total Leans: 144 bets, **–13.9% ROI**. They are excluded.
- The released clean promotion controls were 17 bets, 11–6, **+24.4% ROI**.
  A validated-Lean marker identifies the narrow Lean subset that may be bet.
- Correction candidates changed sign across chronological windows. A
  correction trigger is a board stand-down in r2, not an instruction to bet
  the opposite total.

### Moneylines

- Historical final Moneyline Best Angles: 150 bets, **–3.7% ROI**.
- Since June 22: 81 bets, **–11.2% ROI**.
- The immediately preceding calibration had an encouraging 3–0 Best Angle
  start, but the exact r2 release has no settled bets. That is not enough to
  overrule the larger locked-price record.
- Eighteen genuine historical final-side inversions were 11–7,
  **+1.903u and +10.6% ROI**. Only that narrow final-side rule qualifies.

### Home runs

- Current frozen-field qualifier replay: 65 bets, 13–52,
  **+36.60u and +56.3% ROI** across seven slates.
- Five of seven slates were profitable; the result remained positive without
  the best day.
- Nonqualifying Watchlists were negative over the same window.
- A one-unit home-run return was about three times as volatile as a typical
  straight market return. The official stake is therefore 0.10u, not the same
  stake as a total, first-inning bet, or ordinary pitcher prop.

### Pitcher earned runs

- Current-rule replay: 83 bets, 53–30, **+18.376u and +22.1% ROI** over seven
  slates; six slates were profitable.
- At 0.25u, the included-props portfolio returned 9.71u with 1.16u maximum
  daily drawdown. Raising earned runs alone to 0.50u increased return to
  14.30u while maximum drawdown rose to 2.61u. At 0.75u, return increased
  mechanically to 18.90u but drawdown rose to 4.06u and concentration was not
  justified by only seven slates. The released stake is therefore 0.50u.
- The chronological calibration/holdout split was positive on both sides:
  44 calibration bets at +14.0%, then 23 holdout bets at +37.6%.
- The exact first displayed component slate was 11 bets at +7.8%.

### Batter runs scored

- Released-rule replay: 227 bets, **+14.56u and +6.4% ROI** over seven slates.
- The chronological split was 137 calibration bets at +3.4%, followed by 61
  holdout bets at +17.6%.
- This is lower-edge and higher-volume than earned runs, so it receives 0.10u.

## Markets not in the card

| Market or decision | Reason |
|---|---|
| First-inning Best Angle | Negative in the available locked sample; Leans were the demonstrated signal |
| Ordinary Moneyline Best Angle or Lean | Larger locked-price history is negative or near flat; exact r2 is immature |
| Generic Total Lean | –13.9% over 144 bets |
| Any corrected/flip Total | Correction families were unstable; r2 stands them down |
| Batter hits | Current actionables barely positive; preceding component actionables negative |
| Hits + runs + RBIs | Negative in current and earlier component evidence |
| Batter singles | +11.2% over only three current-component slates; preceding component was negative |
| Batter walks | Positive in both component summaries, but only three current-component settled slates |
| Total bases and RBIs | Broader actionable evidence negative |
| Doubles, triples, stolen bases, batter strikeouts | No stable profitable released qualification |
| Pitcher outs | Best Angles lost while a small Lean subset won; grade ordering is not reliable |
| Pitcher strikeouts, walks, hits allowed, pitcher win | Insufficient or unstable actionable evidence |
| First home run | No validated actionable rule |
| Watchlists | Not a released portfolio qualification |

Singles and walks are the leading candidates for addition. They must first
remain positive for at least seven settled current-component slates and 25
settled wagers, with clustered uncertainty reported. If either is added, the
whole released qualification enters; there will be no daily top-N selection.

## Review and release discipline

- Grade at the locked line and locked price.
- Keep model, calibration, decision, props, and strategy releases separate.
- Report row results and player/game-clustered uncertainty.
- Review weekly, but do not change a rule or stake from a short winning or
  losing run.
- A qualification or stake change creates a new strategy release. A change to
  site predictions, grades, or model stakes also follows the mandatory model
  change safety protocol.
- These results support a disciplined strategy; they do not guarantee future
  profit. Exact current releases remain young and must accumulate forward
  evidence.
