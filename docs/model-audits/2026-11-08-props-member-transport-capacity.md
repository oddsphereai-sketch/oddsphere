# NFL prop full-board transport capacity

Base: `c1150dbaf17909c2d74901bcaea18ac81256e41c`.

The ordinary R73 writer used selection R1 across all five active NFL games but
could not persist its expanded member DTO: it exceeded the existing 16 MB JSON
transport ceiling. The last complete snapshot was retained. This is a publication
failure, not an incomplete purchased review. NBA selection R1 published normally.

NFL transport/envelope R3 opt into the lossless coverage-table V2 codec. Repeated
review metadata remains once per exact template; per-quote confirmation, selected
side, confidence and exception remain exact per row. Field schemas retain the
original named-field order and values. Coverage, role/source context, every
player/market and prior locked fields round-trip unchanged. Independent member
16 MB JSON/2 MB gzip and canonical 32 MB JSON/2 MB gzip limits remain unchanged.
Bounded schema, table and reference checks reject malformed input. Literal
reference-shaped fields round-trip; inline/V1 tables and R1/R2 envelopes and
transports retain reader precedence. NBA/MLB encoding remains on its unchanged
V1 default. No source selection, law, price rule, grade, model input, writer lease,
review identity, retry, provider call, inference call or wallet allowance changes.
Writer R74 identifies the availability cutover; member R57/lifecycle R39/source
R8/selection R1/forecast R15/reader R4 remain exact. MLB R44 remains exact.

Offline historical saved-source reconstruction (not current quotes or a native
writer reconstruction) covers five future games and 5,453 member rows. The old
wire is 17,339,863 bytes; R3 is 10,472,261 bytes and gzip 794,302 bytes. Decoding is
field-exact. An independent full-slate fixture covers 16 games, 512 actors and
12,288 locked/unlocked rows: 38,105,111 to 5,884,033 bytes, gzip 95,829 bytes,
exact property order and values, zero network calls. These are bounded capacity
proofs, not an unlimited future-volume guarantee or accuracy evidence.

Before merge: offline full-slate and saved-source round-trips; corrupt index,
width, schema and coverage negatives; legacy reader/lock/store/site proofs; full
model gate, lint, TypeScript/build; clean latest-main integration and protected
PR. After merge: verify the production release and an ordinary successful NFL
publication, all existing locked records/evidence and the member reader. No paid
testing or manual cron. Preserve missed locked records; do not backfill a law that
was never published before lock. Hold on field changes, corrupt legacy decoding,
request growth or continued capacity failure; retain the complete LKG.
