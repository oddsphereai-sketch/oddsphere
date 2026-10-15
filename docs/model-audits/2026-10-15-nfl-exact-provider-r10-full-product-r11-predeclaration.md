# NFL exact-provider r10 full-product r11 — frozen cohort check

Date: 2026-10-15

Status: research-only; no production writes.

r11 combines the r7 margin and r10 provider-exact Total before scoring the paid
32-game cohort. It uses the unchanged no-weight market-reader policy. Because
r10 worsened broad 2026 Total MAE versus the pure state Total, r11 advances
only if its paid-cohort no-weight Total directions or point error improve on r9
without degrading the already-frozen side results. Otherwise r10 is rejected
and r9 remains the deployable candidate.
