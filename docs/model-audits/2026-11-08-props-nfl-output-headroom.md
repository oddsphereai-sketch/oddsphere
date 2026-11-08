# NFL output headroom without extra review slots

Base: `a0b19d225c63bcceb3da35573efae568656b5b6d`.

A normal R15 NFL final failed with generation_incomplete. Its stored receipt
shows one part reached the configured 7,000-token output ceiling; the other
parts completed. The complete review guard correctly refused to call that final
complete, and the completion-deadline guard refused a late recovery. No failed
slot is reset or silently repurchased by this release. Source evidence/readings
from an incomplete response are never fabricated into a completed evaluation.

Future generations stamp R16; writer R75 identifies the NFL input-group change.
NFL source packets target four actors per request where possible, with an
adaptive bound up to eight to retain the ordinary eight-part completion allowance.
For example, 43 actors use eight parts with at most six actors, rather than six
parts with up to eight actors. All stats, context, offered scopes and peer
baselines remain intact. Bins respect actor limits while balancing input size.
Larger universes retain the preceding sixteen-part/128-actor capacity. The authoritative token counter remains
required before funding, and the output ceiling remains 7,000. NBA and MLB
batching/instructions and the physical wire, law, estimated-confidence, grade and
price formulas stay exact. Future NBA/MLB AI generations share the R16 stamp for
one authoritative runtime; their numerical prior/model and batching are unchanged.

Accepted R15 laws stay usable under R15. They are not regenerated, relabeled or
blended with R16 performance. Final retains precedence and unchanged per-player
context/scope checks still apply. Existing locked records remain exact. The same
sport lease, stage purchase identity, wallet and stronger-final limits govern all
requests; no new provider call, timer, review slot or paid test is introduced.

The NFL monthly default source envelope reserves eight 60,000-input/7,000-output
parts instead of four 115,000-input/7,000-output parts. At configured primary
rates this is 76,000 versus 60,000 microdollars reserved per slot, not measured
charges. This protects more output headroom within the same full-month funding
process. Actual larger packets still need full counted funding, with no source
truncation. The $50 target/$60 emergency cap remain exact. Calendar fixture capture
and all NBA/MLB default envelopes are unchanged. New grouping may change future
AI forecasts and input repetition; no accuracy or exact monthly bill is claimed.

Required proof: offline complete 43-actor/8-part and 128-actor/16-part coverage,
unchanged evidence/markets, bounded output, unchanged NBA grouping, immutable R15
selection and skipped closed jobs, updated monthly-envelope arithmetic, existing
source/reader/lock/grade controls, full model gate, lint/TypeScript/build, clean
latest-main protected PR and natural live runtime/funding/publication proof. No
manual token count, generation test or cron. Smaller batches add output margin;
they cannot guarantee that a provider will never return incomplete/failed output.
Hold on omitted scopes, changed locked fields, repurchased slots, an unfunded
month or deadline/usage growth. Retain only source-valid completed laws.
