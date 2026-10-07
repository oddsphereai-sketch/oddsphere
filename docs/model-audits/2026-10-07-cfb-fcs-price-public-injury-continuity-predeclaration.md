# CFB FCS price and public-injury continuity — predeclaration

Date: 2026-10-07

## Owner direction

Restore real lines and line-specific predictions wherever the current CFB board has a covered game but the paid/provider hierarchy is incomplete. Add a no-cost injury fallback behind the existing paid source, preserve the current member design, preserve locked rows, and do not add copy, labels, writers, schedules, or polling loops.

## Frozen scope

- Preserve explicit source priority for each refresh: BALLDONTLIE paid books, then exact-event SharpAPI named-book quotes within a bounded 32-game writer budget, then CFBD. A lower tier may fill absence but may not replace a higher-tier observation from the same named book; stored last-known evidence remains available across temporary omission and a later higher tier silently resumes authority.
- Add one bounded CollegeFootballData season/week line read for FCS-only coverage gaps no more often than every six hours. Accept only uniquely matched exact-date, ordered-team games and named DraftKings/Bovada rows. CFBD may contribute real current Moneyline pairs and retained provider opening/current Spread and Total line context; it may not fabricate the Spread/Total prices that its REST response does not contain. The projected maximum is 124 calls in a 31-day month, below 13% of the 1,000-call free-tier allowance.
- Permit SharpAPI's exact-event Novig and SX Bet pairs to restore line-specific context only when conventional sportsbook coverage is absent. These exchange rows may not enter sportsbook consensus, the market anchor, exact-price grading, actionability, movement arbitration, or opening-price authority. Kalshi remains excluded because provider rows have exhibited inverted team sides; Polymarket remains excluded because question-shaped identities are not equivalent to a conventional game market.
- Add only officially published conference availability reports behind the existing Playbook injury authority. Accept exact game/team/player/status rows from conference-operated pages. A missing team or player never means healthy. Playbook retains precedence; a later omission or failed official read cannot erase the newest stored verified report. Covers was evaluated and rejected because its published terms do not permit this commercial reuse.
- Official conference reports are continuity/display evidence in this release only. They do not select a quarterback, alter a projection, or cap a grade; existing paid Playbook evidence retains its current model behavior until a release-pure paired-promotion validation justifies expanding model input authority.
- Permit a complete verified single-book Spread/Total pair to supply line-specific context for an otherwise unpriced covered FCS game. The independent forecast remains primary; a single fallback book does not create target-excluded consensus, a Best Angle, a Lean, or synthetic economics.
- Continue to apply the existing expected-quarterback replacement and grade cap only to paid Playbook evidence when the listed QB can be matched uniquely to the exact team's active quarterback roster. Do not introduce an unvalidated generic injury-point adjustment.
- Persist the complete selected matchup injury report in the existing CFB evidence/member snapshot so the existing injury panel can render real rows without a new client-side provider request.

## Explicit non-goals

- No fabricated odds, consensus prices, injury clearances, replacements, splits, movement, grades, or stakes.
- No SportsJaw, betting-exchange, prediction-market, article, search-result, or anonymous consensus quote may become a grading input.
- No change to the independent model coefficients, PMF, market-reading formulas, grade thresholds, stake rules, lock timing, settlement, or tracking definitions.
- No change to any immutable prior lock.
- No new writer, cron, database loop, lease, member copy, label taxonomy, or layout.

## Acceptance criteria

1. Parser contracts reject wrong season/week, wrong ordered teams, ambiguous identity, unsupported CFBD books, non-SRADAR public rows, nonstandard markets, incomplete pairs, incoherent opposing lines, malformed prices, oversized bodies, and post-kickoff quotes.
2. The exact current-board replay reports before/after Moneyline, Spread, and Total price coverage and line-specific prediction coverage by `fbs_involved` and `fcs_only`.
3. Every changed prediction/side/grade is enumerated. Actionable promotions and demotions are paired and board-count impact is reported. The expected result is no promotion created from the single-book fallback.
4. Existing FBS rows, prior locks, release-separated tracking, the sole `prediction_pipeline:cfb` lease, and provider request ceilings remain intact.
5. Official-conference failure and omission preserve last-known verified evidence with its original timestamp. Playbook evidence wins when present.
6. Focused parser/writer/member tests, `npm run verify:model-change`, integration safety, protected PR checks, and post-merge natural-cycle release/coverage/reader verification pass before the change is called live.

## Rollback

Roll back the complete CFB release family and both bounded provider collectors together. Never reconstruct or relabel an immutable lock during rollback.
