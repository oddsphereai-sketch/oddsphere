# CFB FBS-first member board r39

Date: 2026-08-29

## Result

The CFB member board now opens on every FBS-involved game and keeps every model-covered Division I
forecast behind an explicit **All Division I** control. A direct link to an FCS-only game opens the
complete scope, so this presentation repair does not hide or delete a forecast.

The audited all-Division-I fixture remains 38 games / 114 market slots with 35 evaluated exact-price
tuples and 79 explicit unavailable states: **5 Best Angles / 2 Leans / 11 Watchlists / 17 evaluated
No Plays**. The default 8-game FBS-involved view contains 23 evaluated exact-price tuples and one
explicit unavailable state: **2 Best Angles / 2 Leans / 9 Watchlists / 10 evaluated No Plays**.

Compared with the same fixture before the scope change, there are zero tuple additions or removals,
zero side changes, zero grade promotions, zero grade demotions, and zero net actionable change. The
scope metadata is derived from the existing resolved team identities; no model or provider input is
added.

## Verification

- `npm run test:daily-edge-experience`: 184 passed / 0 failed.
- `npm run test:cfb-v1-production`: passed.
- `npm run verify:model-change`: passed, including CFB PMF coherence, exact-price decision,
  generalized weekly coverage, provider identity, one-writer/lease, and market-scoped T-60 gates.
- `npx tsc --noEmit`, focused ESLint, and `git diff --check`: passed.
- `npm run build` under Next.js 16.2.6: passed, including production TypeScript and all 105
  generated static pages.
- Live-data desktop QA confirmed the 8-game / 24-prediction FBS default, the 38-game /
  114-prediction all-Division-I control, exact game/grade counts, and the populated UNC-TCU
  reader. The repository's fixed 390 x 844 device frame confirmed the responsive FBS default,
  scope controls, grade filters, and all eight FBS-involved game cards without horizontal escape.
- Post-deployment production verification is recorded in the pull request handoff.

## Safety and rollback

- Model, probability, calibration, decision, tuple, grade, provider, cadence, writer, lease,
  tracking, settlement, and T-60 releases are unchanged.
- Fixture advances to `cfb_v1_member_fixture_2026_08_29_r26_fbs_board_scope`.
- Shared presentation advances to
  `daily_edge_member_presentation_2026_08_29_r17_cfb_fbs_default_board` with board-scope release
  `cfb_member_board_scope_2026_08_29_r1_fbs_default`.
- Roll back fixture r26 to r25 and presentation r17 to r16. All evidence remains append-only.
