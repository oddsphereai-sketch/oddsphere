# CFB chart archive and historical recovery

Starting production base: `7007590d8c1e9ce7604ccc3d66d9b724ece8c60d`.
Display: `cfb_chart_continuity_2026_10_31_r1_verified_history`.
Retention: `prediction_market_retention_2026_10_31_r2_current_tuple_priority`.

Owner reports October 31 graphs absent across college football. Owner explicitly
approved restoring separate locked-card graphs from verifiable pre-lock quotes,
without modifying picks, prices, grades or stored evidence.

## Verified causes

- The single auxiliary CFB archive reached its 450-row cap. Sorting by latest
  kickoff before truncation kept later games and obsolete line variants ahead
  of imminent/current locked tuples. At 15:20 UTC, 450 rows remained, but only
  seven belonged to noon games and Illinois had none. Current immutable
  selections could no longer find their exact pre-lock receipt.
- A valid Kalshi history could be discarded when the sportsbook overlap had
  zero or one shared instant, even when dozens of genuine Kalshi quotes existed.
- Exchange names `MIZZ`/Missouri and `ALBY`/University at Albany failed the
  published `MIZ`/Missouri Tigers and `UALB`/Albany Great Danes identities.
  Those aliases are scoped to exact named CFB exchange/display identities,
  not the shared model/source canonicalizer.

## Repair and boundaries

Current CFB published tuples have first retention priority, independent of kickoff
ordering. Additional history remains bounded to 3,000 rows and 48 MB decoded
JSON, below the existing 64 MB reader ceiling. Oversized protected tuples fail
the capture instead of silently evicting them; the existing writer retains its
prior snapshot. Existing receipt objects/checkpoints are not rewritten.

The existing five-minute collector, lease, requests and three-request public
history budget remain unchanged. Newly matched selected CFB contracts, including
recent locked cards, receive bounded history priority. No per-user provider call,
new timer, quota bypass, model input or prediction writer is added.

For an already locked CFB card lacking an eligible auxiliary market receipt,
the read-only recovery uses actual stored observations/candles at or before the
authoritative lock timestamp. Exact published selection, team pair, contract
kind, line, date, independently verified postponement policy and ambiguity gates
remain mandatory. The historical identity is evaluated at the actual lock
boundary, not by widening ordinary live/legacy matching. Historical bid/ask and
24h volume are unknown and returned as null. `historicalThrough` and actual
`recoveredAt` distinguish this view from a real pre-lock capture; a retrospective
`prelockCapturedAt` is never manufactured.

Every stored locked quote, sportsbook, threshold, price and endpoint retains
precedence. No new sportsbook history or different source replaces it. No locked
database record/member snapshot is written or reconstructed. Real Kalshi-only
history stays visible when a two-source overlap is unavailable; it cannot be
presented as a fabricated aligned sportsbook comparison. Non-CFB locked-reader
semantics remain unchanged. Existing unlocked CBB standalone-history support is
preserved, including a one-instant overlap.

Same-input prediction/grade/stake/promotion/demotion/actionable deltas are zero.
No model release changes; this is an auxiliary display and retention repair.

## Verification and rollback

Use `scripts/operator/audit-cfb-prediction-market-coverage.tsx` for the entire
ET-dated slate, all three markets, static SVG paths, original lock cutoffs,
source/member immutability and frozen-record hashes. `--live` reads the actual
member endpoint with concurrency three and no upstream provider requests.
Separate real source/history gaps from render failures; do not claim that every
graph is live from one successful Illinois sample or a branch replay.

Run all prediction-market tests, TypeScript, focused lint, full model-safety
verification, latest-main/overlap safety and protected PR checks. After merge,
verify the exact production commit, another ordinary display capture, retention
release/current tuples, full live endpoint coverage, representative desktop and
mobile actual readers, and unchanged previously locked-record hashes. New
contracts may need subsequent bounded history cycles; do not invent missing
history while warming. Revert the display patch on wrong identity, post-lock
leakage, frozen-payload mutation, growing capture failure or invalid chart paths.
