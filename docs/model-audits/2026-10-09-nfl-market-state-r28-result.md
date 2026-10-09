# NFL Daily Edge market-state identity r28 result

Status: production candidate; publication requires protected-PR checks and explicit owner approval.

Date: 2026-10-09

Production base: `41cb2fc88d6c601d77a4932dbb1adcd1aaebfd93`.

Predeclaration: `docs/model-audits/2026-10-09-nfl-market-state-r29-predeclaration.md`.

## Decision

Advance only the market-state identity, chronology, and exact target-exclusion correction. Retain the
released r27 NFL score/probability marriage. Reject the same-book-only direction replacement, the
evidence-priced contrary-side grids, and the unsupported same-winner expansion guard.

The advancing candidate does not change any stored locked row. It changes the interpretation available
to future unlocked computations and therefore receives a complete new release family.

## What is corrected

- Circa and Pinnacle are the only named price books actually collected. Bookmaker is no longer claimed.
- DraftKings and BetMGM SharpAPI split fallbacks remain source-identified retail evidence; only an actual
  Circa split is named-book flow.
- Same-book number movement, same-number no-vig price movement, raw hold change, and cross-book
  displacement are retained separately.
- First material number/price move, their order, last economic move, persistence after the first material
  move, material reversal, buyback, and NFL Spread key crossings are explicit.
- A retail follower must move at or after the later of the two named leaders. An early retail move cannot
  be credited as following the named lead.
- Named authority is rebuilt inside the target-exclusion loop after removing the exact evaluated family
  from Moneyline/Spread or Total evidence. Two remaining followers are required after that exact removal.
- Fresh opposing splits and reverse flow veto qualification. Ordinary retail disagreement remains visible
  as resistance but cannot overrule two agreeing named leaders plus qualifying named flow by itself.
- Absolute handle, ticket count, bet size, limits, originating market, and suspension/reopen lifecycle stay
  explicitly unavailable rather than inferred.
- Named Total authority remains disabled. The Total cohort is not sufficient for release.

## Exact production comparison

The exact live r27 implementation and the corrected-identity candidate were both replayed from the same
18 stored paid-team-score locks. Evidence after each lock was excluded.

| Measure | Live r27 | Identity candidate |
|---|---:|---:|
| Moneyline projection | 11-7 | 11-7 |
| Spread projection | 12-5-1 | 12-5-1 |
| Total projection | 11-7 | 11-7 |
| Team-score MAE | 6.4020 | 6.4020 |
| Margin MAE | 8.0955 | 8.0955 |
| Total MAE | 10.0353 | 10.0353 |
| Moneyline decision Brier | 0.22827 | 0.22827 |
| Spread decision Brier | 0.22061 | 0.22061 |
| Total decision Brier | 0.26325 | 0.26325 |
| Moneyline actionables | 6 (4-2) | 6 (4-2) |
| Spread actionables | 5 (4-1) | 5 (4-1) |
| Total actionables | 12 (7-5) | 12 (7-5) |
| Complete actionable board | 23 | 23 |
| Promotions / demotions | 0 / 0 | 0 / 0 |

All evaluated sides, probabilities, grades, and exact stored-price decisions are identical between live r27
and the candidate on this cohort. Therefore exact-price units are also identical. Upset calls remain four,
with three correct: 75% precision and 33.3% recall across nine actual upsets. These are retrospective small-
sample diagnostics, not a promised future rate.

The already released named-sequence contribution remains real. Versus the pre-sequence control, only
PHI-CHI changes: Philadelphia by 5.00 becomes Philadelphia by 1.97, retaining the outright winner and
moving the Spread projection to Chicago. That changes the Spread projection cohort from 11-6-1 to 12-5-1,
with no decision, promotion, demotion, or board-count change.

## Earlier-week market-reader audit

The market reader was also scored without requiring the current independent model. Weeks 3-4 contain 32
locked games, and 31 retain at least two named price trails for each market. Weeks 1-2 predate the stored
named-book chronology and cannot honestly support this test.

The corrected release gate qualifies one Moneyline signal, Atlanta at New Orleans away, which won. It
qualifies five Spread signals: CAR-CLE home, CIN-PIT home, PHI-CHI home, MIA-MIN away, and ATL-NO away.
All five won. Three occurred in Week 3 and two in Week 4. One qualified Spread signal disagreed with the
historically authoritative projection; that disagreement was one correction and zero harms. Named Total
remains disabled and therefore has zero released signals.

This 1-0 Moneyline / 5-0 Spread result is an opened retrospective diagnostic. The same weeks informed the
earlier r27 audit, so it is not an untouched holdout and cannot justify a promised future hit rate. Its
purpose is to verify that market-state interpretation can be evaluated across historical independent-model
versions while final combined-product claims remain release-stratified.

## Rejected integrations

The full same-book-only direction candidate reduced Moneyline projection to 10-8 and Spread projection to
9-8-1. It created one Spread correction but five Spread harms at the price-only/25% settings and reduced
Spread actionables from five to three. It is rejected.

The consensus-displacement evidence-priced candidates retained only an 11-6-1 Spread projection, reduced
Spread actionables from five to two, produced one correction and two-to-three harms depending on weight,
and produced no actionable promotion. They are rejected.

The isolated 1.5-point unsupported same-winner expansion guard improved Moneyline/Spread Brier to
0.22263/0.21729, but it moved IND-WSH from a winning Indianapolis Spread side to a losing Washington side,
moved losing DET-CAR Detroit to winning Carolina, demoted Detroit Moneyline and Spread actionables, and
created no promotion. Its one correction does not justify its one harm and unpaired demotions. It is
rejected.

Those failures establish a model-specific boundary: truthful evidence identity should ship, but the live
NFL direction and probability marriage must not be replaced merely because a theoretically cleaner rule
sounds sharper.

## Safety and publication

- One existing forward writer and the shared `prediction_pipeline:nfl` lease remain authoritative.
- Provider cadence, request ceilings, grade thresholds, stake behavior, copy, labels, and layout are
  unchanged.
- Existing locked payloads and the r27 release tuple retain reader precedence.
- Focused market-state, named-sequence, coherent-PMF, target-exclusion, writer/lease, and snapshot
  continuity tests pass.
- Publication still requires `npm run verify:model-change`, current-main ancestry/integration safety, a
  protected pull request, owner approval, and post-deploy release/writer/lease/coverage/reader proof.

Rollback is the complete r28 market-state-identity release family to the October 8 r27 named-sequence
family. Locked rows must never be rewritten during rollback.
