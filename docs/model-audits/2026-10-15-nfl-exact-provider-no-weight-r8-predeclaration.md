# NFL exact-provider no-weight candidate r8 — frozen predeclaration

Date: 2026-10-15

Status: research-only full-product replay; no production writes.

r8 changes one item from the frozen r6 combination before scoring the paid
32-game cohort: its independent margin is the exact-provider r7 head rather
than r5. Its independent Total remains the r2 dynamic state head. This change
is required for live/historical feature parity and was selected without using
the paid-cohort result.

The market-reader contract is unchanged: zero scalar market weighting; only an
authorized winner correction, `professional_market_*` Spread correction, or
qualified Total-direction correction may alter the completed independent
score. Every correction and harm must be attributed, and coherent home/away
scores must be rebuilt afterward.

All r6 production restrictions and locked-record immutability remain in force.
