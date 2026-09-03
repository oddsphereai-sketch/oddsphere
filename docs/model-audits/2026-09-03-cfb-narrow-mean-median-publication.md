# CFB narrow PMF mean/median publication correction

Date: 2026-09-03  
Classification: production publication-contract correction; no forecast or grade change

## Incident

Four consecutive natural `cfb_forward_evidence` runs (refresh rows 102511,
102523, 102526 and 102534) failed before the atomic append on provider game
458267, LAM at UL. The computed Total decision and the exact authoritative PMF
both selected Under 48.5. The same skewed discrete PMF had an expected total of
48.82770674927421, 0.32770674927421 points above the evaluated line.

That shape is mathematically coherent: an event can have more than half its
mass below a threshold while a smaller right tail pulls the mean above it. The
r50 contract already removed the writer suppression for this exact class and
documented a 0.5-point narrow boundary, but the shared writer assertion and the
member fixture independently retained a 0.25-point boundary. The writer
therefore failed before append. The fixture remained available using its last
complete 01:24Z row (Under 49.5); it was stale, not corrupted. The sport lease
was released after each failure.

## Correction

The shared validator keeps 0.25 points as its default and exposes an explicit
CFB-only 0.5-point tolerance. The CFB writer passes that value and the CFB
member fixture imports the same constant. Exact PMF identity and exact-line PMF
side agreement remain mandatory. A mean-side disagreement wider than 0.5
points still fails closed.

This changes no PMF, expected score, representative score, probability,
decision side, evaluated quote, EV, grade, action, stake, provider call, query,
writer topology, lease, lock, tracking rule, schedule, reader layout or copy.
It only permits the already-computed coherent tuple to cross the publication
boundary promised by r50.

## Verification and rollback

The focused shared test includes the incident distance and proves that the
default guard rejects it while the explicit CFB guard accepts it. The CFB
production fixture regression uses the same 48.82770674927421 expected total
against Under 48.5 and must render the complete No Play tuple without a hold.
Existing wider PMF/mean contradictions remain rejection cases.

Roll back writer r41, fixture/outcome r43 and shared validator r6 together if a
natural cycle changes any forecast, probability, side, grade, action or stake;
publishes a PMF-side contradiction; admits a disagreement wider than 0.5
points; breaks atomic fallback or a lock; or emits mixed current publication
releases. Never modify or reinterpret an existing immutable evidence row.
