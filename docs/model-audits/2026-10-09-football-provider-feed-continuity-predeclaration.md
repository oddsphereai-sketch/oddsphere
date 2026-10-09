# Football provider-feed continuity predeclaration

Date: 2026-10-09  
Starting production base: `ab3ec4a2335d2cd2c8a29ab268661b0a7dd4d178`  
Sports in scope: NFL Daily Edge SharpAPI splits and CFB Daily Edge Playbook injuries

## Problem statement

Two paid-data paths are not providing the continuity their downstream readers expect.

1. SharpAPI currently publishes NFL split rows with exact provider labels such as
   `BAL Ravens`, `IND Colts`, `BUF Bills`, and `LA Rams`. The NFL adapter accepts the
   full team name, bare abbreviation, or bare nickname, but not the provider's exact
   abbreviation-plus-nickname identity. Valid current rows are therefore reported as
   unavailable.
2. Playbook's current public injury contract is `GET /v1/injuries?league=NCAAF` and
   returns `last_updated` plus `teams[].injuries[]`. Oddsphere sends a lowercase league,
   uses a 2.5-second production timeout, and expects the older `data[].players[]`
   contract. A documented successful response therefore normalizes to no injury rows.

The CFB SharpAPI split path is included in the audit but not presumed defective. A
bounded read-only production-adapter check on October 9 read 34 current provider rows
and matched 30 of 89 active CFB games; the remaining active games were not present in
the provider catalog. No CFB SharpAPI identity change is authorized without evidence.

## Intended correction

- NFL SharpAPI: accept only the provider's exact abbreviation-plus-nickname aliases,
  including the explicit `LA Rams` to LAR and `WAS` to WSH code aliases. Do not add
  fuzzy team matching.
- Playbook: request the documented uppercase league identity, normalize both the
  documented and legacy response contracts into the existing canonical injury DTO,
  retain the newest valid report when a later pull fails, omits the matchup, or is
  older, and extend only the injury request timeout to 10 seconds.
- Preserve exact team and player identity requirements. The newly documented Playbook
  contract is member-report and continuity evidence only in this release. It cannot
  alter a CFB projection or grade until its live payload and exact current-board impact
  are validated after deployment. Existing already-qualified legacy-contract rows keep
  their prior authority; missing, ambiguous, or stale evidence remains neutral.

No new writer, schedule, provider request loop, lease, threshold, coefficient, grade
rule, stake rule, copy, label, or layout is authorized. The existing sport-scoped
`prediction_pipeline` lease and single writers remain authoritative.

## Locked-record and release contract

Stored locked snapshots are immutable. Reader precedence must render each legacy lock
from its stored payload and release tuple. New provider semantics apply only to future
unlocked computations and future locks.

Because restored NFL split evidence can change future projections, probabilities,
predictions, or grades, the NFL model family and its writer/member/snapshot identifiers
receive new release identities. CFB's model, calibration, grade, decision, and tracking
releases remain unchanged because the newly normalized Playbook contract is not a model
input in this release. Its collector/member/writer/fixture/snapshot identities change to
version the repaired report payload. The immediate prior NFL and CFB member families
remain explicit reader-transition predecessors.

## Pre-publication evidence

- NFL current-board exact identity rehearsal: matched SharpAPI split coverage increases
  from 1 of 15 games to 7 of 15. Six games gain valid split evidence. Against the same
  current inputs, there are zero changes to projected scores, Moneyline/Spread/Total
  sides, probabilities, grades, promotions, demotions, or the 18-actionable board. The
  restored evidence does not clear the existing professional authority rules on this
  slate.
- CFB current SharpAPI production-adapter audit: 30 of 89 active games match the 34-row
  provider catalog. This is provider publication coverage, not an adapter dropout.
- Playbook: the public contract and deterministic legacy/documented normalization can be
  tested locally. The production Playbook credential is not present in this worktree,
  so live NCAAF payload coverage and model impact cannot be claimed before deployment.
  The new contract therefore fails closed to report-only authority. Post-deploy live
  proof is mandatory before a separate model-authority release can be considered.

## Required gates

Before publication:

1. Test documented and legacy Playbook normalization, uppercase request identity,
   report retention across omission/failure/older replay, and exact CFB team/player
   matching.
2. Test NFL provider-prefixed team identities, LA/LAR and WAS/WSH aliases, wrong dates,
   duplicates, incomplete markets, and strict failure behavior.
3. Run the focused NFL and CFB writer/member/lock suites, TypeScript, the complete CFB
   production suite, and `npm run verify:model-change`.
4. Report the exact zero-write board impact, including promotions, demotions, and
   actionables, for owner approval.
5. Rebase or merge the latest `origin/main`, run integration safety from a clean
   committed worktree, publish through a protected pull request, and verify the remote
   PR tree.
6. After merge, verify the live release identifiers, sole writer and lease, cron health,
   NFL/CFB provider coverage, CFB injury timestamps, score/pick/grade coherence, member
   snapshot, and unchanged legacy locks.

## Rollback

Roll back the entire new NFL and CFB release families to their October 9 predecessors
for future unlocked computations if live Playbook normalization is empty or malformed,
SharpAPI identity becomes ambiguous, a score/pick contradiction appears, board coverage
collapses, any locked payload changes, release tuples mix, or writer/lease ownership is
not singular. Never rewrite a locked row during rollback.
