# CBB market evidence correctness — November 3

Starting production base: `d8690e1cff30ac6c9d944dacb193f995fb01d26c`.
Task worktree: `codex/cbb-market-evidence-correctness-20261103`.

## Scope and independently reproduced defects

The owner requires spot checks to independently interpret raw prices, lines,
timing and flow, then judge the model's consequences. Three independent audit
agents reviewed the raw six-game/18-market packet before seeing the decisions.
The full packet retains unchanged quote frames; an initial shortened packet
omitted those frames and could not establish genuine held-book chronology.
Only the corrected full packet supports the conclusions here.

Drexel–Virginia has Circa -28.5 to -31.5 and Pinnacle -28 to -31 with
price compensation. Both strengthen Virginia; their released relative effects
are +2.674629 and +3.013404. Both Total moves support Under, with effects
-0.689167 and -0.5. Wofford–Tennessee's two spread effects both favor Wofford
(-0.006192 and -1.007934). The released reader called unequal same-direction
effects conflicting and applied zero. The new receipt distinguishes aligned
direction from unresolved combined magnitude. It still applies zero: this
correctness release does not invent an average, source priority or coefficient.

Several Watchlists with model EV above 3% incorrectly stated
`edge_below_actionable_reserve`. The actual failed gate was price eligibility
or professional neutral, mixed or opposing evidence. Reasons now identify the
actual gate. The gates and resulting grade do not change. New reader reasons
also distinguish unresolved evidence from actual directional opposition.

Hampton–Georgia Tech and Sam Houston–Alabama spot checks confirm that line and
juice must be interpreted together. Static source value, source movement and
observed betting action remain different evidence. A moving or popular side
does not alone establish executable value or causal sharp confirmation.
Off-contract Wofford Total splits remain unbound; no old-line flow is assigned
to an earlier different-line price change.

## Bounded forward input retention

The existing leased writer retains at most one first qualified input checkpoint
per unlocked game: the actual pristine R3 forecast and uncertainty, source and
target pairs, real clocks, target-family exclusion, known quarantine and history
status. It does not compute another forecast, change an input to the active
forecast, fit, create shadow predictions or add a table, query, provider request,
writer, timer or cadence. New checkpoints have a 16 KiB cap; oversize input is
skipped without truncation. Existing non-null checkpoints retain exact bytes,
including invalid legacy checkpoints. Locked rows never enter this calculation.

Native-ID BDL targets may lack an Owls named-selection orientation attestation;
their provider/game/home-away identity contract is retained without fabricating
that field or a request clock. Explicit false is rejected. Professional sources
still require explicit verified orientation. Qualification sees pre-filter current
and complete native frames, so an invalid latest frame cannot silently revive an
older quote. Same-time contradictions retain family quarantine even if followed
by a clean frame. Direct submillisecond receipt availability rounds outward.

This retention is input provenance only. It supplies no coefficient, calibration,
prediction, grading or historical-publication authority. Current partial history
is recorded as partial; it is never described as history from market open.

## Release family and unchanged authority

- Score remains `cbb_candidate_2026_11_02_r5_received_market_response`.
- Independent remains `cbb_candidate_2026_11_02_r3_verified_stthomas_venue_prior`.
- Receipt: `cbb_market_behavior_2026_11_03_r3_direction_and_magnitude`.
- Grade: `cbb_2026_11_03_r6_exact_decision_gate_reasons`.
- Board: `cbb_candidate_2026_11_03_r10_explicit_market_evidence`.
- Publisher: `cbb_member_pipeline_2026_11_03_r19_explicit_market_evidence`.
- Tracking: `cbb_tracking_writer_2026_11_03_r7_market_evidence_lineage`.
- Adapter: `cbb_member_adapter_2026_11_03_r8_exact_market_decision_reasons`.
- Retained input: `cbb_retained_level_input_2026_11_03_r1`.

JSONB object-key reordering no longer breaks semantic receipt equality; changed
scores, targets, uncertainty or identity remain rejected. Tracking accepts the
original R5 grade release and preserves that exact legacy version, never stamps
old locks as R6. Reader precedence remains the stored locked member payload.

## Frozen same-input impact and verification

Saved actual November 3 frame at `12:10:59.988Z`: 18 unlocked games/54 markets.
Old and candidate forecast, probability, EV, price, selection and grade are exact.
Counts remain 20 Lean, 14 Watchlist, 20 No Play; promotions 0, demotions 0, net
actionable change 0. Six axes change only from conflicting to aligned/unresolved;
seven grade reasons become accurate. These are functional comparisons, not
outcome accuracy or value qualification. Source-identity repairs published after
this frame can legitimately change the current board under the existing R5 law.

Focused tests include 49 complete frozen grade-decision hashes, mirrored aligned
and opposing moves, JSONB reorder/tamper tests, exact-price thresholds, R5 locked
writer/reader/tracking precedence, first-checkpoint idempotence through refresh,
quarantine, T-60 and post-tip, source/clock/conflict boundaries and the size cap.
Required full checks, fresh-main integration with source publisher R18, protected
PR, exact remote tree and production proof remain release gates. After merge,
verify normal cron release, coverage, unchanged stored locks and member reader.

## Remaining numerical gap and rollback

The full current-level inference repair remains unfinished. The earlier 37-game
locked-input mean fit spans only 0.283 seconds of horizon variation and cannot
support the live slate's broad horizons. It has no separate scale calibration,
prospective held-out result or production authority. An earlier saved actual
unlocked archive is being evaluated under a separate predeclared protocol; it is
not silently substituted into the old fit. R5 owner approval is not a reusable
waiver for a different numerical policy.

Hold or roll back future unlocked publication on changed same-input decisions,
mixed releases, locked-field mutation, extra provider/write workload, size-bound
failure or failed writer/reader precedence. Preserve every lock and release era.
Do not describe this evidence-correctness release as the completed numerical fix.
