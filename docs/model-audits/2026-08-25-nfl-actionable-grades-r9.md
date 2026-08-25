# NFL Week 1 actionable grades r9 candidate audit

Date: 2026-08-25

## Decision

Qualified as a **non-public release candidate** for consolidation review. It preserves the r10
joint score distribution and r6 Moneyline Lean lane, adds the r8 exact-price Spread and Total
Lean lanes, adds the historically qualified Moneyline Best Angle tier, and applies the frozen r9
non-actionable Watchlist semantics. It does not publish, track, size, write, call providers, or
create another writer.

## What the football forecast actually uses

The independent r10 score/outcome model uses opponent-adjusted rolling passing and rushing EPA
and success rate; early-down pass efficiency; explosiveness; sack, QB-hit, and turnover rates;
pace, no-huddle, and pass-over-expectation signals; red-zone performance; first/third-down rates;
special teams; penalties; Elo/strength; rest; travel; time zones; surface; coaching continuity;
roster continuity/experience; and experience-shrunk QB-room value. Home/away and matchup direction
are explicit. No sportsbook spread, total, price, split, or movement field enters that independent
head.

Current injuries and projected QB identity enter the r6 Moneyline player-value/health layer; exact
price, named-book movement, target-excluded multi-book consensus, key-number/total-zone
sensitivity, and split/data health enter the separate decision layer. Weather is health-checked and
displayed but cannot alter the forecast until a real forecast is in range. Individual WR-CB, OL-DL,
and LB/coverage matchup grades are not claimed; their effects are currently represented only by
team/QB efficiency, pressure, sack, explosiveness, and roster-continuity inputs. Neither the r10
joint score PMF nor the Spread/Total correction heads claim calibrated player-level non-QB injury
point adjustments.

## Forecast evidence and score dispersion

The r10 six-component football stack produces the one-decimal expected team points, margin, total,
winner probability, Spread probability, and Total probability from one discrete joint scoring PMF.
The reachable integer final score remains secondary context.

- 2024 repeated confirmation: team-score MAE 7.235, margin MAE 9.840, total MAE 9.939; independent
  winner Brier 0.21209, log loss 0.61431, ECE 7.61%, accuracy 68.63%.
- 2025 repeated confirmation: team-score MAE 7.376, margin MAE 10.047, total MAE 10.595; independent
  winner Brier 0.22119, log loss 0.63212, ECE 3.03%, accuracy 63.84%.
- The independent winner head beat the simple football baseline on Brier and log loss in both
  confirmation seasons. The opening market remained better; the model is intentionally retained
  as differentiated football information rather than mislabeled as a market-beating probability.
- Current Week 1 expected team scores span 17.57-27.75 (SD 2.44), margins -4.10 to +10.18
  (SD 3.75), and totals 38.66-48.98 (SD 2.77). This is materially less clustered than the retired
  preseason rehearsal (team-score SD 1.32, total SD 1.37).

## Exact-price grading evidence

All rows use the exact evaluated sportsbook/line/price, a target-excluded same-line consensus from
at least two other books, one timestamp, and the applicable release identifiers. Bet count is an
output; there is no weekly minimum, maximum, or quota.

### Moneyline Best Angle

Frozen rule: an existing coherent r6 Lean also needs at least 2% EV and a 4 percentage-point
target-excluded consensus edge.

- 2023 selection: 44 actions, 32-12, +9.219u, +20.95% ROI, +8.349u without the largest win.
- 2024 confirmation: 37 actions, 24-13, +3.887u, +10.50% ROI, +2.994u without largest win.
- 2025 confirmation: 66 actions, 42-24, +2.396u, +3.63% ROI, +1.486u without largest win.
- Pooled confirmation: 103 actions, 66-37, +6.282u, +6.10% ROI, +5.373u without largest win,
  mean CLV +0.236pp; weekly-cluster bootstrap P(positive units) 84.31%, ROI 95% interval
  -5.77% to +18.32%.

### Spread Lean

Frozen rule: corrected selected-side probability at least 51%, nonnegative EV, nonnegative
target-excluded consensus edge, and nonnegative expected-score cushion after key-number penalty.

