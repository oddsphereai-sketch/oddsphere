# Complete-phase time admission and scheduled prop priority

Starting main: `a4011d8f89ebaf253e0ad3cf0d6e933d3acf3ab9`.
Task branch: `codex/props-ai-two-phase-window-20261111`.

## Problem and resulting behavior

An ordinary production review could claim money with enough time for one wave
but insufficient time for its already budgeted correction. A valid HTTP response
with an invalid numerical draft then closed the game without sending correction.
The sole NBA writer also began props after long Daily Edge work; subsequent
ordinary invocations could end before their lifecycle closed while due prop slots
remained pending. These are process defects, independent of betting outcomes.

The shared reviewer and preparer reserve both complete phases before claiming.
The existing single-phase function stays unchanged for correction-phase checks.
Primary request timeouts reserve the correction, future waves and final handoff;
checks after acknowledgement/serialization use actual remaining time. A request
that never reached HTTP records a known zero and cannot buy its first response
under the name of correction. Known dispatched recovery and unknown-charge holds
keep their existing semantics. No validation rule is weakened to accept a draft.

Within the existing sport lease, NBA due props starts before independent Daily
Edge work and is awaited even if Daily Edge throws. Its source fetches share an
absolute preparation deadline derived from the remaining complete-phase reserve;
late non-due native lock processing does not reserve a hypothetical paid review.
The NFL products reuse their one refreshed current-season state and their same
leased handler; the prop promise is awaited before lease release on every exit.
MLB remains its existing sole prop route. NFL/MLB route ceilings are 540 seconds,
leases 600 seconds, and their explicit AI deadline is request start plus 480
seconds, including waits and source work. A new invocation cannot reset an old
invocation's elapsed time. Native forecasts, collection budgets and cadence stay
unchanged.

## Scope and release identities

Shared generation R33; operations R5; NBA route R26, rescue R2 and writer R20;
NFL writer `nfl_player_props_writer_2026_11_11_r94_two_phase_execution_window`.
Named source tablesV3, wireR5, factual claimsR1, source contextR1, selectionR6,
NFL decisionR13, gradeR3, scheduleR3 and budgetR5 retain their own semantics.
Native MLB `mlb_props_2026_10_21_r44` is unchanged. R32 and older accepted laws
retain their original releases and exact reader/lock precedence.

## Impact and limits

Same input and accepted law produce exactly the same projection, probability,
price, confidence, grade and stake: zero numerical/policy promotions or demotions.
Avoiding a doomed purchase can leave a slot unclaimed until its next ordinary
opportunity. This is explicit incomplete coverage, never a completed evaluation.
A crowded slate or an unavailable vendor can still exceed the bounded runtime;
no universal completion or $50 monthly guarantee follows from time admission.
Both windows, every actual submitted player/market, real publication and exact
locks require normal production observation. No paid tests or forced reviews are
part of this repair. No closed historical job, old law, result or public lock is
rewritten. Tracking and diagnostic reports stay internal.

A current cached-source reconstruction cannot substitute for the actual source
submitted or consumed by a publication callback. In particular, missing cached
same-cycle medical envelopes do not independently prove a substantive medical
change. A new offered scope is distinct from an unreviewed actor. Preserve those
limits in operational reporting instead of weakening context checks.

## Internal actual-source provenance

The existing NBA canonical write carries optional source auditR1 metadata from
its actual publication callbacks. Each bounded audit binds current packet and
accepted immutable input hashes, actor/scope inventories, canonical and
availability hashes, hashed source changes and participation qualification.
Missing archives, unsupported legacy contracts and capacity overflow are
explicit. It neither replaces a source nor changes a decision, and no raw
source values or player names are included in the audit. Existing public locks
remain exactly authoritative. The audit is private operational provenance, not
a results page, independent provider attestation or complete-collector proof.
This specifically addresses the inability to diagnose a publication withdrawal
from later incomplete caches; it cannot retrospectively prove an old callback.

## Required verification

Use virtual delays with actual reviewer/route code for both phases, all sixteen
parts, retained successes, known receipts, input count drainage, admission and
request queues, late acknowledgements, lock crossings, stale source preparation,
Daily Edge exceptions, shared-state reuse and same pending logical-slot rescue.
Prove unchanged legacy locks and exact member precedence, original request clocks,
540-second route manifests and the shared lease. Run full focused/model gates,
TypeScript, lint, webpack build, real disposable PostgreSQL proofs, two fresh
consecutive rounds of three whole-product reviewers, latest-main integration and
protected exact-tree PR checks. Deployment alone is not live review proof.
