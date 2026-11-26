# NFL player props: longest pass predeclaration

Date: 2026-10-15

Status: research only; production and public actionability unchanged

## Question and chronology

Can an independent extreme-value model improve quarterback Longest Pass accuracy from passing opportunity, air-yards/YAC profile, quarterback aggressiveness and completion skill, receiver-production context, opponent pressure/coverage proxies, game environment, and role stability?

Fit on 2017-2024, select on 2025, refit through 2025, and score 2026 Weeks 2-5. Report the four quarterbacks in OddSphere's two archived Week 5 games separately. The private archive and market observer contain no Longest Pass offers, so economic and market-reader evidence is unavailable.

## Model boundary

The official outcome is the quarterback's maximum completed-pass yardage from play-by-play. The foundation combines prior longest-pass history with projected attempt volume and recent yards per attempt. Candidate ridge and shallow boosted models predict `log(1 + longest pass)` using only pregame features.

Eligible quarterbacks are determined by prior attempt volume/depth before the game; same-game attempts are never prediction inputs. Official participation is used only to settle the outcome.

Candidate features may include prior attempts/completions/yards, longest/explosive-completion history, team/opponent pass volume, position-neutral opponent passing allowance, air-yards/YAC context, NGS intended air yards/aggressiveness/CPOE/time to throw, PFR pressure/bad-throw context, FTN catchable/screen/contested context available at team/QB level, home/roof/wind/temperature, and depth/role. Sportsbook data and receiver-route fields are excluded.

Threshold probabilities at 29.5, 34.5, 39.5, 44.5, and 49.5 yards use a log-residual distribution estimated only from pre-test residuals.

## Selection and gate

Select on 2025 MAE, then RMSE, then average threshold Brier. On 2026 the winner must improve MAE, RMSE, average threshold Brier, and at least four of five threshold Brier scores versus the foundation. A paired game bootstrap quantifies uncertainty.

Passing cannot authorize production without prospective exact-offer/price capture and a versioned product path. No live release, grade, stake, writer, reader, or public page changes.
