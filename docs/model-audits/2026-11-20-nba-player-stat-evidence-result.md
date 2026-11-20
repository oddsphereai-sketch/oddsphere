# NBA player-stat evidence: prospective retention repair

Starting base: 4200415dbb5698a858ccb8cfda8054d740d45aeb. November 20, 2026.
Candidate source release: `nba_player_stat_evidence_2026_11_20_r1_normalized_observations`.
Existing sole private writer metadata: R40. Numerical current state stays R2.
This record describes the tested candidate; actual protected merge and live
ordinary-source proof remain required before claiming deployment.

## Confirmed gap and repair

The paid NBA player caches contain the player-level stats needed for rotation
research. They are mutable current-season state, allowing official corrections.
The main full-game scorer retains team aggregates. Neither alone establishes
an immutable historical player-state observation timeline. In particular, the
2025 player cache was first compiled in October 2026, after that season; it must
not be presented as an original pregame availability archive.

The existing full-refresh collector now reports its exact collected game IDs.
After the original canonical state write succeeds, the same NBA writer may
retain per-game normalized box and advanced fields under its actual shared
`prediction_pipeline:nba` lease. No new source request, scheduler, prediction
writer, review, AI call or data-model interpretation is introduced.

One compressed content-addressed body preserves every normalized field and
provider ID. Each real collection adds a compact immutable reference. Identical
collection retries preserve original bytes and clocks. A later stat correction
adds a new body; a reversion references the original body with a new observation.
This preserves the A/B/A timeline without copying the full data on every fetch.

The pure cutoff selector uses the latest source observation that was actually
retained by cutoff. Future observations cannot change an earlier replay.
Conflicting equal-clock versions, missing bodies, incomplete box/advanced
coverage, ambiguous player identities and target-game results remain unknown.
The normalized cache is never described as raw HTTP or original historical
availability. Source-state and first-retained clocks remain distinct.

## Bounded operation and exact behavior

Maximum 128 games, 128 bodies and 128 small references per run. Inventory uses
at most six groups of 48 exact indexed keys, one insert and one bounded ambiguous-
ACK reconciliation. Compressed body budget is 4 MB; individual raw/gzip budgets
and bounded decoding prevent an oversized archive from becoming a memory issue.
The storage window is 2.5 seconds, with at most one 1-second ACK reconciliation.
Insufficient source-window headroom skips archival rather than spending forecast
preparation time. Actual lease identity/clock and enough lease lifetime are
checked before insert. No archive update/delete is implemented.

Bodies and references use private non-member keys and explicit ten-year
retention. The existing cache cleanup respects their stale-until timestamps.
Exact-key member readers cannot confuse them with a Daily Edge response. No
archive is duplicated into the three market records or a browser payload.

An archive outage is a private diagnostic receipt/finding. It does not undo or
change the successfully written canonical state, hold a valid forecast, or
trigger another provider/model call. Original canonical-state write failures
remain failures and cannot be relabeled as successful collections.

## Measured size and validation

A read-only rehearsal on 50 already-collected current-season games preserves
1,576,370 uncompressed bytes in 199,143 compressed body bytes; the largest game
is 4,333 bytes. All 50 have matching final-score box totals and complete advanced
coverage for positive-minute participants. This is stat coverage, not verified
medical, transaction or cross-provider identity coverage.

At one body version per 1,230-game season, the measured body size extrapolates
to about 4.9 MB compressed per season. Small observation references, base64,
indexes/row overhead and actual source corrections add to that estimate. It is
not a guaranteed future database-growth bound. No paid provider request or
production write was used for this measurement.

Focused checks cover exact numerical-state/provider-request parity; content
hash/codec/identity/clock/size faults; duplicate/repeat/correction/reversion
chronology; unchanged earlier cutoffs after future mutation; target-result
exclusion; expired/wrong/late-crossed lease; 65-game bounded-key inventory;
lost ACK and conflicts; canonical-write versus archive-failure separation; and
Eastern calendar-day binding across UTC midnight. Existing production-readiness,
foundation, lifecycle, original locked-payload, private tracking, source-window
and database-retention checks pass. Full model verification, TypeScript and lint
are retained with the private release evidence. Optional dedicated Market Brain
PostgreSQL proof is not claimed when its URL is unset.

## Accuracy boundary and next work

No full-game or player-prop score equation, probability, calibration, grade,
price policy, stake or market-reading rule changes. For identical numerical
inputs, promotions and demotions are both zero. Daily Edge R37/marriage R39/
reader R3/grade R31 and the props generation/law/selection stay authoritative.
Every old locked payload retains original reader precedence and writer
immutability. No historical corrections or reconstructed wins are published.

The numerical Total candidate in draft PR #1135 remains inactive and the Spread
candidate remains rejected. This retention repair does not prove better picks.
The proposed player-state experiment still requires verified pregame availability,
effective-dated identities/membership and transaction evidence, complete historical
selection coverage and genuine-change cohorts. Those qualification gates remain
binding; no further fit is justified merely by having collected box scores.

Private source measurements, exact code/test logs and post-release proof belong
under ignored `ops-local/learning-lab/nba-player-state-foundation-20261120`.
