# NFL player props Rushing Yards team-factorization predeclaration

Date: 2026-10-15
Status: frozen before execution; research only

## Why this test

The release-pure Week 5 loss ledger isolates two repeatable Rushing Yards errors: team opportunity
and conditional efficiency. The prior expected-role challenger forecasts a rushing budget separately
inside each position group, so it does not force quarterback, backfield, and receiver opportunity to
reconcile to one pregame team carry total. This test changes that architecture rather than retuning
the rejected expected-role or ordinary/explosive decompositions.

## Candidate

The challenger is fully independent of lines, prices, books, consensus, and movement. It predicts:

1. one team rushing-attempt budget from strictly shifted team, opponent, game-state, and weather
   features;
2. each player's conditional share of that budget from strictly shifted role, depth, availability,
   opponent, offensive-line/defensive-front, box, RYOE, time-to-line, and player-form features,
   normalized across the complete pregame rushing roster; and
3. conditional yards per carry from the same pregame player/matchup feature set.

The player share model is trained only on prior seasons. Participation probability is estimated from
pregame features; historical box-score participation is not injected into the test roster. For the
exact current-season offered replay only, the existence of the offered prop may establish that named
player as expected active, without consuming its line or price.

Two efficiency identities are finite and frozen: equal player-game weighting and rushing-attempt
exposure weighting. Each component is blended 25%, 50%, or 75% with the exact released independent
Rushing Yards point head, producing six candidate identities.

## Chronology and gates

- Training: seasons strictly before the evaluated season.
- Selection: 2024. A candidate must strictly improve both MAE and RMSE over the exact released head.
- Confirmation: 2025. The frozen 2024 winner must not worsen MAE or RMSE, must keep bias within one
  yard of the released head, must have an upper game-cluster bootstrap bound below zero for MAE
  delta, and must have no adverse fixed chronological segment.
- Current-season diagnostic: only a confirmed frozen identity may open the exact immutable 2026
  offered replay. It must not worsen MAE, RMSE, or offered-line direction.

Passing the point gates opens, but does not itself authorize, production parity and balanced
promotion/demotion review. Failure has zero live authority and zero board impact. Existing locks are
immutable in every outcome.
