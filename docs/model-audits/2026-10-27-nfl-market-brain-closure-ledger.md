# NFL Market Brain closure ledger

Status: **OPEN — exhaustive inventory reconciled; remediation not complete**

Inventory freeze: 2026-10-27 exhaustive full-stack, predictive, operations/database, requirements-
trace, failure-mode, and market-science red-team. The frozen inventory contains MB-001 through
MB-041. New evidence must map to an existing item or
be added explicitly; it may not create an untracked side list.

This is the single closure ledger for the NFL Market Brain remediation. It supersedes informal
claims that a review round, green unit suite, or provenance checksum by itself closes the system.
Nothing in this ledger authorizes a migration, shadow capture, model fit, member-facing prediction,
grade, stake, lock mutation, or production rollout.

## Closure rules

An item may move to `closed` only when all of the following are recorded here:

1. the implementation commit and affected release identifiers;
2. an executable acceptance test at the correct boundary (real PostgreSQL for database behavior);
3. the exact command and passing result;
4. an independent reviewer has checked the implementation and test against the original failure;
5. no dependent item remains open that invalidates the proof.

`Mitigated`, `documented`, `disabled`, `unit tested`, and `fails closed` are not synonyms for
`closed`. Predictive value requires untouched out-of-sample evidence; it cannot be closed by code
inspection.

## Master ledger

