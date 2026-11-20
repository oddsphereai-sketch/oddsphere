# NBA rotation replacement and frozen forward evaluation

November 20, 2026. Production base 1c928498556b0d02b1b8a169a877114a73cacfb5.
Research-only implementation. No production model, grade, stake, source writer,
lease, schedule, member reader or immutable tracking record changes. Live
R38 / marriage R40 / reader R4 / grade R31 and stat writer R40 remain authoritative.

## Concrete implementation

`lib/research/nba/nbaPlayerStateLedger.ts` implements deterministic point-in-time
expected-rotation features: native identity resolution, effective roster and
exact-game availability admission, prior/current appearance shrinkage, expected
participation/minutes, constrained 240-minute allocations, verified-OUT exclusion,
available-only replacement minutes, original/reference/replacement allocation,
net/PIE shock and overlap loss. Exactly six paired difference/sum features match
the prior player-state experiment. It has no live import. The fixed residual
head implementation below remains unfitted on real historical outcomes.
The profile uses up to 10 prior-season plus 10 current-season appearances; no
outcome selected those windows. Absence-duration/first-return history and full
historical transaction/crosswalk adapters remain additional qualification work;
this component must not be represented as the complete certified ledger.

`nbaPlayerStateStatEvidence.ts` reuses the released immutable stat selector,
including correction/reversion clocks, checksum validation and target-game
exclusion. It conservatively uses the collector-completion/first-retention clock;
that is not a provider's historical first-publication timestamp or raw HTTP.
Self-identities within BALLDONTLIE are allowed. No name-only ESPN/official-NBA
crosswalk is created. No missing injury player is marked healthy.

The local audit operator accepts only an explicit frozen bundle. Missing source
families return unknown, not zero-impact features. Qualification requires the
original 1,000 complete 2023–24 games / 300 verified-change games plus a matching
frozen schema/ledger and mutation-test receipt; urgency cannot bypass it.

## Actual retained-evidence admission

Read-only export found 43 archived game bodies / 43 observation references. The
exact saved native BALLDONTLIE identities bind all 9 current games to 18 team scopes.
The frozen bundle contains no effective-dated roster or exact-game availability
observations. All 9 replacement snapshots therefore correctly remain unknown;
this does not block or regrade the live DailyEdge model. Complete selection and
verified-change counts are both 0; fitting is refused. The 1,230-game 2025 cache was
collected in 2026, and the 226-game 2026 cache is mutable season state. Neither
establishes the missing historical 2023–24 cutoff receipts.

This is the evaluated retained bundle, not a claim that live roster/medical
information is absent everywhere. BALLDONTLIE's documented current active-player
and injury endpoints expose native IDs; retrieving those today would not
establish their values at a 2023 decision cutoff. Provider reference:
https://docs.balldontlie.io/ . No provider/AI requests were made for this audit.
A fresh current roster or a postgame participant list cannot repair historical
membership/availability evidence by inference.

## Frozen Total forward check

The earlier Total R2 candidate remains held in draft PR #1135; Spread remains
rejected. Its original 9-game same-input predictions from 10:08:42 a.m. Eastern were
not recomputed or selected after results. The source's existing SHA256 is
67b728e2242e5dc61fe2a1d74452379ca7e85a3ef1c328f63b9cf0fd3197de5b.
At 2:23:18 p.m. Eastern, before any game, exact fixture identities/tips and the
original 27 price/line/book/side/grade/probability tuples were bound into a frozen
forward manifest, hash
7fd822c24be5b6858f905696a470236a3b335d2f9c84db6d36522c2235be8895.

`nbaFrozenReplacementEvaluation.ts` and its explicit-file operator score only
those contracts against verified finals. Pending stays pending, pushes refund,
conflicting/foreign finals fail, and American-price returns are exact. Source,
forecast and freeze clocks remain distinct. Fitting is absent. Proper-probability
rows on pushes are omitted rather than assigned an invented binary outcome.
This research record is not an official T-60 lock or a historical correction.

Frozen actionable counts: Moneyline 4→4, Spread 1→1, Total 2→0. Total has 0
promotions / 2 demotions. All 27 outcomes remain pending. The known flattening and
prior confirmation failures remain release blockers. Nine prospective results
will be evidence, not automatic authority to deploy or retune a candidate.

## Verification

Focused rotation tests cover 240-minute conservation/caps, native identity and
completeness refusals, exact no-shock behavior, OUT and questionable/probable
handling, target/future mutation invariance, input immutability and no-fit gates.
Retained-stat tests cover conservative first observation, A/B/A revisions,
corrupt-current refusal and future mutation invariance. Frozen evaluation tests
cover side/line orientation, prices, pending/push/final clocks, duplicate/foreign
final refusal and unchanged hashes. Incumbent professional-candidate and
point-in-time-feature tests pass. TypeScript and focused lint are required before
saving the draft. No production deployment or accuracy improvement is claimed.
Full model-change, fresh-main integration, protected PR and live checks remain
mandatory before any later activation. Source data and private forecast bundles
stay outside Git under ignored ops-local/learning-lab.
