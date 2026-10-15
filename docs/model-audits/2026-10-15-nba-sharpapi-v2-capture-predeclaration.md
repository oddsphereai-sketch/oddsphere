# NBA SharpAPI V2 capture predeclaration

Date: 2026-10-15  
Release: `market_intelligence_v2_shadow_capture_2026_10_15_r1_nba_per_book_forward`

## Decision boundary

This release standardizes the NBA evidence plumbing; it does not standardize the NBA forecast
formula to another sport. The shared Daily Edge contract is point-in-time input integrity,
canonical game and team identity, provider and book provenance, chronological observations,
target-aware evaluation, one leased writer path, immutable locks, calibrated probabilities, and
release-pure reporting. The independent NBA model remains basketball-specific and may retain or
add validated possession, opponent-adjusted efficiency, nonlinear Four Factors, pace and style,
rest and travel, lineup and rotation, player-impact and availability-duration, early-season prior,
uncertainty, and upset-calibration features. A useful NBA signal is not excluded merely because a
different sport does not use it.

## Change

- The existing Market Intelligence V2 shadow collector may request SharpAPI `/splits` for NBA as
  well as MLB.
- Exact NBA club names and common aliases map to the canonical NBA abbreviations used by stored
  games. Rows still require exact date and matchup identity before construction.
- Each current SharpAPI row retains its real provider source book. DraftKings ticket and handle
  shares remain DraftKings observations. BetMGM is ticket-share only and its missing handle is not
  inferred. A named-book row is never relabeled as consensus.
- NBA builds its chronological trail only from repeated current snapshots in this release. The
  provider `/splits/history` path is deliberately disabled for NBA until the shared collector can
  request and deduplicate the provider's book-specific NBA history contract explicitly.
- The existing scheduled public-splits refresh remains the sole invocation path and remains inside
  the sport-scoped `prediction_pipeline:nba` lease.

## Explicit non-authority

NBA stays `audit_required` in the public-splits capability registry. These observations cannot
change or populate the member split display, independent score, prediction side, probability,
market selection, grade, actionability, stake, tracking tuple, lock, copy, label, or layout. The
runtime feature flags must already permit V2 and public-split observation writes; this change does
not enable either flag.

For identical NBA input, board impact is therefore:

- promotions: 0
- demotions: 0
- side changes: 0
- projected-score changes: 0
- actionable-count changes: 0

Any future display or decision authority requires a separate versioned NBA release with
release-pure forward evidence, source-specific sample sizes, missingness and staleness analysis,
chronological same-book movement, reversals and buyback, target-book exclusion, paired promotion
and demotion rules, and exact board-impact reporting. `handle_pct - bets_pct` by itself is not a
verified sharp-bettor measure.

## Verification gates

1. NBA full-name and alias normalization resolves only to canonical NBA identities.
2. Wrong-date rows and unmatched games are rejected.
3. Source-book provenance survives canonicalization; BetMGM handle remains null.
4. Existing MLB history behavior remains unchanged.
5. Current-refresh route tests prove NBA V2 capture is wired while the public capability remains
   audit-only.
6. Focused Market Intelligence tests, `npm run verify:model-change`, clean-worktree integration
   safety, protected PR checks, and post-deploy release/lease/row-provenance checks must pass before
   publication.

## Rollback

Remove NBA from the V2 scheduled collector and the exact NBA normalization registry while
preserving already stored observations as audit evidence. Do not delete or reinterpret captured
rows. No prediction or locked record requires rollback because neither is changed by this release.