| ID | Severity | Status | Finding | Required closure proof |
|---|---:|---|---|---|
| MB-001 | Blocker | open | The already-installed v45 schema cannot be upgraded by editing `CREATE TABLE IF NOT EXISTS` definitions. | Forward-only v46 migration; catalog preflight; old-v45 → v46 and second-apply tests on real PostgreSQL; unexpected rows fail safely. |
| MB-002 | Blocker | open | One manifest cannot both contain already-opened development outcomes and have a database receipt predating those games' pregame windows. | Separate immutable collection precommit from later modeling/tournament manifest; lifecycle test covering development, selection, confirmation, and prospective partitions. |
| MB-003 | Blocker | open | Raw-parser archival work and its 2 MiB exception run inside shared provider parsers even when Market Brain is disabled. | Optional shadow-only archive hook; oversized payload becomes research failure only; regression tests prove unchanged NFL Daily Edge, player-props, and CFB behavior with flags off. |
| MB-004 | Blocker | open | Invalid shadow configuration or missing attempt schedules can abort the authoritative NFL writer before production writes. | Separate leased runner or complete fail-open boundary; fault-injection tests for malformed JSON, bad limits, missing/ambiguous attempts, and archive/storage failures while authoritative outputs remain identical. |
| MB-005 | P1 | open | Attempts are driven by production cadence; due attempts can be silently skipped and upstream failures may produce no `capture_failed` row. | Persisted attempt ledger independent of publication cadence; every due attempt atomically reaches captured/failed with bounded failure class; restart/retry tests. |
| MB-006 | P1 | open | Attempt `plannedAt` is not an enforced attempt-specific capture window and runtime windows are not bound to the manifest. | Immutable per-attempt open/close bounds in the collection manifest; DB checks both capture and server receipt inside the exact attempt window; allowed-lateness policy tests. |
| MB-007 | P1 | open | Canary membership is reselected from live odds instead of dictated by the precommitted manifest. | Freeze stratification inputs and selected event IDs before capture; runtime consumes only persisted attempts; line-crossing test cannot alter membership. |
| MB-008 | P1 | open | Capture-set finalization and capture insertion do not serialize on the same lock/ledger row. | Transactional attempt ledger with common locking and recheck; real-PostgreSQL concurrency test proves no late row can commit outside finalized membership. |
| MB-009 | P1 | open | There is no restart-safe operator path from collection precommit through settlement/evaluation, and some receipts cannot be safely resumed. | Idempotent shadow-only runner with byte-verified reload and deterministic retry for every stage; kill/restart tests after each committed stage. |
| MB-010 | Blocker | open | Database proof tests use mocks and migration-text regexes rather than executing PostgreSQL. | Disposable PostgreSQL/Supabase CI applying the upgrade and exercising syntax, constraints, triggers, grants/RLS, direct-forgery attempts, retries, retention, and concurrency. |
| MB-011 | Blocker | open | Development training accepts caller-authored sequences, features, scores, and label times. | Trainer requires durable attested research inputs and verified final-outcome receipts; training transcript binds every receipt/checksum/source-row hash; forged/copy tests fail. |
| MB-012 | P1 | open | Some stored self-hashed rows are promoted to process-private attestations without replaying their derivation. | Deterministic read-time replay or narrowly privileged server-side derivation writers; direct `service_role` forged-input/artifact/prediction tests fail. |
| MB-013 | P1 | open | Failed planned attempts are retained in capture receipts but dropped before sequence/features. | Complete attempt timeline and failure masks reach durable research input; tests distinguish one successful attempt from the same tape plus failed/missed attempts. |
| MB-014 | P1 | open | Raw parser inputs can expire before the research run is auditable, and Sharp split parser inputs are never archived for replay. | Relational pin/reference policy through qualification horizon; replayable bounded inputs for every consumed source or an explicit normalized-only limitation; purge tests protect active experiments and later remove released evidence. |
| MB-015 | Blocker | open | Frozen tournament says marginal Margin+Total log score is primary, while implementation selects L2 by joint NLL. | Implement the declared comparable objective and non-regression gates; joint score remains diagnostic unless every comparator has a comparable joint. |
| MB-016 | Blocker | open | The zero-market comparator cannot isolate market value from intercept, prior recalibration, injuries, weather, or other context. | Predeclared support-only, prior-recalibration, context-only, prices-only, splits-only, chronology/source-role, cross-market, and full ablations; require incremental untouched benefit over strongest non-market candidate. |
| MB-017 | P1 | open | The executable reader collapses rich sequences into linear summaries; prose behavior scenarios do not run the fitted resolver. | Predeclare an interaction-rich/sequence-aware candidate; executable scenario fixtures test order permutations, direction, magnitude, uncertainty, reversals, news timing, source outages, and confirm/flip/stand-down behavior. |
| MB-018 | Blocker | open | Roughly 1,415 coefficients are allowed with two games/two folds, no fitted calibration, stability requirement, or uncertainty interval. | Predeclared minimum games/weeks/effective-dimension limits; nested rolling evaluation; cross-fitted calibration; week-cluster intervals; coefficient/prediction stability gates. |
| MB-019 | Blocker | open | Evaluation does not show which exact incumbent moneyline/spread/total decisions the candidate would flip, retain, or pass. | Freeze candidate decision consequences at the original locked lines/prices; pairwise corrected-loss/new-harm/push/promotion/demotion/abstention/board-count/ROI report with immutable locks. |
| MB-020 | P2 | open | Aggregate public splits are captured but excluded; current claims can imply they are interpreted. | Obtain target-excluded composition or declare the modality unavailable in feature/evaluation reports; tests prevent accidental use of contaminated aggregates. |
| MB-021 | P2 | open | Several retained context/timing fields and source-clock semantics are discarded by the executable vector. | Consumed-vs-retained audit; source-clock reliability and relative news/move timing features; family ablations and omission sensitivity on untouched data. |
| MB-022 | P1 | open | Shared architecture exists, but executable and qualified behavior is NFL-only. | Separate sport/league/prop adapters, geometries, settlement, feeds, releases, tests, and untouched qualification; no transfer of NFL authority. |
| MB-023 | P2 | open | Cleanup is coupled to capture flags and does not report all deletion/cap metrics. | Retention runs independently; raw/shadow/artifact deletion counts, cap utilization, purge errors, and alerts are observable and tested. |
| MB-024 | P2 | open | Raw inputs, prior artifacts, and attempt rows are persisted non-atomically. | One bounded transactional RPC/transaction for an attempt and referenced artifacts; timeout/retry tests leave neither partial receipts nor unbounded orphans. |
| MB-025 | P2 | open | Outcome SQL does not fully enforce NFL identity/final-time/source hash semantics. | DB trigger checks sport, exact final timestamp/JSON identity, provider IDs, and a reproducible source-row derivation; adversarial direct-insert tests. |
| MB-026 | P3 | open | Active documentation contains superseded release IDs and overstates zero-market/proof-chain conclusions. | Release registry/doc consistency test and reviewed language matching the evidence actually established. |
| MB-027 | Blocker | open | The resolver emits a posterior but no executable per-market confirm/flip/retain/stand-down decision. | Versioned consequence layer derived coherently from the joint posterior, frozen quote menu, incumbent decision, uncertainty, and utility; end-to-end scenario tests prove all actions without signal counts or a contradictory independent head. |
| MB-028 | P1 | open | Only the incumbent-selected quote is frozen, so a candidate flip has no proven executable opposite-side price. | Store both sides, lines, prices, family, observation time, and settlement terms outside trainer input; flip fixtures settle the exact opposing quote or stand down when absent. |
| MB-029 | P1 | open | Exact cross-provider timestamps can manufacture first-mover roles; no tie/clock-quality policy exists, `directionConflict()` is inert, and key-number identity is collapsed. | Separate provider time from server receipt order, declare simultaneity/clock reliability, preserve economic line+price equivalence and exact key crossing/reversal identity; clock-offset and key-number perturbation tests. |
| MB-030 | P1 | open | The `raw_provider_response` claim exceeds actual replay coverage, and expected source inventory is partly inferred only from sources that appeared. | Versioned expected feed/book roster and bounded parser input/release identity for every consumed feed, or explicit normalized-only status; full ledger replay and whole-source omission tests. |
| MB-031 | P1 | open | Mutable game corrections can create multiple valid final-outcome receipts and callers can choose among them. | Versioned deterministic settlement-revision policy with unique identity and evaluator-enforced precedence; correction tests reject caller-selected stale/alternate receipts. |
| MB-032 | P2 | open | Frozen `relativeLossTolerance` is declared but unused by the optimizer. | Implement and transcript the declared stopping rule or freeze a new release matching actual behavior; convergence/stagnation/failure fixtures. |
| MB-033 | P1 | open | Mandatory `verify:model-change` omits the proof-chain lifecycle test, and the existing proof test is mock/regex based. | Make the real-PostgreSQL lifecycle, forgery, restart, and concurrency suite mandatory; weakening a trigger/grant or reintroducing a race must fail the gate. |
| MB-034 | P2 | open | Canonical hash ordering uses locale-dependent `localeCompare`, so immutable identities are not portable across hosts. | Versioned locale-independent canonical JSON, finite-number/negative-zero policy, and golden multi-locale/Node/PostgreSQL hash vectors. |
| MB-035 | P2 | open | Raw parser archives key only by payload hash, so identical bytes under a different parser schema silently reuse old schema provenance. | Content address/key binds parser schema release plus bytes; schema-collision test stores or rejects versions deterministically. |
| MB-036 | P2 | open | Database shape lacks several full JSON/column bindings and finalized-window identities; catalog constraint checks are not scoped to schema/table. | v46 adds scoped catalog checks, one unique finalized-window identity, exact JSON-column/count bindings, and adversarial self-consistent mismatch tests. |
| MB-037 | P2 | open | Study storage has incomplete global/lifecycle quotas and lacks cap headroom, due/missed-attempt, parser-coverage, and unfinalized-window observability. | Explicit study quota/retention policy, bounded indexes/query plans, status views/alerts, and operator metrics with boundary tests. |
| MB-038 | Blocker | open | With capture flags off, this branch still changes shared provider parsing/split semantics and release identities, so production equivalence is unproved. | Isolate/revert research-only changes from incumbent paths; base-versus-candidate feature-off tests must be byte-identical for NFL Daily Edge, member snapshots, tracking/locks, player props, and CFB, including oversized/failing responses. |
| MB-039 | Blocker | open | Adaptive family/feature/policy search and reuse of opened confirmation periods are not registered or multiplicity-controlled. | Append-only experiment registry and bounded search budget; confirmation is consumed after first registered evaluation; all selection stays inside nested chronological folds; null-search simulations preserve the declared false-positive rate. |
| MB-040 | P1 | open | The one-to-four-game stratified canary has no target-population or inclusion-probability contract proving results generalize to the full product slate. | Freeze the full sampling frame, eligibility/exclusion reasons, strata, and inclusion probabilities; qualify on full-slate shadow or design-weighted estimates with subgroup and mixture-shift tests. |
| MB-041 | Blocker | open | Evaluation, run summaries, and human audit dossiers trust caller-supplied sequence/evaluation objects rather than persisted replay-derived receipts. | Persist canonical evaluation receipts bound to attested input, prediction, deterministic outcome revision, manifest, quote, and consequence releases; summaries/dossiers reload receipts and recompute; forged/edited rows fail in PostgreSQL and after restart. |

