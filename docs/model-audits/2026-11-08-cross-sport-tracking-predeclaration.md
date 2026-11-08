# Cross-sport tracking verification and prevention — predeclaration

Base: 045b233e9fee95022a0b2c94ec149622fb7706f6.
Scope: Daily Edge MLB, NBA, WNBA, NHL, NFL, CFB, CBB, World Cup, EPL and UCL.
No prediction/model/price/grade/stake threshold changes are proposed. Preserve
all original rows and locked payloads; no provider or independent prediction writer.

Confirmed MLB runtime: v2_2 / fi_v2, decision r92, public calibration v38,
layer schema v21, FI scoped r85. Confirmed WNBA runtime v1_8 Owls, distribution
v8, calibration schema v4 and grade v12 against their exported machine registries.

Initial complete SELECT-only audit: 13,412 rows / 11,925 canonical identities,
3,928 games. All recorded actionable calls on completed slates are settled.
CBB 257/257 frozen actionable markets, NFL 154/154 source actionable locks,
CFB 981/981 source actionable locks and WNBA 181/181 source calls have ledger
identities. NFL has six documented owner-approved correction supersessions.
Nine older CFB source grades differ from existing accuracy-only records locked
one week before their eventual T60; these are owner-review history, not automatic
retroactive promotions. Preserve them while investigating exact source lineage.

Found seven older MLB FI rows whose original member_facing_at_lock object
retains 1 Best Angle and 6 Leans, but mutable indexed Held/Toss-Up fields exclude
them from tracking cuts. Existing canonical grading already gives that exact
frozen object precedence. Restore the same original-object precedence in the
reader only, with bounded narrow subobject reads for contradictory actionable
FI rows. Bump aggregate/cache/snapshot reader versions; preserve originals.
Same-input board promotions/demotions: 0/0. Historical visibility delta: +1
stored Best Angle and +6 stored Leans, with their existing settled results.

Also fail closed on grade-read errors rather than publishing an empty grade
set. Add all-sport published-lock/settlement checks to the existing scheduled
health owner, bounded to a recent window and scalar/market projections. This
must detect a missing entire game as well as missing grades; no new timer,
provider calls, grade writes or historical reconstruction. Read errors are
health errors, never proof of zero plays. Test >1,000 records, zero writes,
locked reader precedence, missing manifests, future/live vs overdue settlement,
true voids, query failures, and all sport/competition scopes.

Require full model gate, focused tests, build/types, current-main integration
safety, protected PR, live reader/snapshot/cron and immutable hash verification.
