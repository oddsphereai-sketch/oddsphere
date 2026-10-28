# Prediction-market comparison cadence repair

Starting production base: `f7f33a327dc12b5813853e3a618b41ebc2dc24da`.
Display read release: `prediction_market_book_comparison_2026_10_28_r1`.

The owner reported Kalshi advancing beyond the sportsbook endpoint, missing
book curves, and dissimilar smoothness. The earlier selected-market release
remains intact; this is a member-display repair, not Market Brain work.

## Evidence and resolution

A bounded SELECT-only Minnesota probe found Circa `line_history` observations
at 22:42 UTC while the live panel still used its DTO's 22:30 endpoint. Kalshi's
independent five-minute feed had already advanced to 22:50. A separate all-market
coverage probe found that several missing NBA totals had stored real quotes at
a different handicap from the published pick. Unpriced future games and genuinely
missing/older-than-window quotes are separate cases, not evidence of a matching bug.

The existing member API now reads already-collected same-event/sport/start,
market/side-specific book observations: bounded earliest/latest `line_history`
and canonical observations, current `lines`, and current stream rows. Exact
published game identity is checked before the database lookup. At most seven
bounded SELECTs per distinct cached game/market/side miss; cache is 30 seconds.
No provider calls, writers, new schedules, leases, or paid subscription changes.
Member poll remains once/minute. Unsupported/incomplete reads retain the DTO
fallback instead of removing it. Soccer `match_result` is mapped only to
moneyline, BTTS only to BTTS; no cross-market substitution.
The latest already-published unlocked reader trail is also available through
this endpoint, independently of an older open browser's cached board. Forward
football and soccer identities do not require a legacy generic `games` row:
their exact published event/league identity can read canonical observations
directly. A conflicting generic kickoff is rejected. Source-read failures keep
the published reference rather than discarding it.

Fresh trusted quotes outrank delayed sources, then Circa, Pinnacle, and the
existing trusted-book list. Every trail remains one book and one actual point
line, using its actual observations and original timestamps. If the book's
latest handicap differs, its own line is explicitly shown. The panel does not
claim unlike handicaps are equivalent wagers or calculate a misleading gap.

Both sources stop at `min(last Kalshi observation, last book observation)`.
The plot starts at the later source's first available observation. One actual
preceding anchor is retained for normal SVG clipping, not moved or re-stamped.
The complete in-window book trail still owns its original opening/move summary.
Quotes beyond this comparison cutoff wait; this applies symmetrically. The
headline and delta use the displayed Kalshi observations, not its later hidden
quote. The right-axis label is the actual cutoff time, not an ambiguous Latest.
A dashed held-price tail can connect an earlier sample to that shared display
horizon; it is never inserted into quote samples, source timestamps, activity,
or inspection. No overlap produces an explicit waiting state, not a false pair.
Both curves now share bounded monotone-Hermite tangents; no overshoot, synthetic
anchors, changed quote values, or invented price movement.

## Locked-record authority

Published snapshots are SELECT-only. Locked stored trails always take precedence
over live context, including when the stored trail is at another explicitly
labeled line. That rendering preserves the original payload's price, time, and
line; it does not reconstruct or correct the frozen pick's price. A missing
locked reference cannot be filled from a post-lock live observation. Tests prove
both zero writes and exact locked reader precedence. Original locked projection,
probability, pick, grade, stake, price, evidence, and tracking remain untouched.

No model inputs or release identifiers change. The existing odds/line tracker,
sharp splits, internal reader, and prediction pipeline are unchanged. MLB
first-inning and unsupported CBB prediction-market panels remain disabled.

## Verification

Focused source/market/side/line, symmetric-cutoff, held-tail, monotone-curve,
retention, immutable-lock and shared reader tests; TypeScript; lint; full
`verify:model-change`; production build; all-sport read-only coverage rehearsal;
actual reader desktop/mobile browser checks; fresh-main integration safety and
live production checks are required before completion.

Coverage audit is bounded display coverage, not a historical replay archive and
not a claim that every game has fresh bookmaker data. At 22:52 UTC it found real
freshness gains for seven priced NBA moneylines/spreads and several NBA totals;
NFL/CFB/NHL existing priced comparisons stayed populated. Other gaps include
unpriced future NBA scopes and absent/aged soccer quotes. They are not relabeled
as fresh or assigned another game's prices.
