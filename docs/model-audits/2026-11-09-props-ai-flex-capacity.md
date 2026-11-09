# Flex capacity compatibility repair

Base `1c01ba471d43d76c2fe99f2fc897be5ac7178d54`.

The transport preserved `error.code` before `error.type`, but its uncharged
capacity allowlist recognized only older resource-unavailable code strings.
A structured `{code:"flex_unavailable",type:"resource_unavailable"}` response
therefore became an unknown billed outcome and blocked the already-funded second
phase. R20 diagnostics make this incompatibility observable without a paid probe.

R21 recognizes only explicit HTTP429 Flex capacity rejects with consistent known
code/type. Type-only legacy capacity remains supported. A conflicting explicit
quota/rate code cannot borrow a generic type to claim an uncharged result. Neither
a default-tier error nor another HTTP status qualifies. Sanitization and exact
private transport metadata remain intact.

OpenAI documents this resource rejection as uncharged and recommends Standard
processing as one recovery option: [Flex processing](https://developers.openai.com/api/docs/guides/flex-processing).
The structured Flex code is also documented in [error recovery](https://developers.openai.com/api/docs/guides/agents-api/errors).
The existing wallet already authorizes Standard recovery after an explicit
uncharged capacity reject. No budget function, reserve, cap, output limit, phase,
request count, game slot, source, writer lease or model selection rule is added.
A valid earlier part remains accepted; only failed parts can enter phase two.
Transport feedback makes clear no prior draft was accepted and adds no new
statistical evidence or confidence endorsement.

Synthetic transport tests cover the exact variant, type-only compatibility,
wrong tier/status, contradictory quota/rate types and preserved diagnostics.
Real disposable PostgreSQL reviewer tests use every AI HTTP request mocked and
verify a zero receipt followed by exactly one Standard recovery, unchanged
successful parts, correct phase/tier provenance, unknown-charge protections and
closed-slot refusal. Existing physical/source/price/lock tests and full model
safety gates remain required.

The broader queue/deadline/reaper and account-wide pacing designs remain separate
unactivated investigations. This patch does not infer a token-rate limit from a
Flex-capacity error. Historical closed failures and unresolved old receipts stay
unchanged; no paid proof or closed-slot replay is authorized. Observe the next
normal scheduled review and exact member publication rather than buying a test.

Standard service costs more per accepted token than discounted Flex; the wallet
already protects that rate. Monthly projections must distinguish Flex-success
and Standard-recovery scenarios and retain actual service-tier receipts. The
$50 monthly figure remains a target with $60 emergency authorization, not an
unconditional price guarantee.
