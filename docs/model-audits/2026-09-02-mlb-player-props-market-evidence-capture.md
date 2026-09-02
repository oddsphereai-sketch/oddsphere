# MLB Player Props Forward Market Evidence Capture

Date: 2026-09-02
Base: `d4011de2da10fa2303c79bf2d1c1a9243cd40f1e`
Behavior release retained: `mlb_props_2026_09_01_r38`
Capture release: `mlb_props_market_evidence_capture_2026_09_02_r1`
Schema: `mlbpme1`

## Disposition

This is a behavior-neutral evidence layer for a later, separately validated
hierarchical market interpreter. It records the exact evidence and incumbent
outputs needed to test target-book exclusion and source-quality adaptation;
it does not implement adaptive weights or alter r38. Existing model versions,
probabilities, projections, sides, grades, prices, stakes, locks, tracking,
member presentation, writer ownership and `prediction_pipeline:mlb` lease are
unchanged.

The follow-on behavior contract is contextual classification, not a more
elaborate fixed blend. It must audit the interpreted evidence state separately,
choose confirmation, attenuation, or a genuinely corroborated reversal, and
only then rebuild the coherent posterior/side/decimal projection. Exact-price
economics and grade remain downstream. No fixed replacement coefficient is
authorized by this capture.

The capture reuses current/opening odds and market contexts already in memory
inside `refreshMlbPropsBoard`. It creates one tuple per complementary economic
identity and one short reference per retained row. The exact evaluated book is
the unchanged row's `book`; future analysis must exclude that book from the
identity's retained alternatives. Each identity holds no more than eight
fresh complete books, while deterministic source and category stratification
preserve category coverage without first-N bias. Verified split fields require
exact source/timestamp/tickets/money. `sp=n` means no such row was available and
contributes no signal.

## Stored-snapshot replay and hard bounds

During implementation, the natural r38 cycle advanced to snapshot
`e5214f8e-d78d-450a-a12f-0d31e6a3793d` at
`2026-09-02T12:17:20.744Z`. A read-only reconstruction of the latest
stored selected-book rows measured a 30,218,980-byte canonical baseline and a
1,319,057-byte compact-member baseline. Adding the implemented schema retained
all 3,481 reconstructed identities and measured +980,800 canonical bytes; the
600-row member payload measured +108,579 bytes. The reconstruction cannot
recover books that r38 did not persist on selected rows or its pre-market
projection scratch value, so it is a serialization replay, not a substitute
for the first natural post-release writer audit. The runtime cap remains
authoritative when the existing in-memory all-book set is larger.

Canonical retention targets 983,040 bytes, leaving 65,536 bytes before the
strict 1,048,576-byte hard cap. Member retention targets 245,760 bytes, leaving
16,384 bytes before the strict 262,144-byte hard cap. A synthetic 8,500-
identity fixture retained 5,368 identities at 982,890 bytes, with 315 or 316
identities in every one of the 17 supported categories. Reversed input emitted
the identical capture. The maximum book-array length remained eight.

## Behavior and safety proof

- The fixture's canonical and member JSON is byte/value/order/count identical
  after removing only the additive capture and reference fields.
- The capture records exact current/provider-change skew, same-book opening
  fields across a changed point line, retail/sharp classes, minimum target-
  excluded breadth, incumbent context, coefficient, and independent/final
  outputs.
- Missing and incomplete alternatives are distinct; missing verified splits
  remain neutral. A complete exact fresh split tuple changes only capture state.
- A locked row selects its prior evidence tuple even when a newer tuple exists;
  neither the locked row nor its reference may be removed or reconstructed.
- Static gates preserve one current-odds call, one opening-odds call, the
  existing member upsert statements, and zero calls/queries/writes in the
  capture module.
- Promotions, demotions, forecast-side changes, probability changes,
  projection changes, grade changes, price changes, stake changes, lock
  changes and board-count changes are all zero by construction and assertion.
