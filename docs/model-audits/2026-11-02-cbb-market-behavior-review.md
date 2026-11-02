# CBB observed-market decision review — November 2, 2026

Status: private candidate. No production prediction, grade, stake, lock, tracking
record, provider budget or database write has changed. The owner requested a
general board repair, not a Cornell-specific rule. No deployment exception has
been granted. Starting base: `d3366f168fa04272918297214cc09c21876f514f`.

## Confirmed production defect

The independent review replayed all339 unlocked ML/Spread/Total rows from113
games. Current release arithmetic and source orientation reproduced exactly,
but score r3 has no market inputs and grade r2 uses current professional price
direction only. A positive selected-side professional fair probability above
50% is not confirmation of value at the executable price. Movement, current
level disagreement and split flow must not be conflated. The original audit
found95 referenced actionable rows;88 had all professional fair probabilities
below executable break-even. That is a policy limitation, not88 matching bugs.

The candidate adds the predeclared whole-game market path to the sole existing
writer. One final law owns score, winner, line-specific probabilities, exact
target selection and grades. It preserves independent r3 and original source
receipts, excludes every target book family from score inputs, rejects opposed
relative sources and quarantines ambiguous source tuples from both score and
grade authority. Static winner arbitration needs same-book ML+Spread agreement,
fresh original clocks and no eligible opposing professional winner. No split
percentage creates invented points or identifies actual professional bettors.

## Same-board diagnostic, not outcome qualification

Current local capture: `2026-11-02T19:57:29.528Z`; prior capture: `2026-11-02T19:19:25.855Z`.
113 unlocked games /339 markets. All baseline grades, sides and EVs
reproduce their actual stored rows before the new candidate runs. No outcomes
are loaded or used to tune this policy.

| Grade | Existing | Candidate |
|---|---:|---:|
| Best Angle | 78 | 73 |
| Lean | 25 | 25 |
| Watchlist | 128 | 120 |
| No Play | 108 | 121 |

Promotions:0; demotions:5; net actionable change:-5.
Selected-side changes:10; static winner arbitrations:7;
relative margin applications:9; relative Total applications:10.
The tested confirming price/handle promotion has no qualifying instance in this
captured board; do not manufacture a promotion to offset observed demotions.

| Actionable demotion | Market | Before → after |
|---|---|---|
| Charlotte 49ers @ Indiana State Sycamores | spread | Best Angle → No Play |
| Ball State Cardinals @ Georgia Southern Eagles | spread | Best Angle → No Play |
| Gonzaga Bulldogs @ Purdue Boilermakers | spread | Best Angle → No Play |
| Kent State Golden Flashes @ Louisiana Tech Bulldogs | spread | Best Angle → No Play |
| Pepperdine Waves @ Cornell Big Red | spread | Best Angle → No Play |

Cornell illustration: old home margin +13.9398, final candidate home
margin -2.5106; projected Pepperdine 85.12 /Cornell
82.61. The current Circa ML and Spread both name Pepperdine;
the policy is symmetric and contains no team IDs/names. The target Cornell
spread becomes No Play because final-law exact-price EV is negative; the
previous independent projection is not overwritten in any locked record.

## Deterministic random spot checks

All339 rows were audited. Eight additional game views were selected by SHA256
of seed `cbb-market-review-20261102:GAME_ID`, before looking at outcomes. This
sample is not evidence of calibration and is not padded with favorable cases.

| Matchup | Winner arbitration | Margin path | Total path |
|---|---|---|---|
| Jackson State Tigers @ Texas Tech Red Raiders | unavailable | neutral | neutral |
| Siena Saints @ Bryant Bulldogs | not_needed | neutral | neutral |
| Saint Peter's Peacocks @ Seton Hall Pirates | unavailable | neutral | neutral |
| Long Beach State Beach @ Utah Utes | not_needed | neutral | neutral |
| Youngstown State Penguins @ St. Bonaventure Bonnies | not_needed | neutral | neutral |
| North Dakota Fighting Hawks @ Minnesota Golden Gophers | unavailable | neutral | neutral |
| UAB Blazers @ McNeese Cowboys | not_needed | neutral | neutral |
| La Salle Explorers @ Houston Cougars | unavailable | neutral | neutral |

The eight random cases have no net qualified change or no applicable winner
opposition. They correctly retain the independent law; they are not counted as
successful predictions. Every nonzero consequence is separately present in
the full local report.

## Evidence and reproducibility

`scripts/operator/audit-cbb-market-behavior.ts CURRENT_JSON PRIOR_JSON
FIXTURE_JSON REPORT_JSON` reads local files only. No network, provider requests
or production writes. Full339-row report and original quotes are retained in
the local evidence files below. Target receipt time was not stored in legacy
board rows: this diagnostic uses its decision time as an explicit upper bound,
never as a claimed provider receipt. Live integration uses actual fetchedAt.
The replay input key is diagnostic and does not attest news consumption.

| Local evidence | SHA256 |
|---|---|
| `/tmp/oddsphere-cbb-market-behavior-current-20261102.json` | `5b4dfb6cfc2e5fc123c31d73078f0e15d6d455c24f275bb80ffb5c60704ead59` |
| `/tmp/oddsphere-cbb-market-spotcheck-20261102/current-member-source.json` | `a89597607934633e4739ec2cb00acf8716ac1616dbc0d46bd03830c6d5abe64f` |
| `/tmp/oddsphere-cbb-r3-frozen-live-inputs-20261102.json` | `d6ac2f1f70c2a2aff1abc4201f82069a434e77ec1af6ee6124877fdcbfc00ca4` |
| `/tmp/oddsphere-cbb-market-behavior-board-impact-20261102.json` | `9f43a0d72476b53f17bc5cb81174ebae990ea3071bb7afd3ab48952f68ce93a0` |

## Validation and publication gate

Focused checks cover exact source clocks, vig/line compensation, union target
exclusion, arrivals, unchanged original anchors, statistical revision receipt,
idempotence, quarantine at score AND grade, source conflicts, no-tie/push
probabilities, paired promotion/demotion, static-policy discontinuity, static
override unable to promote a conflicting relative path, and exact fallback.
The actual member-pipeline mock proves one price/split request per existing
refresh, coherent score/selected side, no false movement from static disagreement,
and repeated-run stability. Writer/reader/settlement/tracking tests preserve
legacy locks and freeze future candidate locks with their actual release.

No held-out value/calibration cohort is available for these new rules. The
already-opened21-game historical diagnostic lacks paired movement receipts and
cannot qualify them. Static arbitration has an explicit sign-switch jump near
independent margin zero; relative transport assumes a unit economic response
and unknown information overlap. Functional tests do not prove either improves
betting results. R17/r18 remain rejected. Do not activate this candidate unless
the normal chronological qualification succeeds or the owner explicitly approves
a scoped provisional exception after reviewing these assumptions and counts.

If subsequently approved, publication still requires fresh main integration,
green required checks and exact tested tree, then production release/coherence/
coverage and normal cron verification. Capture all global locked payloads and
tracking tuples before deployment and compare them byte-for-byte afterward.
Do not invoke a second writer or add production shadow storage. A later rollback
must preserve the new locked model/grade resolver and original payloads while
switching only future unlocked decisions through a versioned forward change.
Do not blindly revert tracking support after candidate locks exist.
