# NFL 2026 market-evidence layer audit result

Date: 2026-09-25

Status: read-only diagnosis; no production change

The immutable Week 1-2 evidence rows isolate an engine-level failure in the
Total path. The calibrated pre-overlay core called 16 of 31 non-boundary totals
correctly (51.61%) with 11.31 points MAE. The published post-overlay score
called 13 of 32 correctly (40.63%) with 11.46 points MAE.

The evidence signs were not equally reliable in this sample: the applied total
shift agreed with the outcome in 8 of 21 games (38.10%); strictly identified
Circa total evidence was 4 of 13 (30.77%); Playbook public evidence was 9 of 14
(64.29%); and opening-to-current movement was 3 of 6 (50%). The implementation
correctly distinguishes Circa from fallback split sources, but it lets the
Circa-primary combined shift alter the final score mean. That mechanism erased
the core's directional advantage in the current release.

This audit supports moving split evidence out of score-mean control and into a
bounded confidence/resistance role, while retaining same-book movement as the
only candidate mean adjustment. Because this diagnosis opened all 32 outcomes,
it is not an untouched promotion test. The change must remain shadow/provisional
until owner-authorized release governance and forward evidence are satisfied.
