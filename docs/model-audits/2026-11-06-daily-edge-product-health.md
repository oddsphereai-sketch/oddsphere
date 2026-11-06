# Daily Edge product health — November 6, 2026

Starting production base: `b90da4d94c91948821dc72894fd741f181dae92d`.
Scope: every Daily Edge sport with a game on November 6 in America/New_York,
including the separate football and soccer weekly publications. Read-only
captures precede the repair. Provider reads are bounded; there is no fitting,
outcome backtest, new writer, additional schedule or grade-count target.

## Captured coverage

The authenticated production audit captured the actual member boards at about
12:45 UTC. Its rolling view contains 491 games / 1,501 core market slots, with
zero critical source-chain/price audit findings and 126 missing-price warnings
on later games. This older generic check is not a certificate of input or
forecast completeness. The sport-specific checks below are authoritative for
the additional coverage and interpretation questions.

| Sport | Games today | Core market slots | Priced slots |
| --- | ---: | ---: | ---: |
| CBB | 59 | 177 | 174 |
| NBA | 9 | 27 | 27 |
| NHL | 3 | 9 | 9 |
| CFB | 5 | 15 | 15 |
| Premier League | 1 | 3 | 3 |
| Total | 77 | 231 | 228 |

EPL Double Chance is separately present, coherently derived and priced; its
existing monitoring-only No Play policy remains unchanged. MLB, WNBA, NFL and
UCL have no November 6 game in these publications. They are not silently
counted as missing prediction rows.

CBB canonical schedule reconciliation: 72 fixtures comprise 58 contextual
forecasts, one supported newcomer/program-prior no-wager card, and 13 exact
cross-division exclusions under the existing scope policy. The newcomer owns
the three unpriced/nonactionable slots above. These are not 13 lost provider
fixtures or permission to publish invented prices. All 174 contextual market
slots passed probability, exact-price and grade-risk checks; 68 positive-value
risk assessments were independently reconstructed without refitting.

## Statistical freshness and normal writers

- NBA: all 30 BBR 2027 regular-season ratings refreshed at 11:30:22 UTC;
  123 current-season professional game/box inputs include both November 5
  canonical finals, captured at 11:30:22 UTC. The current writer loads these
  inputs into the existing point-in-time feature builder before publication.
  BBR end-year 2027 and provider start-year 2026 are different correct keys.
- NHL: current-season 2026 team and goalie statistics refreshed at 11:47:10
  and 11:47:17 UTC. The 12:18 prediction records precede the 12:30 member
  publication; the exact stored receipt hashes, scores and all nine market
  probabilities reproduce under the current R30 model with zero differences.
- CBB: the R4 current-season receipt updated at 09:32:33 UTC and contains
  192 core and 77 separately identified cross-division completed games,
  including the previous night's latest verified venues/boxes. The normal
  contextual publication is as of 12:32:42 UTC and completed at 12:37:57.
- CFB: the current advanced-state receipt refreshed at 12:15:15 UTC, with
  624 completed games through the early Week 10 games. Each of today's ten
  teams has eight completed games in that source, with exact team identities;
  Virginia Tech's latest is Week 8, the other teams' latest is Week 9.
  Weather, availability, projected-versus-confirmed quarterback status and
  actual market clocks remain separate evidence. All 15 stored forecast/
  decision/publication tuples and push-aware exact-price EV calculations match.
- EPL: the normal 12:37 publication contains the current provider-stat sample
  and a coherent joint goal law for Match Result, Total, BTTS and Double Chance.
  Independent review checks the current match and all four contracts separately.

The Odds API is active in production. The 12:12 NBA diagnostics report one
request / three credits, 17,641 remaining credits, and 27 additional paired
Hard Rock offers on today's nine games. The seven-game / 21-scope warning is
for November 7, not today's prices. No local audit request was made when the
local backup credential was absent; production diagnostics are not proof of
local environment parity or of the unoffered future provider catalog.

