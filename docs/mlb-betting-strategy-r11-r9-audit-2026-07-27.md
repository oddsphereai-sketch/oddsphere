# OddSphere MLB betting-strategy audit — r11/r9

Date: 2026-07-27

Status: research and bankroll policy only; no production prediction, grade, or
stake behavior changed.

Model releases evaluated:

- Player Props: `mlb_props_2026_07_27_r11`
- Daily Edge: `mlb_daily_edge_decision_2026_07_26_r9`

Reference unit: **1u = $25**

## Governing principles

1. Historical labels from obsolete releases are not called r11/r9 performance.
2. Current rules are replayed over immutable historical offers using only
   information available before each game.
3. Rules are selected on earlier dates and evaluated chronologically on later
   dates. Forward locked rows remain separate.
4. A complete qualifying sleeve is either active or inactive. The strategy
   does not cherry-pick the apparent best two home-run or Singles qualifiers.
5. Stakes reflect evidence strength, variance, and expected volume—not the
   displayed grade name alone.
6. A worse available price than the locked site price invalidates the wager.
7. Parlays are excluded until historical offered parlay prices and a genuine
   chronological holdout support them.

## Historical coverage

- Player-prop opening offers: 51 slates, 2026-06-03 through 2026-07-23.
- Two-way batter observations: approximately 10,400–10,700 for most supported
  markets.
- Milestone observations: approximately 7,000–31,000 depending on market.
- Pitcher audit: 186 dates from 2025 plus an external 2026 set.
- Daily Edge ledger: locked member-facing rows since launch, with prices and
  outcomes.

Historical weather forecasts were not preserved for every Daily Edge slate.
Consequently, current Total reconstruction is less exact than the player-prop
reconstruction. Locked Total results remain useful stability evidence but are
not mislabeled as exact r9 model output.

## Daily Edge evidence

### First inning

| Sleeve | Bets | Record | Units | ROI |
|---|---:|---:|---:|---:|
| NRFI Lean | 86 | 50-36 | +7.10 | +8.3% |
| YRFI Lean | 46 | 30-16 | +9.06 | +19.7% |
| NRFI Best Angle | 16 | 8-8 | -0.99 | -6.2% |
| YRFI Best Angle | 2 | 1-1 | -0.09 | -4.5% |

Since June 22, NRFI Leans returned +13.4% and YRFI Leans +18.5%. The evidence
supports the Lean cohort, not an assumption that the Best Angle label must
always be stronger.

### Moneyline

- All historical Moneyline Best Angles across mixed rule eras: 89-66,
  -1.3% ROI.
- Since July 11 under the more comparable current head: 14-6, +22.0% ROI.
- The fixed r8/r9 mid-price supporting cohort:
  - Best Angle price tier (-145 through -131): 11-2.
  - Lean price tier (-130 through -121): 6-4.
  - Incremental promotion cohort: 7-3, +24.9% ROI.
- Exact r8 Moneyline Best Angles opened 3-0; exact r9 has not accumulated a
  meaningful Best Angle sample.
- The current positive-value inversion gate has only a small reconstructed
  cohort and exact r9 began 0-2. It remains a small-stake sleeve.

### Totals

| Sleeve | Bets | Record | Units | ROI |
|---|---:|---:|---:|---:|
| Total Best Angle | 135 | 72-58-5 | +6.59 | +4.9% |
| Total Best Angle since June 22 | 72 | 40-30-2 | +5.90 | +8.2% |
| Generic Total Lean | 152 | 67-82-3 | -20.72 | -13.6% |

Only the explicit validated-Total-Lean rule may be used from the Lean tier.
Ordinary Total Leans are excluded.

## Player-prop evidence

| Current sleeve or challenger | Later chronological evidence | Decision |
|---|---|---|
| Ranked Hits under, one per game | 117-88, +33.46u, +16.32%; date-clustered 95% ROI +2.68% to +29.29% | Core |
| Premium Singles Best Angles | 410-282, +35.65u, +5.15%; July 24-25 forward 38-22, +9.77% | Breadth |
| Ranked HR promotion, up to five per slate | 23-120, +10.10u, +7.1%; 3/4 later windows positive; 95% ROI -29.9% to +45.7% | Small high-variance sleeve |
| Qualified runs-scored Under promotion | Broad history 176-123; untouched July 24-25 candidate pool 12-6 | Small supported sleeve |
| Qualified H+R+RBI 1.5 Under promotion | 34-25 across four positive future windows | Small supported sleeve |
| Broad runs scored | 190-105, +0.9% ROI; uncertainty crosses zero | Exclude native/broad actions |
| Broad H+R+RBI | 133-78, +3.0%; weak forward return | Exclude native actions |
| Pitcher earned runs | 79-71, -8.7%; July 24-25 5-5, -8.8% | Exclude |
| Pitcher outs action policy | 19-25, -15.7% in 2026 external set | Exclude |
| Pitcher strikeouts action policy | 4-7, -34.7% in later aggregate | Exclude |
| Pitcher hits allowed | 39-49, -10.8% | Exclude |
| Pitcher walks | 40-32 but -10.8% ROI | Exclude |
| Broad batter hits | 432-340, -0.6%; July 24-25 -2.8% | Exclude; use ranked Hits-under only |
| Total bases | 276-231, -1.6% | Exclude |
| Batter walks | 104-66 but -4.4% | Exclude |
| RBIs, doubles, triples, stolen bases, batter strikeouts | No stable priced sleeve | Exclude |