## Required acceptance amendments

The final independent round found no other root-cause category, but it materially strengthened these
existing closure proofs:

- **MB-003 / MB-038:** feature-off parity includes latency, memory, timeout, exception behavior,
  Sharp split semantics, collector release behavior, and every route side effect—not only identical
  payload bytes.
- **MB-004:** malformed research configuration is injected before and after current-season state
  refresh; authoritative NFL, player-prop, member, tracking, and state-write effects must remain
  identical.
- **MB-009 / MB-012 / MB-036:** enforce and test the complete server chronology:
  manifest receipt ≤ attempt/captures ≤ capture-set receipt ≤ research-input receipt ≤ inference time
  ≤ prediction receipt < kickoff.
- **MB-011 / MB-018:** every training label receipt and authoritative correction revision must exist
  before each rolling validation cutoff. Fold membership/order is derived from immutable chronology;
  a late Fold A result cannot train Fold B.
- **MB-016 / MB-021:** every independent prior carries immutable as-of input lineage. Context already
  incorporated into the prior cannot be counted again; unknown-lineage priors cannot qualify.
- **MB-016 / MB-020 / MB-021:** split evidence has a source-specific measurement contract for
  cohort/line, cadence, staleness, rounding, and denominator/handle/count uncertainty. Unknown-
  denominator percentages are not treated as equally precise and cannot alone force a flip.
