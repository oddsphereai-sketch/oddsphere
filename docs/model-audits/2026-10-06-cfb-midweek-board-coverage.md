# CFB Tuesday/Wednesday board coverage

Date: 2026-10-06

## Defect

The authoritative CFB schedule provider published three FBS games before the Thursday start of the
existing product window: Southern Miss at Troy on Tuesday, plus Jacksonville State at Kennesaw
State and New Mexico State at Florida International on Wednesday. The prior weekly selector was
Tuesday-anchored but admitted only Thursday through Monday, so all three verified games were
excluded before the independent model, market collector, lock and tracking lifecycle could run.

## Repair

The product window is Tuesday through Monday Eastern. Its provider query retains the existing
one-day UTC guard after Monday, so the maximum date range remains eight dates and no additional
writer, schedule, request loop or lease is introduced. Sunday overlap still begins five days after
the Tuesday start, preserving the current Sunday/Monday tail while seeding only the next adjacent
window. The sole writer remains protected by `prediction_pipeline:cfb`.

The independent score model, joint PMF, market-reading arbitration, exact-price grade equations,
stake, UI copy, labels and layout are unchanged. Newly included games must travel through the same
price/split fallbacks, coherent three-market publication, T-60 refresh, immutable lock and official
tracking contracts as every other FBS game.

## Required acceptance evidence

- Deterministic weekly-window tests prove all three midweek games are eligible and Sunday overlap
  still exposes exactly two adjacent complete windows.
- A zero-write production-provider replay must include all three games, three markets per game, one
  coherent final score/side tuple, and report the exact provider-call ceiling and board-grade impact.
- Full model-change verification, production build, current-main integration safety, protected PR
  checks, and post-deploy live writer/reader verification are required before completion.
- Prior locked games remain immutable. If the expanded window removes an existing game, creates a
  mixed release, exceeds bounded provider pagination, flattens the board, or breaks lock/tracking,
  roll back the r5/r45/r98/r71/r31/r16 family without rewriting prior locks.

## Candidate evidence

- BALLDONTLIE's October 6-12 schedule returned all three exact events. Jacksonville State at
  Kennesaw State and New Mexico State at Florida International had complete two-sided main markets.
- Playbook independently returned complete spread, Total and Moneyline context for all three games,
  including Southern Mississippi at Troy at Troy -10.5, Total 51.5 and -430/+330 at capture time.
- The zero-write live-provider writer replay built 89 games: three opening-stage additions plus the
  existing 86 unlocked games. It produced 166 evaluated and 101 price-held market rows, zero capture
  failures, and 93 maximum provider calls.
- The candidate board remained actionable: 12 Best Angles, 77 Leans, 66 Watchlists and 11 evaluated
  No Plays, or 89 actionable markets versus 88 on the immediately preceding live board. No grade,
  prediction or market-reading rule changed; the count difference comes from admitting the omitted
  games and ordinary fresh provider evidence.
