# Cross-sport Market Brain rollout predeclaration

Status: **OPEN — scope frozen; production influence remains prohibited**

Registry release: `market_brain_product_registry_2026_10_27_r2_surface_and_family_scope`

Evidence-roster release: `market_brain_evidence_roster_2026_10_27_r4_owls_named_book_splits`

Evidence-attempt release: `market_brain_evidence_attempt_2026_10_27_r5_claim_adapter_parser_bound_joint_scope`

Capture-plan release: `market_brain_capture_plan_2026_10_27_r2_adapter_parser_bound_precommit`

Attempt-claim release: `market_brain_attempt_claim_2026_10_27_r2_adapter_parser_bound_due_and_missed`

Capture-runner release: `market_brain_capture_runner_2026_10_27_r1_shadow_only_exact_adapter`

## Objective

Build one shared evidence, chronology, provenance, evaluation, and consequence framework while
requiring an independently implemented and qualified adapter for every active Oddsphere prediction
product. The shared framework is not permission to transfer NFL parameters, thresholds, evidence
authority, or validation to another sport.

## Complete active scope

The executable registry covers NFL, CFB, NBA, WNBA, MLB, NHL, Premier League, Champions League,
FIFA World Cup, NFL Player Props, NBA Player Props, and MLB Player Props. Their current champion releases remain
the exact identifiers in the corresponding sections of `docs/current-model-releases.md`; this
predeclaration changes none of them.

The registry also freezes the smallest independent qualification scopes. MLB first-inning may not
inherit full-game qualification. NFL, NBA, and MLB player props enumerate every named stat family
from their canonical product catalogs; no generic `player_prop` parent can transfer authority to a
child family. MLB run line remains context-only and cannot receive a consequence, grade, or stake
through this work. NHL uses the persisted canonical `spread` identifier; `puck line` is presentation
language, not a parallel prediction target.

CBB is separately registered as prelaunch and unqualified. It cannot become active merely by
sharing basketball vocabulary or NBA infrastructure; it requires its own writer, lease, source
roster, independent model, adapter, chronology, settlement, and untouched qualification.

Every active product now has a frozen expected-source contract. It names each provider/feed,
evidence families, collection phases, replay target, required versus opportunistic status, and
either an explicit participant allowlist or a provider-catalog discovery obligation with exclusions.
This does not claim those feeds are captured: non-NFL entries remain `not_started`, and NFL remains
partial. A response-derived list can never replace the predeclared expected roster because doing so
would erase absent books, failed requests, and parser omissions from the evidence denominator.

Every planned source attempt must produce one immutable receipt under the shared attempt release,
including skipped, failed, genuinely empty, partial, and successful attempts. The receipt binds product,
the canonical ordered set of independent scopes informed by that request, feed, participant, event,
planned window, request/page counts, exact precommitted adapter/parser releases, and
raw-response provenance, and exact row conservation. An insert collision is successful only when the
stored canonical bytes are identical; retries cannot update an earlier receipt. The v47 schema was applied
to production on October 28, 2026 after the disposable PostgreSQL 16 proof passed. Its RLS-protected
receipt table was verified empty with validation and immutability triggers active. No source adapter is
wired to it, so this closes neither attempt coverage nor predictive qualification.

Attempt obligations must first be frozen in one bounded capture plan whose database receipt predates
the first window. The plan uses canonical source/time order, rejects duplicate logical obligations even
when a caller changes their UUID, and is persisted atomically with every child obligation. A later
attempt receipt must match that exact precommit. A code-release change cannot create another physical
request for an otherwise identical provider/feed/participant/event/window obligation. The v48 migration
was applied to production on October 28, 2026; both RLS-protected plan tables were verified empty, with
the plan persistence function and receipt precommit trigger present.

The v49 migration adds bounded due and expired-window leases with append-only claim history. Exact
claim token, sequence, adapter release, and parser release are bound through the immutable receipt row,
so an expired worker cannot finalize after lease expiry or reassignment. The shadow-only execution core
now reconciles missed windows, claims one paid request just in time per invocation, enforces exact
registered adapter/parser capabilities, bounds execution inside the lease, sanitizes failures, and
persists claim-bound receipts. It has no route, cron, or
registered production provider adapter, so this remains inert until each source adapter is implemented,
qualified, and explicitly enabled.

V49 was applied to production on October 28, 2026 after the disposable PostgreSQL proof passed. The
post-apply audit found both RLS-protected claim tables empty, both claim RPCs present, and the exact-claim
serialization and finalization triggers active. Across v47–v49, the audit timestamp was
`2026-10-28 12:33:23 UTC`; all five table counts were zero. Installation created no capture plan, request,
provider call, model input, prediction, grade, stake, lock, or member-facing change.