- 2023 selection: 13 actions, 6-6-1, -0.351u, -2.70% ROI, mean CLV +0.154pp.
- 2024 confirmation: 12 actions, 8-4, +3.626u, +30.22% ROI, +2.626u without largest win.
- 2025 confirmation: 28 actions, 17-11, +5.146u, +18.38% ROI, +4.146u without largest win.
- Pooled confirmation: 40 actions, 25-15, +8.772u, +21.93% ROI, +7.772u without largest win;
  weekly-cluster bootstrap P(positive units) 95.08%, ROI 95% interval -3.52% to +48.13%.
- Limitation: confirmation selections were 37 home/3 away. The lane is retained as Lean, never
  Best Angle, and must be forward-monitored for side concentration.

### Total Lean

Frozen rule: team-score residual ensemble probability at least 53.5%, EV at least 2%, edge at
least 1pp, and score cushion at least one point after total-zone penalty.

- 2023 selection: 21 actions, 12-9, +2.022u, +9.63% ROI, +1.060u without largest win.
- 2024 confirmation: 23 actions, 12-11, +0.160u, +0.69% ROI; -0.793u without its largest win.
- 2025 confirmation: 72 actions, 38-34, +1.418u, +1.97% ROI, +0.438u without largest win.
- Pooled confirmation: 95 actions, 50-45, +1.578u, +1.66% ROI, +0.598u without largest win,
  mean CLV +0.126pp; weekly-cluster bootstrap P(positive units) 56.45% with a wide interval.
- The unrestricted Total head was slightly worse than neutral on 2024/25 Brier and log loss.
  Therefore only the frozen abstention subgroup is authorized as Lean; no Total Best Angle is
  authorized, and uncertainty is deliberately visible.

## Current authoritative Week 1 replay

Source: 128 append-only rows read; latest exact 16-game wave captured
2026-08-25T11:21:34.519Z; at least six comparable books per game; projected QBs 32, confirmed QBs
0. The replay was SELECT-only. Candidate publication/tracking remained false.

- Overall: **3 Best Angles, 12 Leans, 5 Watchlists, 28 No Plays** across 48 markets.
- Moneyline: 3 Best Angles, 5 Leans, 2 Watchlists, 6 No Plays.
- Spread: 3 Leans, 3 Watchlists, 10 No Plays.
- Total: 4 Leans, 12 No Plays.
- Versus current member behavior: 13 displayed-grade promotions, 0 demotions, and +7 actionable
  markets. Watchlist promotions are not counted as actionable.

Best Angles: CHI Moneyline -142 (DraftKings), MIN Moneyline -108 (BetRivers), and DAL Moneyline
-146 (FanDuel).

New Spread Leans: CAR +2.5 +102 (FanDuel), HOU +1.5 -112 (BetRivers), and WSH +4.5 -110
(Caesars). New Total Leans: NE-SEA Over 44.5 -105 (Fanatics), BAL-IND Under 48.5 -110
(BetMGM), BUF-HOU Over 44.5 -109 (Caesars), and DEN-KC Under 42.5 -107 (Caesars).

The existing five lower-tier Moneyline Leans remain. The five Watchlists are BUF Moneyline,
DEN Moneyline, TB +3.5, MIA +3.5, and MIN -1.5.

## Source integrity and limitations

- r8 tournament report SHA-256: `bc30851c0b9e610901d6e16780da3e5fae2ec548ae68a9c777213d6b2b85d787`.
- actionable correction artifact SHA-256: `b91d6fa90719dc3321666d59d65e845256f51fd8f365b6cffef8a03be288855b`.
- latest forward export SHA-256: `e18d1f0361b13ae94afa51d5eaa57680ed49ba95df0cc3d009ada656360ad0be`.
- 2024/25 are repeated confirmation, not pristine holdouts. The append-only 2026 opening,
  unlocked, T-60, and settlement stream remains the true forward holdout.
- SharpAPI has no strictly matched Week 1 row in this capture; Playbook splits remain correctly
  labeled and are never relabeled SharpAPI.
- Official tracking remains disabled until the approved regular-season boundary and valid T-60
  lock. No preseason result enters lifetime tracking.