Normal CFB, NHL and EPL refreshes complete successfully. CBB's partial status
identifies only later incomplete evaluations 10882890, 10882999 and 10883069;
none is a November 6 game. Deferred source-history backfill is reported
separately from current quote coverage and must not be described as a complete
historical tape. No stale-run/lease bypass or competing prediction writer was
introduced by this audit.

## Market interpretation and confirmed repairs

Independent reviewers inspect the stored source paths, composition clocks,
counterevidence and final decisions. Prior exposure to the methods and early
schema previews is disclosed; this is not blind forecast validation.

The NBA review covers all nine games / 27 core markets, NHL all three / nine,
EPL its current match plus Double Chance, CFB all five / 15, and a diverse CBB
sample alongside the whole current-day numerical check. A selected execution
book need not equal the separately named movement-reference book. Opposing
evidence does not automatically require a side flip; the exact stored causal
receipt determines whether it authors a score consequence, tempers conviction,
or remains unresolved/context-only.

One concrete source-admission defect and two presentation defects are repaired:

1. The exact current provider spellings N Colorado, SC State, Miss Valley St
   and MTSU failed institution identity. A single bounded Owls response at
   12:59:52 UTC proves fresh Circa Moneyline/Spread/Total pairs for Northern
   Colorado at Arizona State, plus valid retail context on the other three
   games. Exact aliases restore those inputs; Colorado State, South Carolina,
   Mississippi State and Tennessee remain distinct institutions. The input
   contract advances to source R7 / assembly R5 / publisher R44. Fitted model
   coefficients and the recommendation method are unchanged; corrected actual
   inputs may change future scores, probabilities, predictions and grades.
   Freshly discovered data retain their actual availability and cannot enter
   a claimed 12:32 forecast replay or any previously locked payload.
2. NBA economic rationale claimed there was no qualified opposition before
   final named-book posture was applied. Four current market explanations
   contradicted that claim, and all nine game summaries incorrectly said no
   data despite stored book evidence. Current summaries and warnings must use
   the actual matching posture; value by itself does not prove sharp support.
3. CFB's current recommendation summary treated explicitly stale split rows
   as current directional pressure even though its writer correctly rejected
   their current authority. The repair retains the original historical rows
   and source clocks, describes older context explicitly and interprets current
   price response independently. Legacy/locked interpretation remains exact.

## Explicit limits and follow-up findings

CBB's captured mix is 53 Under selections and five Over selections, with all
31 actionable Totals on Under. The other actionables are two spreads and one
moneyline. This is a real method-concentration finding, not a reason to impose
a side quota or manufacture more Over plays. Arithmetic and grade-application
checks do not establish that this concentration is predictively correct.

The actual provider response is reconciled against the 22 current-day games
without admitted professional prices. One has the identity defect above;
three further alias failures have retail-only context, and the remaining
18 have matched retail events without Circa/Pinnacle quotes in that capture.
This is bounded source-specific evidence, not proof that no other provider
could have a market. Four older admitted professional streams also lack fresh
same-market pairs in that response. Their original timestamps and last-known
status remain; receipt freshness cannot substitute for new economic movement.

Outside today's slate, UCL's strength request is returning HTTP 403 and its
Kalshi source receipt is rejected as invalid/old. Those remain explicit
off-day operational findings; no all-sport green-health claim is made.

## Publication and immutable-record verification

Before publication, focused CBB/NBA/CFB/current-split tests, full model verification,
type checking, lint, build and latest-main integration safety must pass. The
NBA/CFB same-input explanation comparison must show zero promotions, demotions,
score, probability or executable-price changes; the CBB input repair reports
its actual effects separately. Pre-repair baselines contain 48 locked NBA
records across 16 games, 191 locked CBB member payloads/570 tracking rows, and
three locked CFB member DTOs/nine tracking rows. They must remain exact after deployment.
Normal production refresh and member read verification remain required before
describing the repairs as live.