## Owls Insight provider-transition boundary

Oddsphere's planned SharpAPI-to-Owls Insight migration changes the expected-source contract but does
not change the Market Brain evidence semantics. The canonical provider key selected by the shadow
adapter is `owls`. Owls' Circa, DraftKings, and BetMGM split sets are separate named-book modalities;
none may overwrite another, be averaged into a synthetic sharp percentage, or be treated as present
when the provider returns a partial or missing book. Price, line, split, provider-observed time,
server-receipt time, raw-response identity, and completeness stay source-specific.

The r4 evidence roster now names the Owls canonical named-book lane for supported full-game sports.
Market Intelligence capture r6 persists every complete fresh Circa, DraftKings, and BetMGM pair; the
single-book display preference is not reused internally. NFL shadow r26 reads those persisted rows with
one bounded database query and makes no duplicate Owls request. Existing SharpAPI evidence remains
immutable historical provenance and is never relabeled as Owls evidence.

The NFL bridge is deliberately `normalized_only`: the exact provider-response archive is not yet linked
to its evidence manifest. It can support prospective shadow comparison and missing/stale/conflict
diagnostics, but it cannot qualify predictive influence. Non-NFL sport adapters remain `not_started`,
and player-prop provider coverage is unchanged. Raw-response replay, participant-denominator accounting,
prospective release-pure evaluation, and sport-specific qualification therefore remain open gates rather
than being hidden behind the provider transition.

Every adapter must declare and prove:

1. its independent model and market-free input lineage;
2. its sport/competition/prop-specific market geometry and settlement rules;
3. a versioned expected feed and participant roster, exact identity, availability time, and replay
   boundary for every consumed source;
4. a complete target-family-excluded chronological evidence sequence, including failed and missed
   expected attempts, sourced from persisted attempt receipts rather than inferred from surviving rows;
5. an interaction-rich learned reader that jointly interprets the available price, number, source,
   cross-market, split, news/availability, and independent-prior sequence without signal-count
   quotas or fixed sportsbook weights;
6. one coherent posterior distribution and a quote-menu consequence layer capable of confirm,
   recenter, flip, fade-market, retain, and stand-down;
7. chronological train/selection/confirmation/prospective evidence, calibration, clustered
   uncertainty, ablations, exact incumbent corrections and harms, promotion/demotion counts, board
   impact, cost, and failure behavior;
8. its existing authoritative writer and sport-scoped `prediction_pipeline` lease. No adapter may
   create a parallel prediction writer.

## Writer and lease boundary

NFL Daily Edge and NFL Player Props retain `prediction_pipeline:nfl`; CFB retains
`prediction_pipeline:cfb`; NBA Daily Edge and NBA Player Props retain `prediction_pipeline:nba`;
WNBA retains `prediction_pipeline:wnba`; MLB Daily Edge and MLB Player Props retain
`prediction_pipeline:mlb`; NHL retains `prediction_pipeline:nhl`; EPL and UCL retain the shared
`prediction_pipeline:soccer` lease, as does the separately registered World Cup adapter. The exact current writers and release identifiers remain those
recorded in `docs/current-model-releases.md`.

Surface lifecycle is separate from predictive authority. NFL, CFB, EPL, and UCL are member-feature-
gated; NBA Player Props is a private forward candidate; World Cup, NBA, WNBA, MLB, NHL, NFL Player
Props, and MLB Player Props have member-active surfaces; CBB remains prelaunch. Every Market Brain
adapter is nevertheless non-live until its own proof is complete.

## Missing-data rule

An expected source that is absent because of request cadence, pagination, parser coverage, identity,
storage, replay, or writer failure is a repair defect and must remain observable as such. Only a
source or field that the provider genuinely does not supply may be represented as a provider blind
spot. Neither case may be zero-filled, inferred, or treated as confirming evidence. A reader may
continue from the remaining genuine evidence with calibrated uncertainty; missing one modality is
not a universal veto and is never a substitute for a market interpretation.

## Activation boundary

All active and prelaunch registry rows have `productionInfluenceAllowed=false`. NFL is research-executable but
not predictively qualified; the other adapters are not started. Each product must advance through
its own versioned capture, replay, reader, consequence, evaluation, and qualification releases.
Production activation requires the model-change protocol, current-main integration safety,
protected PR checks, a balanced same-board impact report, immutable locked-record precedence, one
authoritative writer/lease, and post-deploy live proof. No all-sport flag or shared-core completion
may mark an individual adapter production-eligible.
