# UCL sportsbook graph capture clock — November 4, 2026

The owner reported a missing purple sportsbook curve for locked Real Madrid
moneyline and requested a prospective repair. Existing locks remain unchanged.
Starting production base: `47be7c6d13c3c714b6a280b174b853156ef4c1d2`.

## Reproduced cause

The existing daily route sampled its publication clock before awaiting inputs.
For the two early games, the request started at `16:47:34.581Z`; current book
quotes were observed at `16:47:39.295Z`. The writer persisted request start as
both `captured_at` and `locked_at`, making its own stored evidence appear late.
The graph correctly refuses a stored book with any quote after its lock boundary.
This removed the entire purple curve, including valid earlier observations.

The actual captured fixture reproduces four failures: Real Madrid moneyline,
Liverpool moneyline, Liverpool total, and Liverpool BTTS. Madrid total and BTTS
have earlier endpoints and remain valid. Same-book source histories and the
pre-lock archive exist; this is a publication-clock defect rather than absent
prices. The fixture retains actual source clocks and quotes without synthesizing
a sportsbook history. No paid provider requests or forecast writes were used
for the diagnosis or tests.

## Prospective correction

The existing daily route samples one clock immediately before the sole writer,
after slate, prices, split collection, seeding and history persistence complete.
The writer and due-lock verification share that exact clock. UCL rejects new
publication if any current, odds-trail, line-trail or opposing quote lies after
that proposed clock. Genuine stored locks bypass this new guard and retain
their original payload and precedence. The pregame-lock route already samples
its default writer clock after inputs and gains the same UCL assertion.

No graph guard, legacy lock, source timestamp, price, numerical prediction or
grade is rewritten. Scheduled T60 and actual capture remain separate fields;
the existing cadence, lock sweep and soccer prediction lease remain unchanged.
No second writer, extra refresh or extra provider request is introduced.

Future records identify writer
`ucl_prediction_writer_2026_11_04_r1_input_completion_clock`; the member lifecycle
becomes `ucl_member_snapshot_lifecycle_2026_11_04_r25_input_completion_clock`.
Numerical model R22, grade R25, outcome R15 and projected-score R13 remain exact.
The shared adapter's optional writer marker is absent for other competitions.

## Verification

- Actual fixture reproduces four old missing curves and proves all six future
  market cases render both curves in desktop and mobile chart layouts.
- Stale publication clocks reject; the completed-input clock preserves exact
  probabilities, prices, scores, picks and grades. Promotions, demotions and
  actionable board-count change are all zero for identical inputs.
- Actual daily-route timing crosses T60 while fetching, then proves writer and
  lock verification use one completed-input clock with the original lease,
  provider sources and cadence.
- Original fixture bytes and existing locked graph behavior remain unchanged.
- Full UCL production contracts, `npm run verify:model-change`, production
  webpack build, TypeScript and focused lint passed. The optional PostgreSQL
  Market Brain proof was skipped locally because its connection is unset.
- A second AI reviewer independently ran the fixture test and found no P1/P2
  blocker in the future-only clock repair.
- A read-only predeployment baseline at `2026-11-04T17:09:40.117Z` covers all
  260 existing locked UCL records across 40 fields; postdeployment comparison
  must preserve every hash.

Publication requires a clean committed worktree, latest-main ancestor and
overlap verification, protected PR checks and exact production tree proof.
Live proof must confirm the writer/lifecycle identifiers on a normal scheduled
refresh, valid completed-input clocks on unlocked forecasts and unchanged old
lock hashes. The already locked Madrid curve is intentionally not reconstructed.

Rollback is a new protected PR restoring the previous prospective publication
path under a newly versioned lifecycle/writer contract. Never roll back or
rebuild stored locked records. This repair makes no claim of improved win rate.
