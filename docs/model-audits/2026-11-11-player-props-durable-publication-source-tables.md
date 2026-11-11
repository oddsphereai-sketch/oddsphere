# Player-prop source tables and durable publication — November 11

## Scope and trigger

The owner requested complete NBA/NFL/MLB evidence reading, two reviews per game,
correct member publication and internal tracking, with no further paid tests.
A completed NBA game review could remain only in process memory while another
review consumed the route budget. Repeated source structures also consumed most
input tokens. Completion counts alone did not establish member publication.

## Prospective changes

Generation R32 uses lossless named source tables. All input players, markets,
clocks, precision, source values and typed reading catalogs are retained. Stored
v1/v2 formats and accepted R31 medical semantics keep their original contracts.
Native MLB R44, selection R6, NFL decision R13 and grade R3 do not change.

NBA writer R19 awaits serialized per-game canonical writes in the existing
sport-leased writer. It advances only that game's lifecycle and preserves other
games and every stored lock. A later callback failure does not discard an
already durable game or block a separate valid game, but the overall cycle still
reports failure. A later-starting game cannot advance the slate publication
header until due existing canonical games have passed through their original
first-lock authority. Their exact published values survive a later route failure
and the next invocation. If due rows are ineligible and removal leaves an empty
intermediate board, their removal is composed with the valid ready game rather
than authorizing a generic empty write or blocking that game. Actual current
execution authority is required for publication.
Explicit complete-empty withdrawal has sealed process-owned authority; optional
feed failure and partial observations cannot authorize an empty board.

V71 is additive, atomic and service-only. It checks the existing NBA lease,
canonical checksum and server time before and after its upsert. Late writes or
expired ownership roll back. Returned timestamps describe server admission and
write completion; they do not claim transaction commit or client acknowledgment
before lock. Original captured prelock/locked-record precedence remains exact.
NFL writer R93 identifies the shared input serialization change; its publication
path and source qualification remain unchanged.

## Decision and board impact

No grade threshold, probability formula, quota, stake, market selection or native
model is tuned from the launch-day results. Therefore there is no proposed
threshold-based actionable demotion needing an offsetting promotion. Exact
source round trips and unchanged law/grade fixtures establish zero deterministic
forecast or promotion/demotion changes for an existing accepted review. A future
AI run can choose a different law under the new input representation and must
pass the existing full admission contract. Valid Over and Under publication and
return-after-withdrawal controls both remain required. No retrospective board is
regenerated or presented as current-model performance.

## Cost and operational limits

This repair removes redundant representation rather than evidence or coverage.
Local tokenizers and archived packets can estimate input savings; only ordinary
production receipts can measure actual cost and quality after deployment.
Correction-heavy or larger future slates can exceed the monthly target. The
existing $50 target and $60 emergency stop remain; a stop cannot be described as
full coverage. No paid proof run, manual cron, replay, third review, extra source
request, output cap increase or unknown-charge release is authorized here.

## Verification and release gates

Required focused checks cover exact source round trips and malformed bounds,
legacy reader contexts, actual writer callbacks, failure isolation, same-ID label
changes, source withdrawal/return, current quote binding, old native/AI locks,
first-lock tracking and all supported sport adapters. Exact V71 runs against a
new disposable PostgreSQL database with ACL, CAS race, wrong/expired owner,
queued and trigger-delayed cutoff, post-upsert lease expiry and rollback checks.
No production credentials or HTTP requests are used by those tests.

Run the full model-change gate, full TypeScript, lint and build. Obtain two
consecutive rounds of three fresh full-product reviewers on unchanged code;
any correction resets the streak. Integrate latest main, pass the protected PR
checks with exact local/remote tree proof, install exact published V71, merge and
verify the actual production source. Ordinary scheduled reviews must then prove
source/actor/scope/part admission, actual timely member publication, immutable
locks and recorded usage. Deployment and green offline checks are not that proof.

Rollback affects only future execution: preserve all accepted/locked payloads,
keep additive V71 available for compatibility, and restore the complete previous
writer/input release together through a protected change. Never rewrite missed
historical slots, public locks or internal outcomes during rollback.
