# CFB market-dominant fresh-sharp forecast result

Date: 2026-08-30

Status: live candidate; publication and natural-cycle proof pending

## Candidate

The candidate implements the predeclared forecast without an outcome-specific rule:

- 25% immutable independent-football PMF / 75% canonical current-market PMF;
- Circa-only sharp adjustment observed at or before evaluation and at most 120 minutes old;
- Spread and Total split-line tolerance of 0.5 points;
- signed money-minus-ticket threshold above 10 percentage points, full strength at 20 points;
- maximum 1.5-point pre-mixture home-margin or Total anchor adjustment;
- no separate opening-to-current adjustment because the current market anchor already contains
  that movement.

There is no new provider request, writer, cron, table, stake path, reader override, or historical
rewrite. The existing leased CFB writer remains the sole authority.

## Evidence basis

The frozen 2023-2025 synchronized audit found that the active independent-heavy mean blend had
higher Total and Margin MAE than the market benchmark in every reported season. The owner
explicitly directed that this historical evidence be combined with mechanism checks and forward
natural-cycle evaluation rather than treated as the only advancement threshold.

The candidate is not represented as a hindsight fix for Aug. 29. Its locked SELECT-only replay
does not reverse Totals mechanically and does not turn yesterday's outcomes into model inputs.

## Aug. 29 same-board replay

The SELECT-only replay used eight FBS-involved games and 17 priced markets from immutable pregame
evidence. It made zero provider calls and zero writes.

- r42 grades: 0 Best Angles / 3 Leans / 10 Watchlists / 4 No Plays.
- Candidate grades: 0 Best Angles / 2 Leans / 7 Watchlists / 8 No Plays.
- Side changes: 2.
- Promotions: 0.
- Demotions: 4.
- Net actionable change: -1.
- Strict Circa reads: 7 priced markets.
- Same-book movement reads: 6 priced markets.
- Maximum absolute probability change: 24.566 percentage points.

The largest direction correction was Hawaii-Stanford Moneyline, which changed from Hawaii to
Stanford as the market-dominant PMF overruled the independent head. NMSU-FSU Total changed from
Under to Over; because the final was 51, that counterfactual would have changed the lone r42 Total
win into a loss. That adverse fact is retained explicitly: the candidate is a structural
market-accuracy change, not a claim that market dominance would have repaired every Aug. 29 pick.

The one-action reduction is disclosed rather than hidden. No grade threshold changed; probabilities
moving toward the market caused the smaller board.

## Verification

- focused CFB production suite: pass;
- shared Daily Edge member experience: 184 passed, 0 failed;
- TypeScript: pass;
- touched-file lint: 0 errors, 0 warnings;
- `npm run verify:model-change`: pass;
- Webpack production build: pass;
- diff check: pass.

Publication still requires a clean commit, fresh `origin/main`, integration safety, protected PR,
green required checks, exact remote-tree proof, deployment proof, and natural unlocked/T-60 live
verification. Roll back to r42 on mixed release identifiers, stale/future sharp influence, writer or
reader failure, missing price coverage presented as a normal evaluation, or tracking incoherence.