- **MB-016 / MB-029:** preserve raw two-sided quotes and predeclare no-vig methods. Pure hold changes
  cannot masquerade as direction; method-sensitive cases stand down.
- **MB-018 / MB-037:** artifacts have a validity horizon, compatible source roster, drift/recalibration
  rules, and automatic shadow fallback. Retraining/recalibration creates a new registered release.
- **MB-019:** corrected losses and harms are classified against exact locked incumbent actions—not the
  independent prior—and include a strictly post-inference, input-isolated closing-market/CLV process
  diagnostic without treating the close as a training label.
- **MB-021 / MB-029:** `leader`/`follower` is descriptive temporal order unless causal evidence exists.
  Common-news shocks, feed delay, clock-error bands, and polling-order permutations cannot manufacture
  a causal signal.
- **MB-027 / MB-028:** the singular score posterior is quote-selection independent. Permuting the
  incumbent-selected operator, quote identity, price, or menu order leaves features/posterior byte-
  identical; only consequence economics change. Equal/near-equal probabilities use an explicit,
  permutation-invariant uncertainty/stand-down rule.
- **MB-037:** cost closure includes hard event/attempt/state/operation bounds, CPU, RAM, duration,
  cancellation, queue concurrency, and measured p50/p95 fit telemetry. One-over-limit fails before
  allocation and cancellation cannot persist an artifact.

## Explicitly preserved findings

- Market Brain remains disabled and has no current member-facing authority.
- Locked records are not reinterpreted or overwritten by this branch.
- Research sidecars are stripped from authoritative stored payloads.
- Existing provider HTTP responses are intended to be reused rather than duplicated; MB-003 must be
  closed without increasing request volume.
- NFL implementation does not grant authority to any other sport or player-prop model.

## Remediation progress — not closure

The following work is prepared on the isolated remediation branch. Every item remains `open` until
the closure rules above are satisfied; this log prevents a green unit suite from being mistaken for
database, predictive, or production proof.

- **MB-001 / MB-010 / MB-033 / MB-036:**
  `lib/db/schema-migration-v46-nfl-market-brain-proof-boundary.sql` is a forward-only transaction
  with explicit paths for both the exact frozen two-table v45 fixture and the later expanded nine-table
  v45 source. It refuses nonempty or partial legacy shapes, binds required JSON fields fail-closed to
  relational identity/count/time columns, adds one finalized-window identity, and enforces manifest →
  capture set → research input → inference → prediction receipt order. The prepared PostgreSQL fixture
  now persists a manifest → capture → capture-set → research-input → artifact → prediction → verified
  NFL outcome lifecycle, rejects pre-cutoff and post-receipt inference, and attempts direct event,
  release, timestamp, source-table, final-time, and sport forgeries. Its payload prelude is emitted by
  the production canonical JavaScript serializer rather than PostgreSQL `jsonb::text`.
  `scripts/test-nfl-market-brain-postgres-v46.sh` and
  `.github/workflows/market-brain-postgres-proof.yml` prepare PostgreSQL 16 execution of old-v45 →
  v46, refusal, second apply, RLS/catalog, and canonical-hash checks. This host has no PostgreSQL
  runtime, so the real-database command has **not** executed and these IDs are not closed.
- **MB-003 / MB-004:** raw response archival is explicit research opt-in; a bounded JSON preflight now
  counts string and key serialization bytes without materializing an unbounded escaped JSON copy,
  and raw provider-response digests stream JSON-equivalent bytes into SHA-256 rather than first
  materializing the whole serialized page. The preflight rejects oversize/deep/non-JSON/accessor
  payloads before cloning the full response, and archive failures remain
  research-only. Malformed dormant config is not parsed; enabled schedules are structurally validated
  before raw archival, and selected attempt windows validate before any research database read. Focused
  foundation, writer, proof-chain, and feature-off tests pass. A separate runner and measured base-versus-
  candidate latency/RAM/exception proof remain required.