The old seven-slate pitcher-earned-runs result is superseded by the larger
chronological reconstruction.

## Recommended card

Bet every final locked qualifier in an active sleeve. Do not rank or remove
qualifiers after the model's own released qualification.

### Higher-allocation sleeves

| Site decision | Required rule identity | Stake |
|---|---|---:|
| First Inning Lean | NRFI or YRFI | **1.00u / $25** |
| Moneyline Best Angle | Final r9 Best Angle | **1.00u / $25** |
| Player Hits Best Angle | `VALIDATED_HITS_UNDER_BEST_ANGLE`; Under only | **1.00u / $25** |
| Total Best Angle | Final r9 Best Angle; no correction/stand-down | **0.50u / $12.50** |

### Lower-allocation sleeves

| Site decision | Required rule identity | Stake |
|---|---|---:|
| Singles Best Angle | `VALIDATED_SINGLES_PREMIUM_BEST_ANGLE` | **0.20u / $5** |
| Home Run Lean | `VALIDATED_HOME_RUN_PROMOTION` | **0.20u / $5** |
| Runs Scored Lean | Validated Under promotion only | **0.25u / $6.25** |
| H+R+RBI Lean | Validated 1.5 Under promotion only | **0.25u / $6.25** |
| Moneyline Lean | r8 mid-price Lean or positive-value final inversion only | **0.25u / $6.25** |
| Total Lean | Explicit validated-Total-Lean marker only | **0.25u / $6.25** |

### Excluded despite an actionable site grade

- First Inning Best Angles
- Generic Moneyline Leans
- Generic Total Leans
- Native/broad Hits, H+R+RBI, or Runs Scored actions lacking the validated
  promotion marker
- Pitcher earned runs, outs, strikeouts, walks, and hits allowed
- Total bases, walks, RBIs, doubles, triples, stolen bases, and batter
  strikeouts

This distinction is necessary because the site grade answers whether a row is
actionable inside its model release; the betting strategy additionally
requires a stable priced wagering cohort.

## Expected volume

Historical average volume before today's availability filters:

- First Inning Leans: approximately 3 per active slate.
- Ranked Hits unders: approximately 7 per slate.
- Current comparable Moneyline Best Angles: approximately 1-2 per slate.
- Total Best Angles: approximately 3 per slate.
- Premium Singles Best Angles: approximately 25 per slate in the validation
  sample.
- Ranked HR promotions: no more than 5 per slate by the released model rule.

The lower-allocation sleeves can add roughly $160-$190 on a busy slate, mostly
from Singles. They remain part of the official card; their smaller stakes
control volume and uncertainty.

## One official operating mode

The official strategy includes every sleeve in both tables above. There is no
optional second card. On a historically normal slate, total risk is expected
to be approximately **$425-$575**, although availability can move it outside
that range.

The objectives "highest ROI," "highest expected profit," and "fewest bets"
cannot all be maximized simultaneously. This portfolio targets risk-adjusted
profit: higher stakes go to the strongest repeatable sleeves, while positive
but higher-volume or less certain sleeves remain included at $5-$6.25.

The strategy bets every ranked HR qualifier and every premium Singles Best
Angle. It never hand-picks only a few names from either sleeve.

## Stake interpretation

These stakes are relative allocations, not claims that $25 is safe for every
bankroll. If the complete card is too large, change the dollar value of one
unit prospectively and apply it to every sleeve. Do not drop selected
qualifiers from a profitable all-qualifier sleeve.

At the $25 reference unit:

- Core straight wager: $25
- Moderate Total: $12.50
- Breadth qualifier: $6.25
- Home-run longshot: $5

This concentrates dollars in the two sleeves with the strongest repeatable
evidence—First Inning Leans and ranked Hits unders—while retaining smaller
exposure to positive but less certain or much higher-volume sleeves.

## Parlays

No parlay is official. Previous two-leg tests had wide uncertainty and became
unprofitable after removing the best two results. Historical single-leg odds
also cannot reproduce a sportsbook's correlation-adjusted same-game price.
Parlays require stored offered prices and an untouched forward evaluation.

## WNBA boundary

No WNBA Moneyline or WNBA parlay belongs in the official strategy from this
audit. The prior WNBA play-grade and parlay samples were unstable, and this
MLB r11/r9 replay does not validate a WNBA allocation. WNBA requires its own
current-release chronological reconstruction before money is assigned.

## Review trigger

Re-run the release-separated portfolio audit weekly and after any model,
calibration, qualification, or stake change. Do not change a sleeve based on
one winning or losing day. Promotion to a larger stake requires:

1. at least 30 settled wagers;
2. at least 10 independent slate clusters;
3. positive aggregate locked-price ROI;
4. positive ROI after removing the best slate;
5. no reversal across the last two chronological windows; and
6. a price-slippage sensitivity result that remains nonnegative.
