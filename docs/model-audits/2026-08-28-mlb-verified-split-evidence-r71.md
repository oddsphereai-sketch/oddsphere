# MLB verified split evidence r71

Date: 2026-08-28
Candidate: `mlb_daily_edge_decision_2026_08_28_r71_verified_split_evidence`
Base: `debcf28e34b8b6dff4d69a20c5f8f71ff5d2f972`

## Outcome

The reported 100% tickets / 100% money behavior is a confirmed evidence-
quality defect. Fresh SharpAPI/Circa payload rows contained exact 1.0/1.0 on
one side and 0.0/0.0 on the other, but no ticket count, handle sample size, or
other sample field existed in the raw or canonical observation. The same
values propagated into `market_split_observations_v2`, `sharp_signals`, and
`public_splits_observations`; the reader's complement score then labeled them
complete.

r71 treats an exact endpoint as unavailable unless a verifiable sample count
exists. Current schemas carry none, so the field fails closed. The other field
remains usable when it is a valid non-endpoint percentage. No 50% fallback,
opposing-side complement, provider blend, or relabeling is permitted.

## End-to-end boundary

The same rule is applied to:

- current and history SharpAPI canonical split adapters;
- the SharpAPI `sharp_signals` mapper;
- MLB last-known-good carry-forward, including already-persisted endpoints;
- SharpAPI and Playbook provider-separated observation mirrors;
- unlocked Moneyline/Total grade inputs and future lock snapshots;
- dual-provider resolution and display overlay;
- source-aware and legacy MLB reader evidence, including old locked snapshots.

Locked prediction and bet tuples are not rewritten. Price, line, probability,
projected score, action, stake, tracking, T-60, and settlement contracts are
unchanged.

## Frozen board impact

SELECT-only replay of the same 2026-08-28 inputs produced 45 records:

| Grade | Before | r71 |
| --- | ---: | ---: |
| Best Angle | 2 | 2 |
| Lean | 16 | 15 |
| Watchlist | 12 | 12 |
| No Play | 15 | 16 |

- Promotions: 0
- Demotions: 1
- TEX@MIL Moneyline: Lean to No Play. The retired Lean came from
  `ml_market_led_toward_move_playable_price_lean_v2_2026_08_12` because an
  exact 0/0 tickets/money pair passed its gap-under-10 check.
- Every valid current Best Angle and every other actionable grade is retained.
- The paired positive path remains tested: the same existing market-led rule
  still promotes a qualifying unchanged side with valid non-endpoint SharpAPI
  percentages, and now explicitly rejects endpoint evidence.

Live inputs continued to refresh after the frozen comparison. The final r71
dry run remained 45/45 with 2 Best Angles / 15 Leans / 12 Watchlists / 16 No
Plays and no held/skipped market.

## Odds, lines, and model inputs

The independent SELECT-only health checks found:

- 15/15 scheduled games; 15/15 V2.2 ready; 15/15 FI V2 ready;
- preferred team OPS, bullpen, starter ERA, handedness, and park inputs for all
  30 team sides; real fallback pitch-quality inputs for all 30;
- lineups not yet announced for the slate, represented honestly rather than
  treated as stale;
- 781 current named-book line rows across 20 books;
- zero games/markets without a coherent two-sided named-book board;
- zero evaluated price outliers beyond five implied-probability points from
  the exact-line multi-book center;
- raw alternates detected at Rebet (COL-ATL total 5.5), theScore (ARI-SF 8.5),
  and Hard Rock (1.5/2.5 first-inning totals). The member response retained the
  consensus main totals (COL-ATL 8.5, ARI-SF 7.5) and the existing 0.5-run FI
  contract; none of the alternates entered an evaluated tuple.

The reconstructed full reader returned 15 games, no coherence issues, no
limited price markets, 24 complete valid Sharp sections, and six honest
`provider_limited` sections after endpoint evidence was withheld.

## Releases

- Decision: `mlb_daily_edge_decision_2026_08_28_r71_verified_split_evidence`
- Rule bundle: `mlb_daily_edge_rule_bundle_v59_verified_split_evidence_2026_08_28`
- Grade policy: `mlb_public_grade_policy_v49_verified_split_evidence_2026_08_28`
- Correction policy: unchanged
  `mlb_prediction_corrections_v22_coherent_near_edge_watchlist_2026_08_26`
- Member presentation:
  `daily_edge_member_presentation_2026_08_28_r9_verified_mlb_split_evidence`

## Validation

Passed before publication:

- split evidence quality unit tests;
- SharpAPI pure split mapping tests;
- market-intelligence V2 tests;
- prediction-record service tests, including valid promotion and endpoint
  rejection;
- public-splits resolver and display-overlay tests;
- full Daily Edge route tests, including MLB-only and non-MLB parity cases;
- current writer dry run, model readiness, feature coverage, odds health, and
  full reader coherence audits;
- `npm run verify:model-change`;
- `npx tsc --noEmit`;
- `npm run build -- --webpack`;
- `git diff --check`;
- `node scripts/verify-integration-safety.mjs --base-ref=origin/main`, proving
  the committed candidate contains current `origin/main` `debcf28e34b8` with
  no overlapping uncommitted worktree changes.

Protected PR checks, natural-cycle confirmation, and signed-in production QA
remain publication gates and must be appended only after they complete.

## Rollback

Rollback is r70/v58/v48, correction v22, and shared member presentation r8.
Do not restore endpoint rows as complete evidence; if r71 must be rolled back,
the split panels must be disabled until a safe replacement is deployed.
