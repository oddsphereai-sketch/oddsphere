# NBA filtered-player identity completeness — predeclaration

Base: `692dd04be61895839c3cc5925304a5e58d9cf707`.
Scope: the existing NBA collector's bounded current-player metadata responses,
NBA collector release R10 and sole NBA writer R33. Shared AI generation R51,
source R4, law R4/grade R6/selection R9, NFL writer R112, native MLB R44, model
math, request/slot/phase/output caps, cadence, provider request counts, budgets,
shared sport lease, source context and immutable locked/member rows stay exact.
No UI or public transport change is intended.

Wednesday's stored source diagnostics hold HOU–IND and DET–NOP for unavailable
player/team identity. Retained same-cycle quotes contain one actor per game with
no current team declaration. These caches are not the complete original current
collector set, and the actual original metadata lookup body/error is not retained.
Do not claim a provider fault or this code path as the established incident cause.

An independently reproducible false hold exists: the collector applies a generic
no-continuation guard before validating a closed, explicitly requested set of at
most 100 player IDs. A response can contain every requested ID exactly once and
still carry the documented player endpoint's pagination cursor. Generic cursor
rejection then discards all valid current identity records. The proposed boundary
first proves the exact finite requested-ID set, then permits only a well-formed
`meta.next_cursor` on that fully reconciled response. It does not follow pages,
retry, add requests, infer teams from history, omit actors or relax name/team,
current fixture, freshness, numerical, price or factual validation. Missing,
extra, duplicate, malformed or conflicting records remain unavailable. Other
continuation/envelope inconsistencies remain rejected.

Use the existing `/v1/players` endpoint and 100-ID batch boundary. Public contract:
https://docs.balldontlie.io/#get-all-players . No manual provider API call is
performed without explicit permission under the earlier monitoring restriction;
no AI, model, token-count or extra paid test is authorized. The owner explicitly approved one metadata-only lookup for the two affected
IDs. That single response returned HTTP200, both requested IDs and correct
current fixture teams, without a cursor; both old and proposed validators accept
it. The retained ordinary same-cycle cache has exactly100 missing-identity IDs
with no identity-receipt clocks, while later rows carry receipts. This aligns
with the proven full-100-ID cursor rejection, but the original100-ID response
is unavailable and its exact cause remains an inference. No second diagnostic
provider request or model/token-count call was made.

Required controls: complete filtered cursor responses for primary and reference
actors, exact IDs at batch boundaries, missing/extra/duplicate IDs, invalid cursor,
malformed envelope, unsupported continuation, invalid/coincident teams, receipt
clock versus quote clock, wrong fixture, actual source request and native/member
binding, original source/context hash stability and locked payload precedence.
Report actual old/new availability and paired supported Over/Under recovery;
there is no grade/demotion/promotion rule change or fabricated recovery count.

Before publication: full affected focused/model/type/lint/build, hosted real
PostgreSQL with all AI mocked, two NEW consecutive rounds of THREE FRESH
whole-product reviewers CLEAR on unchanged final head, latest-main integration
and no overlapping uncommitted files, strict up-to-date/no-bypass protected PR
with exact expected head/tree, actual Ready/Current/Production/www source, then
ONLY ordinary scheduled source/review/member/refresh/lock/tracking proof.
Do not call Wednesday resolved unless the actual affected games recover under
those ordinary production observations. Genuine unavailable current identities
remain explicit holds; no historical last-played team is allowed as authority.
