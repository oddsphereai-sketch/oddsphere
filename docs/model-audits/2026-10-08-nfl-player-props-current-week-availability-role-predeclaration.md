# NFL player props current-week availability-role predeclaration

Date: 2026-10-08  
Starting production base: `8756604e952879faa21ae886811bdc169ba725c8`  
Status: frozen before implementation or outcome inspection

## Decision question

Can point-in-time injury/practice status and teammate vacated-workload redistribution improve an
independent, market-free NFL player-props model enough to justify use for the current week rather
than waiting for a shadow-only observation window?

This experiment may affect no stored prediction, lock, grade, stake, reader, writer, schedule, or
member surface unless a candidate first passes the gates below and then completes the repository's
normal model-change release process. Existing locked payloads remain authoritative and immutable.

## Frozen candidate family

Use nflverse injury reports joined by season, week, team, and GSIS player identifier. Only statuses
published for that game week are eligible. The candidate may derive:

1. player report status: Out, Doubtful, Questionable, or no final designation;
2. final practice participation: DNP, Limited, Full, or unavailable;
3. same-team, same-role-group prior carry, target, pass-attempt, and snap share belonging to players
   designated Out/Doubtful/DNP/Limited; and
4. the active player's prior share, depth slot/rank, snap trend, and interaction with that vacated
   opportunity.

The candidate must forecast team opportunity, player share, and conditional efficiency separately.
It may redistribute opportunity only from teammates with a pregame status row for the same week.
Current-week results, offered prop lines, prop prices, market consensus, and movement are forbidden
features. Missing injury evidence remains missing and cannot mean healthy.

Markets are evaluated separately: Passing Attempts, Passing Completions, Passing Yards, Rushing
Attempts, Rushing Yards, Receptions, and Receiving Yards. Anytime Touchdown remains outside this
continuous/count-family experiment.

## Chronology

- train: 2016-2023;
- select the frozen feature/regularization variant: 2024;
- confirm once: 2025;
- final current-season decision set: exact immutable 2026 Weeks 1-4 locked scopes; and
- current Week 5 may be scored only after the variant is frozen and without inspecting outcomes.

Historical postgame workload is shifted by at least one completed game. Injury rows are inputs for
their listed game week, not outcomes. Realized participation may define the settlement-aligned
training population but is never a prediction feature.

## Immediate-use gates

A market is eligible for a production proposal only if all are true:

1. 2025 MAE and RMSE both improve over the previously selected independent candidate;
2. exact 2026 Weeks 1-4 MAE and RMSE both improve over the locked independent point and the published
   point on identical covered scopes;
3. directional accuracy does not regress, coverage is at least 90%, and every chronological week is
   reported separately;
4. the game-clustered 95% interval for candidate-minus-published MAE has an upper endpoint at or below
   zero;
5. a residual distribution fit without 2026 outcomes does not worsen Brier score or calibration gap;
6. current-week input coverage is complete enough to run the same feature contract without a silent
   fallback; and
7. paired promotions, demotions, total actionables, market mix, and locked-row immutability are proven
   before any production release.

Failing markets remain unchanged. Passing one market never authorizes another. No market information
may rescue an independent candidate that fails these gates.

