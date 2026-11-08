# NFL official tracking value capacity

Base: `ed24a4686eeaf7493bb1c166301bf0412fac0229`.

The ordinary NFL writer published its member snapshot but an official tracking
batch failed with numeric field overflow. A valid locked long-odds expected
value exceeded the original NUMERIC(9,8) column's magnitude limit of ten.
The source locked decision and its JSON remain authoritative and unchanged.

V67 widens only locked_expected_value to NUMERIC(20,8), keeping the existing
eight-decimal storage scale. It changes no prediction, law, probability, price,
grade, stake, model input or reader semantics. Runtime model/writer/tracking
identifiers remain exact because their behavior is unchanged. The existing
sole writer retries its ordinary missing tracking inserts; ON CONFLICT DO
NOTHING preserves previously captured locked rows. No historical field is
corrected, reconstructed or replaced. No extra review, timer or paid test.

The disposable PostgreSQL proof reproduces the original overflow, applies V39
then V67 twice, accepts valid long odds and the integer-price payout boundary,
and proves legacy locked row/JSON equality, duplicate writer immutability,
unchanged reader payload, all other columns, eight-decimal scale, RLS and grants.
Publish through a clean latest-main protected PR, install the reviewed migration,
then observe the ordinary NFL writer, official tracking records, lock equality
and unchanged wallet. Do not call tracking healthy from a successful member
publication alone. Migration has short lock/statement timeouts and is rerunnable.
