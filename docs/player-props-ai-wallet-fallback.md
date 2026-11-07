# Player-prop AI full-source wallet and fallback integration

Base: `e008a0fd4f22653a8fde8690b87d38d4d1ac3cf2`. Runtime R12:
`player_props_ai_2026_11_07_r12_funded_partial_fallback`; wallet R3:
`player_props_ai_budget_2026_11_07_r3_full_source_wallet`.
NBA/NFL/MLB forecast semantics, canonical law, grade policy and two-window schedule
remain those of the R11 format rehearsal. No production prediction, stake, member
writer, lock or tracking row is changed by this wallet integration.

Open-PR overlap review at this base: #877 and #606 add unrelated CFB/governance
sections in `model-change-safety.md`; #877, #811 and #676 add unrelated CFB/NFL
registry entries. This branch retains the fresh-main content and adds only the
scoped owner-directed prop process exception and candidate registry entry. It
does not restore those PRs' older runtime releases or edit their runtime files.
Either branch must repeat fresh-base integration if another PR merges first.

## Funding and concurrency

Apply `schema-migration-v61-player-props-ai-runtime.sql`, then
`schema-migration-v62-player-props-ai-wallet.sql`. V62 removes legacy fixed-allowance
planning and repair RPCs. It is idempotent, restricts every RPC to the service role,
keeps private financial helpers inaccessible, and preserves existing accepted results.

`makePropsWalletPlan` takes the complete canonical game calendar, actual lock clocks,
measured full-source request envelopes and explicit complete/no-games source manifests
for all three sports. A current-slate list cannot stand in for the whole month.
It keeps two companion slots for every game date, including stages in adjacent UTC
billing months. Requests are priced individually, including 2,048 input-token headroom
and the output bound. Neither games nor players nor markets are removed to fit a cap.

The database recomputes all quotes using exact integer ceilings. It protects pending
core reviews, an additional Standard-attempt pool for ten percent of early slots,
and a separate recovery pool. The default monthly authorization ceiling is fifty
dollars; it cannot exceed fifty. A changed plan must retain every pending obligation.
An unfunded complete plan returns an explicit funding error, creates no partial new
job list and blocks further claims until a complete revision is funded. Started
reviews cannot be moved or rewritten. Pending late reviews can transfer their core
reservation into the actual new UTC month before any new request is sent.

Atomic wallet mutations share one short advisory mutex across sports and months.
No HTTP request runs inside that transaction. Claims require the existing
`prediction_pipeline:<sport>` writer lease and its exact run ID; sends, fallback and
acceptance recheck it. At most two game reviews run concurrently. More than four
whole-player parts are supported, up to sixteen, with at most four HTTP calls per
review at once. Oversized inputs fail explicitly rather than drop a player/market.

## Real reviewer and fallback path

The existing `runPropsReview` uses this wallet. `dispatchFundedPropsReviews` is the
bounded caller hook for the existing sport writer after its normal collection and
while its shared lease is held. It accepts the caller's complete frozen source packet;
it does not create a provider collector, timer, member writer or public request path.
Results include an explicit keep-independent operational fallback when AI is absent.
The hook itself never overwrites grades, independent forecasts or locked snapshots.

Early requests use Luna Flex; final requests use Luna Standard. A stronger Standard
final may replace at most ten percent of the month's final slots, only from money
remaining after all core/pool obligations. That upgrade also escrows a complete
primary-model fallback. It cannot draw from protected future core/pool funds.

Every initial request escrows its Standard price, even when requesting Flex. Actual
confirmed tiers determine the receipt charge; an absent/unknown tier costs Standard
conservatively. Explicit no-write cache settings remain in the request. Cache writes,
if nevertheless reported, remain billable. Client billing uses integer rational
arithmetic matching PostgreSQL, avoiding floating-point rounding over a valid bound.

An explicit Flex resource-unavailable response is recorded as unbilled. Generic
rate limits, timeouts, missing/invalid usage and unknown completions retain the full
reservation and cannot trigger blind retries. Complete but invalid structured output
retains its actual charge. At most one fallback phase is allowed on the same frozen
input: only failed whole-player parts retry with Luna Standard. Successful parts are
retained exactly. Every accepted result includes per-part model, tier, response ID,
phase and player provenance; a mixed stronger/primary result is labeled as mixed.
No third logical review or hourly inference is created.

Finishing refunds unsent requests and unused escrow, restores drawn protected pools
first, and retains unknown sent charges. Late verified usage can reconcile a held
charge but cannot resurrect or replace a failed/completed review. Repeated known
receipts must match exactly. A reaper settles abandoned workers without replaying
requests. Completion after lock, under a lost lease, or without every player part is
rejected; the prior independent/member publication remains authoritative.

Unexpected vendor usage above an authorized bound is recorded as actual spending,
with a separately visible overrun. It freezes new authorizations rather than discard
the receipt or silently raise the cap. This is an application authorization ceiling,
not a claim that a vendor can never violate an envelope or that other API products
under the same key are covered by this wallet.

## Verification and rollout

`test-player-props-ai-wallet.ts` runs the real reviewer/client/parser and exact v61/v62
SQL against a disposable local PostgreSQL database. Every AI HTTP response is mocked;
no key, provider call, production DB connection or paid generation is used. It proves
partial Flex and stronger fallback, unknown-charge retention/late reconciliation,
duplicate and competing claims, two-stage UTC rollover, lease loss, immutable accepted
results, exact per-request funding, an unfunded full-calendar refusal, a tight month
whose optional upgrades stop before core funding, a five-part forty-player accepted
review, lock cutoff, migration reapplication and RLS. The old `.mjs` PostgreSQL test is
the historical v61 proof only, not current wallet qualification.

Financial maintenance is separate from generation:

```bash
# Preview only; no key, database connection, provider call or generation.
node --import tsx ops-local/player-props-ai/wallet.ts --mode=plan \
  --month=YYYY-MM --input=/private/tmp/CANONICAL_MONTH.json \
  --out=/private/tmp/NEW_PLAN_REVIEW.json

# After a complete plan is reviewed, --apply=true only funds jobs through the RPC.
# Status reads use --mode=status. Both need the existing server DB environment.
# This command intentionally has no inference mode.
```

Input contains `games`, per-game/per-slot `bounds`, and all-sport `sources` matching
`makePropsWalletPlan`. An initial local quote is diagnostic; admission includes all
already spent and unknown held amounts in the database. Public schedule IDs must be
resolved to the existing writer's canonical game IDs before live admission.

This implementation is not proof of production activation. Rollout still requires
the fresh-main protected PR, migration/permissions verification, full-source canonical
month admission, and the existing sport writer's source/grade/lock integration gates.
Do not enable a separate timer, spend on a smoke generation, or label historical R11
receipts as R12 inference tests. Full/focused model checks, exact immutable lock reader
precedence and post-deployment release/health proof remain required. Actual API
availability, inference quality and monthly realized usage continue to be measured
forward; synthetic failures do not prove real Flex availability. The previous private
monthly cost report remains a workload estimate, not a guarantee of uninterrupted AI
under arbitrary failures while enforcing a fixed cap.
