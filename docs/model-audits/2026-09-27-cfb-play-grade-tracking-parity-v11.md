# CFB member-facing play-grade tracking parity v11

## Incident

The September 26 immutable CFB ledger contains 298 graded predictions and the
following member-facing play grades:

- Best Angle: 4, with a 3-1 result;
- Lean: 58, with a 39-19 result;
- Watchlist: 75, with a 46-29 result; and
- No Play: 161, with a 101-60 result.

The generic `byPlayGrade` aggregate was correct, but the member page's Best
Angle / Lean category panels applied a second `no_bet !== true` filter. That
filter removed 31 CFB Moneyline Leans whose exact locked offer was internally
marked shop/no-bet even though the immutable member card still displayed the
Lean verdict. The page therefore showed only 27 Leans at 15-12, and only 3
Moneyline Leans at 1-2, instead of the actual displayed-grade record.

## Repair

Tracking aggregate contract
`tracking_aggregate_v11_cfb_member_grade_parity_2026_09_27` makes CFB Best
Angle / Lean cuts follow `effectiveTrackingPlayGrade`, the existing immutable
member-facing grade authority. Other sports keep the existing actionable-only
filter. Overall prediction accuracy and every market denominator remain
unchanged.

Expected September 26 CFB category cuts after snapshot refresh:

- Best Angle: 4, 3-1;
- Lean: 58, 39-19;
- Moneyline Lean: 34, 25-9;
- Spread Lean: 20, 12-8; and
- Total Lean: 4, 2-2.

## Safety and rollback

This repair changes no prediction record, grade, result, model output,
probability, score, side, line, price, action, stake, Daily Edge member card,
copy, label, or layout. It only prevents the tracking reader from discarding
member-facing CFB grades in its grade-specific performance cuts.

Rollback is the aggregate constant and predicate change only. No immutable
record or grade should be deleted, rewritten, or regraded.
