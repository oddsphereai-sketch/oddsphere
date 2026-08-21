# NFL sharp-brain product contract r8

Date: 2026-08-20  
Scope: local NFL research and founder preview only; no production writer, cron, database mutation, official grade, stake, tracking, settlement, or deployment  
Projection release: `nfl_pregame_real_local_current_refit_2026_08_19_r3`  
Current preseason grade release: `nfl_regular_pipeline_preseason_grade_policy_2026_08_20_r2`  
Sharp-brain launch contract: `nfl_sharp_brain_launch_contract_2026_08_20_r1`

## Product correction

The projection model and play-grade engine have different jobs. The projection estimates the score distribution and market probabilities. The play-grade engine is OddSphere's sharp bettor brain: it prices the selected side, applies uncertainty, quarterback/injury news, key numbers, movement, public/sharp evidence, and slate-relative opportunity cost, then decides what is worth betting and with what conviction.

A professional NFL betting product cannot treat an ordinary complete regular-season week with zero bets as an acceptable final state. The launch contract now requires at least one evidence-qualified `Lean` or `Best Angle` on every non-empty regular/postseason card. This is not a quota that converts a negative-EV row into a bet. If no row qualifies, the decision release fails the product gate and remains in research. A weaker week should reduce conviction and risk, not eliminate the betting card.

Preseason remains a non-tracked rehearsal. It may show only monitoring labels while participation is unknowable, and no preseason result may enter official or lifetime NFL records.

## Board semantics

The current board contains 16 real games and 48 predictions: moneyline, spread, and total for each game. The prior 15 Watchlist / 1 No Play summary counted one headline market per game and was not the complete grade distribution. The corrected default summary counts all 48 rows: 31 Watchlist and 17 No Play. Market tabs narrow the denominator to 16. Selecting a grade shows games containing at least one matching market, while each card retains all three predictions.

No current grade changed. There are still zero actionable rows in the preseason rehearsal, so the current regular-season decision system remains unapproved.

## Price and Opening contract

The customer-facing term is `Opening`. A provider-native opening quote is preferred. When none is supplied, the earliest checksum-verified stored quote for the same sportsbook and outcome becomes OddSphere's operational Opening; its original source and timestamp remain unchanged in evidence. `Prior` is not synthesized and requires a later same-book capture.

Provider audit findings:

- BALLDONTLIE supplies the complete current preseason slate/prices used by the local reader but returned no native opening rows for the 16 current preseason games. Its historical opening endpoint separately supplied 1,088 verified 2025 regular-season rows with complete 272/272 game coverage at Caesars, DraftKings, Fanatics, and FanDuel. The checksum-pinned local cache took 14 bounded requests and no production/member requests.
- Playbook supplied complete current consensus prices and public split fields for the 2026 regular-season schedule, but no preseason rows and no documented line-history endpoint.
- SharpAPI supplied timestamped current per-book prices and no NFL split rows. Its standard `/odds` endpoint is a current snapshot; the documented historical odds and movement endpoints are Enterprise features.

The member preview therefore reads only stored slate-level data and makes zero provider calls. A bounded collector—not a card or member request—must preserve the earliest same-book quote and subsequent material changes throughout the week.

## Research standard for the replacement grade engine

Candidate decision releases must be evaluated chronologically and price-aware. At minimum the tournament must compare:

1. market-only probabilities;
2. the independent OddSphere projection;
3. a calibrated market-plus-model stack;
4. uncertainty/quantile or full-distribution pricing around key NFL margins;
5. the same stack with quarterback, injury, weather, rest, movement, and available split evidence;
6. slate-relative ranking and conviction sizing.

Selection is based on Brier score/log loss and locked-price betting value, not game-pick accuracy alone. Reports must include weekly actionable coverage, market mix, closing-line value when available, units/ROI, calibration error, worst week/drawdown, and the number of regular weeks with zero actions. A candidate fails the product contract if any complete regular/postseason week has zero action, but it also fails the evidence contract if its action was created without positive expected value at the locked price.

## Current result and next gate

The frozen r3 model does not beat the terminal market on 2025 margin or total error. A generic probability-gap ladder also lost in both evaluated 2025 time windows. Therefore this change does not promote action by threshold relaxation. The next valid milestone is a new immutable shadow decision release that passes chronological price-aware testing and the weekly-action contract; only then can it be forward-locked during 2026 and considered for production.

Three additional audits were completed:

- The chronological `nfl_sharp_brain_distribution_stack_shadow_2026_08_20_r3` candidate produced at least one positive-model-EV row in every 2025 week, but its 72 selected replay bets went 34-37-1 for -5.856 units (-8.1% ROI). Spread Brier was 0.25497 versus 0.24959 for the market. The release is rejected.
- The published divisional-familiarity direction replay was not stable enough for a grade. Divisional away spreads were +10.870 units over 768 bets from 2018-25 but lost in both 2024 and 2025; divisional Unders lost 13.206 units overall. Road-underdog and high-wind Under diagnostics also decayed in 2023-25. These remain context features only.
- Applying the already-frozen 2024-trained r2 architecture to genuine 2025 FanDuel openings produced a descriptive one-play-per-week card in all 18 weeks: 6-12, +6.396 units. Sixteen of the 18 selections were moneylines, and positive CLV against terminal consensus appeared on only 50%. This shows that real opening prices can materially change action availability, but it is not a selectable holdout because 2025 outcomes had already been inspected and terminal consensus is not a same-book FanDuel close.

The next tournament must add moneyline price-band/longshot calibration, use the new opening-price artifact as historical price evidence, and preserve 2026 locked forward observations as the promotion partition. Intermediate movement and split evidence must remain separately ablated until comparable timestamps exist.

## Board impact

- Actionable promotions: 0
- Actionable demotions: 0
- Net actionable change: 0
- Current preseason board: 31 Watchlist, 17 No Play, 0 Caution, 0 Lean, 0 Best Angle
- Production/tracking change: none

## Rollback

Remove `lib/services/football/nflSharpBrainContract.ts`, restore the prior one-headline-per-game count copy, and restore provider-specific opening wording. No production or historical result repair is required because this release is local-only and changed no grade.
