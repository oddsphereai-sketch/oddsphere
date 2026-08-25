# NFL Player Props member-parity launch audit r1

Date: 2026-08-25  
Production base audited: `5daa25d4e0bdcea6739eca02543b76a15a6c9a17`  
Scope: member presentation and interaction parity only; validated NFL projection, calibration, exact-price decision, and grade math are unchanged.

## Product contract

| Requirement | MLB production behavior | NFL launch behavior / evidence |
|---|---|---|
| League navigation | Shared MLB/NFL pills with active state | Reuses `PlayerPropsLeaguePills`; the NFL pill remains exact-string feature gated until launch. |
| Product hierarchy | Slate summary, strongest reads, market exploration, full board | Top Rated, Our Model Read, Worth a Look, Markets, and Build Your Board use the real NFL member snapshot. |
| Reader placement | Centered 980px desktop modal; edge-to-edge `100dvh` mobile reader | Both sports now render through `PlayerPropReaderDialog`, including the same responsive dimensions and backdrop. |
| Open / close | Board selection opens; close control and backdrop dismiss | Shared reader adds close control, true-backdrop dismissal, Escape dismissal, body scroll lock, focus containment, and focus return for both sports. |
| URL / selected state | `reader` query identifies the selected prop and highlights the row | NFL accepts a validated `reader` key on server render, updates it with `replaceState`, removes it on close, and retains selected-row styling. |
| Filters | Market-first exploration, model signal filter, player search | NFL exposes market product cards plus market pills, exact grade filtering, and player/team/market search; choosing a market moves to the filtered board. |
| Exact-price read | Pick, book, exact offered price, projection/probability, market comparison, EV | NFL reader presents the frozen decision tuple, price observation time, model probability, independent market probability, probability edge, EV, and projection/TD lane. |
| Sport-specific evidence | MLB recent form, matchup, workload, and price ladder | NFL uses its equivalent role/participation, injury/roster timestamp, projection/TD opportunity lane, and exact-price ladder. Baseball-only research panels are not fabricated. |
| Availability / Held | Incomplete or unavailable offers do not masquerade as plays | Incomplete and no-independent-benchmark offers are excluded; genuine role/identity ambiguity is Held and audit-only. Coverage detail is member-accessible but collapsed. |
| Update / lock | Updated timestamps and explicit lock state in cards/reader | Header states current price time and T-60 policy; reader shows observed time, lock time/state, recomputation triggers, and the exact tuple frozen for tracking. |
| Responsive behavior | No horizontal page overflow; mobile reader owns the viewport | Browser QA at 1440x1000 and 390x844 confirms centered desktop and full-screen mobile reader geometry with 390px document width. |

## Exact frozen Week 1 board

- Best Angle: 1
- Lean: 0
- Watchlist: 10
- No Play: 21
- Held (audit-only): 2
- Member rows: 32
- Actionable rows: 1

The presentation change introduces no promotion, demotion, probability, projection, line, side, price, release, or tracking change.

## Launch sequencing

1. Keep `NFL_PLAYER_PROPS_ENABLED` and `NFL_PLAYER_PROPS_MEMBER_ENABLED` disabled through PR and deployment.
2. Apply and verify schema migration v39 before enabling either flag.
3. Enable the writer first, then wait for the normal leased `nfl-forward-evidence` cycle; do not manually invoke a provider, writer, or cron.
4. Verify the stored release tuple and member snapshot, then enable the member flag.
5. Verify the signed-in live board, reader deep link, counts, T-60 lock/tracking behavior, CLV attachment, and bounded settlement release.

Publication proceeds only through the protected PR workflow and only after the focused props suites, TypeScript, `verify:model-change`, webpack build, visual QA, latest-main diff audit, and integration safety pass.
