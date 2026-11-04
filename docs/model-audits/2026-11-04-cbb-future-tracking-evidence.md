# CBB future tracking evidence receipts

Starting base:02611d27a457af825138394aadd363e27b39eafd.
Scope: new CBB tracking receipt metadata only. Tracking writer R14 becomes R15;
all numerical model, grade, member, fixture and settlement releases stay exact.
Promotions/demotions/side changes/board impact:0/0/0/0.

The owner-approved historical Notre Dame–Villanova repair exposed a prospective
gap: the insert-only tracking mirror can materialize an original valid pregame
member lock after the game, but R14 omitted the evidence hash required by the
existing alternate-line reader. Normal pregame-created rows were unaffected.

R15 stamps each new receipt with the original locked member payload SHA256,
`sha256_sorted_json_v1` format and exact `cbb::member-game::<providerId>` key.
Hashing normalizes JSON serialization and recursively sorts object keys, leaving
array order intact, so PostgreSQL jsonb key ordering does not invalidate it.
The authoritative frozen member payload is never changed. No provider or extra
database call, independent writer, schedule or lease is added.

The existing insert-only path still preserves every historical tracking row
unchanged; it does not append hashes to old rows. That requires separate owner
review, as already completed for records529423/529424. A future delayed mirror
keeps its real insert timestamp and original publication/lock timestamps; it
does not invent an on-time insert or post-start lock. Existing alternate-line
admission continues rejecting post-start publication or lock timestamps.

Focused tests cover the actual writer, delayed materialization through the
existing reader admission function, post-start negative controls, stable JSON
key ordering, original member immutability and no changes to existing incomplete
historical receipts. Existing fixture/lock, member, tracking and model-change
tests, types, lint, clean latest-main integration, protected PR, preview and
production proof are required. New metadata must be observed on a natural
future tracking insert; current locked rows must remain unchanged meanwhile.
