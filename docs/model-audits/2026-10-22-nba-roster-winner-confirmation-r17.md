# NBA roster winner confirmation r17 — validation and release record

Date: 2026-10-22

Status: implemented on the candidate branch; production requires protected merge and post-deploy
verification.

## Why r16 was not sufficient

The r16 roster residual improved team-score MAE, margin MAE, total MAE, winner accuracy, Brier score,
and log loss on the 1,230-game 2025 confirmation season. Its discrete winner-crossing cohort was only
16 corrected incumbent errors versus 14 harmed incumbent correct calls. That +2 result was positive,
but too close to variance to treat crossing precision as settled.

Global shrinkage, magnitude caps, contribution-coherence scaling, and net/PIE agreement filters were
rejected. Several looked cleaner on 2023-2024 and then reduced or reversed winner accuracy in 2025.
They would have made the model cosmetically conservative without reliable predictive evidence.

## Selected architecture

The r16 zero-intercept ridge remains the primary margin and total residual. A second zero-intercept
ridge is constrained to home/away symmetry:

- margin inputs are home minus away incoming-versus-outgoing estimated net, PIE, and decayed turnover;
- the confirmation activates only when retained rotation minutes are at or below 55%;
- decay remains 16 current-season games;
- verified exact-game OUT availability is shared with the primary head;
- when the primary head does not reverse the independent winner, its correction remains exact;
- when the primary head reverses the winner and the symmetric head agrees, its correction remains exact;
- only a contradicted primary winner reversal uses the symmetric margin correction;
- the primary total correction always remains exact.

The rule contains no manual team strength, fixed injury points, favorite/underdog preference, public-
split authority, market-following instruction, hard score cap, or automatic no-flip policy. The one
selected margin and total still rebuild both team scores algebraically before the existing qualified
market reader runs.

## Chronological evidence

All base predictions and roster features are point-in-time. Residual heads train only on earlier
rolling-origin residuals. The policy screen uses 2023-2024, and 2025 is reported chronologically.
Because 2025 had already been opened for the r16 release, it is not represented as a second pristine
holdout; it is retrospective confirmation alongside the two earlier rolling-origin seasons.

| Season | Corrections | Harms | Net | Correction share | Margin MAE delta | Brier delta | Log-loss delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023 | 7 | 3 | +4 | 70.0% | -0.01364 | -0.000649 | -0.001464 |
| 2024 | 9 | 3 | +6 | 75.0% | -0.02947 | -0.001456 | -0.003373 |
| 2025 | 6 | 4 | +2 | 60.0% | -0.06217 | -0.001209 | -0.003168 |
| Combined | 22 | 10 | +12 | 68.8% | — | — | — |

On the 1,230-game 2025 season, candidate minus the frozen pre-roster incumbent is:

| Metric | Delta | r16 delta | Result versus r16 |
| --- | ---: | ---: | --- |
| Team-score MAE | -0.01485 | -0.01399 | Better |
| Margin MAE | -0.06217 | -0.05847 | Better |
| Total MAE | -0.01231 | -0.01231 | Identical |
| Winner accuracy | +0.001626 | +0.001626 | Identical net +2 |
| Home-win Brier | -0.001209 | -0.001067 | Better |
| Home-win log loss | -0.003168 | -0.002881 | Better |

The confirmation rule changes 20 of r16's 1,230 winner calls, leaving 1,210 unchanged. Relative to
the original incumbent, only ten games cross sides: six corrections and four harms. Thus it preserves
r16's net winner gain while removing ten fragile corrections and ten fragile harms. Across all three
evaluated seasons the correction share rises from 45/76 (59.2%) to 22/32 (68.8%). These are bounded
samples, not a promise of future perfection; the continuous probability and error improvements are
the broader evidence.

## Current roster and board verification

The live active-roster probe returned all 30 teams. Philadelphia's expected rotation includes Tyrese
Maxey, VJ Edgecombe, Jaylen Brown, LeBron James, Joel Embiid, Anfernee Simons, Dean Wade, and the next
eligible prior-profile player after verified OUT exclusions. Cleveland remains above both continuity
thresholds. Both heads confirm Philadelphia over Cleveland, so r17 preserves the r16 CLE-at-PHI
projection, side, probability, price, and Watch grade. DEN-at-OKC remains exactly unchanged. The
same-input board therefore has zero promotions, zero demotions, zero pick changes, zero projection
changes, and zero incoherent score tuples versus r16.

The expected promotion path remains symmetric: a confirmed winner correction may improve either side,
and the existing positive exact-price EV, evidence quality, availability, and market-reader gates decide
whether it becomes actionable. No play is created merely to offset a demotion.

## Releases and rollback

- Model / prediction record: `nba_professional_unified_2026_10_22_r17_roster_winner_confirmation`
- Roster residual: `nba_roster_regime_residual_2026_10_22_r2_symmetric_winner_confirmation`
- Market marriage: `nba_market_marriage_2026_10_22_r19_roster_winner_confirmation`
- Grade policy: `nba_grade_policy_2026_10_22_r11_roster_winner_confirmation`
- Daily refresh: `nba_daily_refresh_schedule_2026_10_22_r15_roster_winner_confirmation`
- Lock publication: `nba_member_lock_publication_2026_10_22_r4_roster_winner_confirmation`

Stored locked payloads retain exact precedence and are never rescored or regraded. Roll back future
unlocked generation on an artifact/release mismatch, incomplete active-roster coverage, score tuple
incoherence, unreviewed current-board impact, or any locked-record mutation.
