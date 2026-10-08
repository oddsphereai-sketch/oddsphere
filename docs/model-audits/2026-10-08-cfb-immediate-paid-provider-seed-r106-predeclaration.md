# CFB immediate paid-provider seed r106 — predeclaration

Status: owner-approved production availability repair.

Validation status: focused CFB production tests, the complete model-change verification suite and
TypeScript all pass on the exact current production base `e87b809bf3c17519cdeedcd772e5892308fc110c`.
Because this amendment changes only collection eligibility, its frozen r38 exact-board replay is
unchanged: 85 / 84 / 84 paired Moneyline / Spread / Total prices across 86 upcoming games and 91
actionable market decisions, with zero promotions and zero demotions relative to r38.

## Scope

- Sport / markets: CFB Moneyline, Spread and Total price availability for unlocked FCS-only games.
- Sole authority: the existing `cfb_forward_evidence` writer under the shared
  `prediction_pipeline:cfb` lease and the existing CFB cron route.
- Active forecast / decision / member family remains the r38/r30/r42/r52 paid FCS gap-fallback
  release. Only the writer scheduling release advances from r105 to r106.
- No independent-score, probability, side, market-arbitration, grade, stake, lock, settlement,
  tracking, copy, label or layout behavior changes.

## Defect

The r38 deployment completed while its first writer cycle was already running. That cycle wrote
current r38 evidence before the production paid-provider key was available, so every payload
truthfully recorded zero The Odds API calls. Once the deployment and key were active, the normal
writer saw a fresh r38 evidence wave and stopped at the ordinary hourly cadence gate. The intended
`forceOpeningSeed` provider rule therefore could not execute because the outer game-capture planner
had selected no games. Real FCS prices remained absent until the next hourly boundary.

## Candidate

The existing release-refresh planner may declare one `provider_seed_due` cycle when all of these
conditions hold for a latest game row:

1. kickoff remains in the future;
2. both teams are FCS;
3. the current evidence still needs named-book fallback coverage;
4. neither a The Odds API request nor a verified The Odds API book has ever been recorded.

That cycle uses the existing zero-minute release-refresh planning path but filters its capture plans
to only those eligible FCS gaps. The existing provider client, strict identity checks, named-book
hierarchy, current/historical request ceilings, 5,000-credit reserve, append-only payload writer,
member snapshot merge and T-60 lock behavior remain unchanged. A successful or failed first attempt
is recorded in the normal request budget, so this trigger cannot repeat; subsequent collection is
the existing hourly/T-60 cadence.

## Acceptance

1. Focused tests prove an unattempted unlocked FCS gap requests an immediate seed, while FBS games,
   complete FCS rows, prior attempts, started games and locks do not.
2. The exact current-board replay retains the r38 coverage and 91-actionable result with zero
   promotions and zero demotions; the scheduling repair changes when the same verified input is
   collected, not its interpretation.
3. `npm run test:cfb-v1-production`, TypeScript and `npm run verify:model-change` pass.
4. The candidate is rebased on latest `origin/main`, passes integration safety and protected PR
   checks, then production proves one leased r106 seed cycle, paid-provider request telemetry,
   improved FCS coverage, coherent member publication and immutable prior locks/tracking.

## Rollback

Roll back writer r106 to r105 while preserving every appended evidence row and every immutable lock.
The normal hourly r38 fallback remains available. Roll back on repeat seeding, credit-ceiling drift,
writer overlap, mixed member releases, missing-price regression, tracking mutation or reader failure.
