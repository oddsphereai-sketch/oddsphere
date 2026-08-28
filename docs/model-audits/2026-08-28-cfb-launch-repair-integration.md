# CFB launch repair integration

Date: 2026-08-28

Status: integrated production candidate; protected publication and natural-cycle verification pending

## Scope and ownership

- Dedicated worktree: `/private/tmp/oddsphere-cfb-launch-repair-20260828`
- Starting production base: `919e00613f1fa2274ef47922719c243df04ebc4b`
- Sole recurring write path: `runCfbForwardEvidenceWriter` under the existing
  `prediction_pipeline:cfb` lease.
- No production provider, cron, writer, or database mutation was manually
  invoked during diagnosis. Provider checks were bounded and read-only;
  immutable evidence checks were SELECT-only.
- Exact-price ingestion/member repair and the r18 outcome/Sharp-split research
  lane were isolated in separate clean worktrees, then integrated by clean
  commit handoff.

## SJSU-USC exact-price failure and repair

SharpAPI exact event
`ncaaf_sanjosestatespartans_usctrojans_2026-08-29_b2` contained coherent
two-sided Spread and Total markets. The r2 normalizer rejected every
provider-labeled alternate before it could test exact-line coherence, so a
one-sided Moneyline gap incorrectly left all three member markets without an
evaluated quote.

The r3 fallback preserves the main-line path and admits a provider-labeled
paired alternate only per market when:

1. no qualified target main-line cohort exists;
2. the candidate is within one Spread point or two Total points of the
   dominant conventional main market;
3. the exact line contains one supported target and at least two distinct
   conventional non-target books;
4. both opposing sides are active, non-stale, non-live, exact-line pairs; and
5. the market is Spread or Total. Moneyline alternates remain forbidden.

No price, side, line, or sportsbook is synthesized. Consensus books remain
context-only. Per-market observation timestamps are persisted so a later
Total poll cannot make a Spread quote appear newer.

Fresh strict evidence recovered:

| Market | Exact evaluated sportsbook tuple | Exact corroboration | Result |
| --- | --- | --- | --- |
| Spread | BetMGM SJSU +39 -108 / USC -39 -110 | Goldrush and Pinnacle at 39 | SJSU +39 No Play; model 48.4308%, fair 49.7404%, edge -1.3095pp, EV -6.6547% |
| Total | BetMGM Over 60.5 -108 / Under 60.5 -110 | Bally and Rebet at 60.5 | Under 60.5 Best Angle; model 56.9297%, fair 49.0961%, edge +7.8336pp, EV +8.6840% |
| Moneyline | no coherent two-sided target/consensus tuple | none | operational No Play; Spread and Total remain published |

Board impact versus the latest 216-row immutable wave captured at
2026-08-28T11:54:03.560Z:

- Before: 1 Best Angle / 4 Lean / 6 Watchlist / 10 evaluated No Play /
  3 unavailable.
- After exact-price repair: 2 Best Angles / 4 Lean / 6 Watchlists /
  11 evaluated No Plays / 1 unavailable.
- One actionable promotion (SJSU-USC Total), one unavailable-to-evaluated
  No Play recovery (Spread), zero demotions, and zero changes to the other 21
  exact-price tuples.

## Prediction and grade coherence

The active r18 public outcome contract uses the frozen generic
market-informed residual joint PMF as the primary score/winner axis and keeps
the existing football-only PMF visible as secondary evidence. Exact-price
decisions remain bound to the existing football-only/calibration/consensus
axis and are byte-identical before versus after r18.

- Hawaii at Stanford: primary Stanford 26.4-22.4, Stanford 60.5%; secondary
  football-only Hawaii 27.2-19.4, Hawaii 67.3%.
- NC State at Virginia: primary Virginia 27.8-23.8, Virginia 60.6%. UVA -177
  is a price No Play while UVA -4 -109 is a Lean; both exact tuples retain
  their original probabilities, EVs, and thresholds.
- SJSU at USC with the recovered exact anchor: primary USC 50.6-11.5,
  USC 99.5%, reachable final SJSU 12-USC 51.

Across the eight-game replay, primary team scores span 11.50-50.57 with SD
9.71; margin SD is 12.96 and total SD is 4.98. PMF mass, decimal expected
points, margin, total, winner, reachable final, and market-line probabilities
are computed from their respective single joint distributions. r18 causes
zero grade promotions and zero demotions.

## SharpAPI NCAAF splits

The endpoint is supported. A bounded one-request audit returned 11 complete
DraftKings events across all three markets, refreshed about every five
minutes. Strict league/team/date matching found 0/8 Saturday matches at the
audit time because every returned row was a Friday event.

The sole writer now performs one bounded league-level request, persists only
strict exact-game matches, and isolates request failure or upstream
not-yet-published coverage as context warnings. Circa rows are eligible for
the existing Sharp Book Splits section; DraftKings rows remain
`public_recreational` and are never relabeled as sharp. Playbook public
consensus remains a separate section and is never substituted for SharpAPI.

## MLB reader parity

The integration reuses the established shared reader rather than adding a
football dashboard. Weekly cards, selected-edge interaction, three-column
reader hierarchy, responsive/mobile behavior, common grade ladder, exact
price/movement trail, split panels, and T-60 states remain shared. Quick Read
places the one-decimal primary score and winner first, the reachable final
second, and the football-only baseline in the existing projection note. Five
football-specific drivers remain visible; deeper verified rows stay inside
the existing expandable evidence control.

## Release and verification gates

Active candidate releases are recorded in `docs/current-model-releases.md`.
Completed on the integrated candidate:

- full focused CFB production suite, including PMF, exact-price, strict split,
  weekly engine, member, tracking, and source-boundary tests;
- shared Daily Edge experience suite: 176 passed / 0 failed;
- TypeScript `--noEmit`;
- task-owned ESLint scope;
- `npm run verify:model-change` across the repository; and
- `npm run build -- --webpack`, including 105 static pages and all dynamic
  routes.

The repository-wide `npm run lint` command remains red on the production base
with 1,296 existing errors and 247 warnings in unrelated admin, API, legacy
test, and research files. No task-owned file contributes an error; the scoped
lint is clean. Integration-safety, protected-PR, natural-cycle, and signed-in
live-reader results remain required before this status becomes live.
