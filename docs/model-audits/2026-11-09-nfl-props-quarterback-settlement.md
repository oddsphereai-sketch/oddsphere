# NFL quarterback result settlement — November 9

Base: `8b7ae01104302f4331aaa16939d86d619e877f38`.

The day-after launch read-only audit found that offered `passing_tds` and
`interceptions` rows were stored but the settlement market whitelist predated
those heads. They remained pending after exact-game final stats were available.
This change uses `passing_touchdowns` (or its normalized `passing_tds` field)
and `passing_interceptions`. Defensive `interceptions` must never substitute
for interceptions thrown; passing touchdowns do not count as anytime scoring
touchdowns. Only explicit nonnegative safe integer values are admitted. A
missing field is not reconstructed as zero. These heads do not add snap-count
lookups or any provider request beyond the existing bounded game stats call.

Settlement R6 and sole writer R78 identify the result-processing correction.
No prediction, probability, price, grade, promotion/demotion, stake, model input,
AI generation/selection, member reader, tracking key, schedule, lease or budget
changes. Board-count impact is zero promotions and zero demotions. Existing
settled outcomes are not reprocessed; unresolved legacy provider identities
remain excluded unless separately owner-approved. Normal processing can fill
pending `actual_value`, `result`, `settled_at`, `updated_at` only. Locked source
fields and snapshot JSON remain authoritative and immutable.

Focused mocked settlement tests cover winning/losing/zero/push outcomes, field
aliases, passing-versus-defensive/scoring separation, missing/invalid values,
one-call bounds, and outcome-only mutation. Existing wrong-game/team/finality,
participation, bounded backlog, legacy identity and recovery tests remain.
The new regression is explicitly included in protected PostgreSQL-proof CI.
Mandatory full model gate, focused lock/reader/tracking checks, build, types,
lint, fresh-main integration safety and protected PR checks apply. No paid
proof runs or manual production cron calls are authorized. Verify the actual
R78 snapshot and normal pending settlement after deployment; code passing
tests alone does not establish live completion.

Rollback restores settlement R5/writer R77 in a fresh protected PR. Preserve
any legitimately settled results and all locked data; never reset completed
reviews or settlement records as part of rollback.