- **MB-034:** canonical JSON now uses explicit UTF-16 code-unit order, rejects non-finite numbers,
  normalizes negative zero, rejects cycles, sparse arrays, accessors, non-JSON primitives, and non-plain
  objects, and has a fixed JS golden vector. Canonical-hash writers explicitly persist the r3 release,
  and the PostgreSQL lifecycle fixture now consumes JavaScript-emitted r3 bytes. Database rejection of
  semantically equivalent noncanonical direct inserts and multi-Node/locale execution remain open; the
  PostgreSQL fixture has not run on this host.
- **MB-035:** raw parser archives now use `(schema_release, parser_input_sha256)` as their relational
  identity, shadow source manifests retain both components, and the store rejects a non-null manifest
  reference unless that exact composite archive is present in the same payload. The PostgreSQL collision
  fixture is prepared but has not run here; a relational child FK and atomic write remain open under
  MB-024.
- **MB-023:** Market Brain retention was removed from the shared production cleanup route and placed in
  a separate leased/authenticated route that is disabled by default and intentionally unscheduled. It
  reports shadow, prior-artifact, and raw-parser deletion counts, per-class cap hits, remaining bytes,
  and the three retention horizons. Unit and route-isolation tests pass; PostgreSQL execution, scheduling
  approval, and alert integration remain outstanding.
- **MB-025:** outcome rows now carry exact canonical source-row bytes including sport, the database
  verifies their digest, and the receipt trigger requires the source table label, NFL sport, final
  timestamp, scores, provider IDs, and update time to match the finalized `games` row. Correction
  precedence and adversarial PostgreSQL execution remain open.
- **MB-033 / MB-036:** shadow r15 adds one explicit success/failure union. Both shapes bind release,
  contract, event and capture time; success also binds NFL sport and requires evaluation no later than
  server receipt, while failure requires the fixed failed status, no production authority and a
  nonempty reason. The lifecycle fixture now includes a success-shaped row and contract/event/time
  forgeries, but most prerequisite receipt triggers still require a future no-bypass real-PostgreSQL
  lifecycle proof.
- **MB-038:** feature-off provider results, split semantics, request counts, oversized-response behavior,
  and route response isolation pass `scripts/test-nfl-market-brain-production-neutrality.ts`.
  The candidate branch still truthfully carries new writer/collector identities; repository safety
  rejected relabeling changed orchestration as the older production releases. Full base-versus-candidate
  product/lock parity and the final release boundary therefore remain open.

Verification recorded for this slice:

- `npm run test:market-brain-foundation` — passed.
- `npx tsx scripts/test-nfl-market-brain-production-neutrality.ts` — passed.
- `npx tsc --noEmit --incremental false` — passed.
- `npm run verify:model-change` — passed; its post-step explicitly reported the PostgreSQL proof
  skipped because `MARKET_BRAIN_POSTGRES_URL` was unset.

No migration was applied, no capture flag was enabled, and no production/member/grade/stake/lock
authority changed.

## Review reconciliation

The exhaustive review reconciled all findings into MB-001 through MB-041. Implementation proceeds in
this dependency order:

1. production neutrality and a forward, real-PostgreSQL-tested schema boundary (MB-001, MB-003,
   MB-004, MB-010, MB-033, MB-034, MB-036, MB-038);
2. possible, durable, restart-safe collection and attempt lifecycle (MB-002, MB-005–MB-009,
   MB-013, MB-014, MB-023, MB-024, MB-030, MB-035, MB-037);
3. derivation and outcome integrity (MB-011, MB-012, MB-025, MB-031);
4. model, ablation, capacity, calibration, and executable behavior correctness (MB-015–MB-018,
   MB-020, MB-021, MB-029, MB-032, MB-039, MB-040);
5. exact decision consequences and corrected-loss/new-harm evaluation (MB-019, MB-027, MB-028,
   MB-041);
6. documentation reconciliation and separately qualified sport/league/prop adapters (MB-022,
   MB-026).

No migration, disabled-code deployment, or shadow canary is permitted while any Blocker is open.
No predictive qualification is permitted while any P1 is open. A closure review must reconcile
against these IDs and acceptance proofs rather than start another independent issue list.
