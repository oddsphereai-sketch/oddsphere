# Remaining sport-specific market-reading audit — result

## Decision

This audit does not introduce a generic market reader and does not activate an
accuracy-unproven forecast rule. WNBA, EPL, UCL, NFL, CFB, MLB, NHL, and the
live player-prop models retain independent sport/model ownership. Market and
split evidence remains source-aware, same-book movement remains distinct from
cross-book context, and an evaluated sportsbook cannot validate its own quote.

The only production behavior repaired here is deterministic truthfulness at
the NHL reader/tracking boundary. No forecast equation, projected score,
probability, selected side, exact-price decision, stake, or locked prediction
changes.

## WNBA spread arbitration

The live WNBA spread center is still 25% independent and 75% qualified
target-excluded market. A read-only, zero-provider-call replay covered 42
settled forward games. Removing that center produced:

- all games: margin MAE 11.8459 to 11.6244, but winner accuracy 33/42 to 32/42
  and spread accuracy 26/41 to 24/41;
- final chronological 14: margin MAE 12.3143 to 11.4713, winner 9/14 to 10/14,
  spread unchanged at 10/14; and
- active release only: eight games, margin MAE 9.9488 to 8.7833, winner 5/8 to
  6/8, spread unchanged at 6/8.

The fixed movement-plus-split correction could not be evaluated: 1,000 stored
archive rows yielded four games with source-aware split direction, zero with a
qualifying same-book movement direction, and zero corroborated flips. The
active-release sample is eight games. That is not enough evidence to replace
the production center or to claim a safer flip rule. WNBA therefore remains
unchanged. The audit script is
`scripts/operator/audit-wnba-independent-first-market-arbitration.ts`.

## Premier League movement arbitration

The incumbent independent Dixon-Coles model plus target-excluded Total
arbitration was compared with a predeclared same-book movement gate. On 30
settled forward captures:

- incumbent Total: 16/30, Brier 0.24878, Total MAE 1.63523;
- movement-gated: 15/30, Brier 0.25298, Total MAE 1.64582; and
- movement-resistance veto: 15/30, Brier 0.25118, Total MAE 1.64136.

The candidate worsened direction, probability quality, and score error. It is
rejected, so same-book movement remains captured and displayed for audit but
does not override the EPL forecast. The audit script is
`scripts/operator/audit-epl-same-book-movement-arbitration.ts`.

## Champions League

UCL retains its competition-owned independent regulation PMF. Market evidence
continues to determine price economics and grades, but does not alter the PMF
or projected score. The available settled archive contains 17 games / 56 rows
and at most one stored book capture per locked trail, so an authentic
target-excluded movement replay cannot be constructed. EPL's rejected rule is
not transferred into UCL, and later quotes are not reconstructed as earlier
evidence. Current readiness was 18 fixtures, 72 markets, 50 selected current
quotes, 129/180 outcome rows, and zero hard/coherence errors. This is an
evidence hold, not an assertion that a UCL movement flip is validated.

## Cross-model verification

- NFL Daily Edge: Week 5 held 15 games / 45 priced markets with complete
  trails and coherent r28 tuples. Release-pure r28 replay improved winner
  accuracy from 8/14 to 10/14 and spread direction from 6/12 to 9/12 without
  changing the grade-count surface.
- CFB Daily Edge: 86 games / 258 predictions were present; 55 games had split
  evidence, 44 had named-sharp evidence, and all 86 had quarterback context.
  The missing 96 exact prices were 31 FCS-only games plus ODU@APP across the
  three markets; predictions remained present rather than disappearing.
- MLB Daily Edge: both current games had all six market records and prices;
  named-book history and Playbook/SharpAPI split lanes were present. Total
  arbitration remained held where target-excluded breadth was insufficient.
- NHL Daily Edge: all nine current games / 27 markets were priced. The active
  r14 reader uses a sport-specific corroborated flip rule rather than generic
  weighting: independent/market conflict, at least two books at 54%+, a
  same-book move of at least one percentage point, and money plus tickets at
  55%+ with medium/high agreement. The rejected public-split nudge remains
  inactive because it worsened direction.
- NFL player props: Week 5 contained 1,534 decisions and 650 canonical member
  rows with zero projection/side contradictions. Target-excluded evidence and
  current release identity remained intact. No grade or side was changed here.
- MLB player props: the r43 board retained target-excluded reference evidence
  for 644 forecasts and balanced one promotion with one demotion. Telemetry now
  excludes home-run milestone contracts from ordinary line-side contradiction
  counts; those contracts are threshold events, not continuous projections.

## NHL reader and settlement repair

The NHL writer intentionally stores an actionable Lean as `model_only` with
`no_bet=false`, while tracking already translated that tuple to Lean. The
NHL member reader instead rebuilt the grade from the pre-price model verdict
and did not consume the writer's final token. Reader release
`nhl_daily_edge_reader_2026_10_06_r11_grade_tracking_parity` now renders the
price-aware writer-owned grade exactly: actionable NHL `model_only` is Lean, NHL
`model_only` with `no_bet=true` is No Play, and `best_signal` is Best Angle.
Other sports keep their existing meanings.

NHL puck line was already an official tracked `spread` market, but the UI and
stability auditor still treated it as context-only and the settlement service
did not grade it. The chip now renders `PL` without the obsolete asterisk, the
auditor follows the official registry, and settlement grades the immutable
selected-team score differential plus its signed line, including pushes.

The repaired code passed 252 Daily Edge route tests, 206 experience tests, 73
official-market registry tests, the NHL regular-model suite, and the new NHL
moneyline/Total/puck-line grading suite.

## Board impact and safety

Forecast promotions/demotions are 0/0 and model board counts do not change.
The NHL reader may expose already-authorized writer Leans and Best Angles that
were previously mislabeled; that is parity with tracking, not a newly computed
promotion. No copy, labels, provider calls, schedules, leases, stakes, model
inputs, or independent writers were added.

Four September 29 NHL Total rows remain pending because their immutable locked
records contain neither a line nor a price. They are not valid wagers and
cannot truthfully be graded win/loss. Converting exactly those four legacy rows
to void is a separate historical data mutation and requires explicit owner
approval; this release does not silently alter them.
