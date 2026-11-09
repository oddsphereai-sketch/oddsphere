# Standard primary funding and correction escrow

Task started exact main1a67c1da5d4a7dd80691340e1c8305de420f9939 in a separate
worktree and fast-forwarded to R24main9c81679fd53d35d2c3c8f96b08ab233b770c2069
before editing. The independent review found two prospective funding issues:
early slots were planned at discounted Flex bounds while claims escrowed Standard,
and correction requested another full failed-part envelope even when known low
primary costs left sufficient money in the active whole-job escrow.

V68 replaces only installed v64 planner, v64/v66 claim and v62 fallback functions.
It verifies exact old/new prosrc hashes, SECURITY DEFINER/fixed search path,
paid-off control and zero running jobs under the existing short wallet mutex.
Remaining pending primary reserves become Standard after full-calendar planning;
primary requests are Standard for both stages, using the same low-cost Luna model.
This prevents Flex capacity rejection consuming the only correction phase. Standard
capacity/rate/quota errors can still occur and are not treated as known-unbilled.

All primary attempts must be completed with non-null actual cost before fallback.
Additional escrow is max(0,sum(all primary actual)+failed Standard bound-current
job escrow). Only failed parts receive phase2. A fully paid invalid primary may
still require additional correction funds; this does not promise every possible
two-paid-phase month fits the cap. Unknown charges retain reservations and cannot
be reset, refunded or blindly retried. Finish/receipts remain unchanged.

Optional stronger finals retain daily/monthly10% and target-after-core checks,
with primary contingency. No new job/writer/phase/review/provider call, output
cap, concurrency increase, model numerical formula, grade or schedule. Target50,
emergency60 and protected pools remain exact. R25/budgetR5/writerR87 version the
operational cutover. R24 wire/source semantics and historical law/lock precedence
remain unchanged. Same canonical law has zero promotions/demotions or side/stake
changes; paired qualified Over/Under and refusal controls remain required.

## Installation and natural proof

Never pause a running review: v63 off blocks its next send. Use a measured normal
no-due window and authoritative complete calendars; under wallet mutex recheck zero
running jobs and sufficient no-due horizon, then turn the existing control off.
Keep all old invocations/leases intact and allow them to finish naturally. Install
matching SQL/runtime. Old cached-paid writers can still attempt old planning; wait
them out before final funding verification. Do not move clocks to create a window.

Normal siteRuntime skips planning while off. Either reconcile exact trusted full
calendar through existing plan_v3 while off (no model/token-count call), or enable
in a verified no-due interval and let the next ordinary new-runtime writer do its
existing calendar->plan->claim flow. R5 stamp prevents claims against old R4 funding.
Verify genuine all-Standard funding before any next due boundary, retaining all
closed jobs/receipts/locks exactly. If insufficient window/funding, report/postpone;
never relabel old funding, force a cron, replay a failed review or raise the cap.

## Offline verification

The native synthetic214NBA/71NFL calendar tests570 Standard primary completions,
sixteen independent concurrent claims, a deferred seventeenth, exact no-extra-money
known-zero correction, mixed paid/unknown/overrun cases, stronger contingencies,
wrong-token/sport-lease/month/phase/closed/lock guards, infeasible whole-month refusal
and exact historical row preservation. It creates/drops only its unique disposable
database, requires marked private TCP-off Unix PostgreSQL locally or explicitly
gated GitHub disposable loopback service, and uses no HTTP/application credentials.
The real reviewer/wallet integration mocks ALL model HTTP, proves Standard429 alias
stays unknown/no phase2, exact receipts, successful-part evidence, bounded correction,
no successful-part replay and retained locks/results. CI runs both native proofs.

Standard primary funding is a conservative reservation policy, not an invoice or
full infrastructure estimate. Early Standard can cost more than successful Flex;
actual inputs/corrections/unknown holds may differ. Native database tests, full
model gate, TypeScript/lint/build, fresh-main protected PR and actual live funding/
release/normal review/member publication remain required. No paid proof is needed
or authorized; source-only checks do not establish forward prediction accuracy.
