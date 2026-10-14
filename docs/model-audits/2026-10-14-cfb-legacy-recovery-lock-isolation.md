# CFB legacy-recovery lock isolation — October 14, 2026

## Scope and incident

This is a lock-lifecycle correctness repair for CFB Daily Edge. It changes the
sole CFB forward writer and official tracking candidate selector only. It does
not change the independent model, PMF, market reader, prediction side,
probability, projected score, price selection, grade, actionability, stake,
provider cadence, member copy, or layout.

At 22:39:48Z the production writer captured an eligible on-time T-60 payload
for Kennesaw State at Missouri State. That payload contained three coherent
`t60_locked` decisions and no health hold. The scheduled run nevertheless
failed before tracking and member-snapshot publication with:

`CFB tracking records require an eligible on-time T-60 evidence payload.`

The same error repeated at 22:54Z and 23:09Z, so the member board did not show
the lock.

## Root cause

Provider game 457759 (FIU at Jacksonville State) retained a valid immutable
prior-release pre-T60 recovery from October 13. The candidate selector treated
every recognized pre-T60 recovery as a current-release `official_t60`
candidate before checking its release tuple. The official record builder
correctly required the current release tuple and rejected it. Because tracking
records are built as one slate batch, that legacy classification error aborted
publication for unrelated valid current games.

No locked payload was corrupt and no stored prediction requires mutation.

## Repair

- The official tracking builder exports one complete, non-mutating eligibility
  predicate covering release identity, forecast status, publication/tracking
  eligibility, timing, lag, and frozen decision coherence.
- The writer uses that exact predicate instead of a weaker duplicate.
- A prior-release recovery therefore remains on the supported accuracy-only
  recovery path, while a current eligible T-60 payload remains official.
- Official tracking release advances from r47 to r48 and sole-writer release
  advances from r117 to r118. All model and member payload releases remain
  unchanged.

## Evidence and board impact

The credential-backed read-only production audit initially found 89 candidates
and exactly one invalid official candidate: provider game 457759. Replaying the
same immutable rows through the repair found zero invalid official candidates;
457759 selected the recovery path and provider game 457760 remained an official
T-60 lock.

The focused regression recreates a mixed slate containing a previous-release
published recovery and a current official T-60 payload, proves both candidates
remain independently buildable, and proves the legacy row cannot abort the
current lock.

Prediction and board impact for identical payloads is zero side changes, zero
score changes, zero probability changes, zero grade changes, zero promotions,
zero demotions, and zero actionable-count change. The intended visible effect
is lifecycle correctness: already-captured eligible T-60 cards publish as
locked and official tracking no longer stalls behind a legacy recovery.

## Rollback and live gates

Rollback r118/r48 together to r117/r47 while preserving every immutable
evidence and tracking row. Before production acceptance, require the focused
CFB suite, type/lint/model-change verification, latest-main integration safety,
protected PR checks, and live proof that the sole writer completes, the shared
`prediction_pipeline:cfb` lease is clear, the current member snapshot updates,
and eligible current cards show their stored lock without changing predictions.
