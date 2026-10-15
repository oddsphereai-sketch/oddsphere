# CFB late-pregame lock recovery — 2026-10-14

## Incident

WKU at Sam Houston was scheduled for 8:00 PM EDT with an ordinary T-60 target
of 7:00 PM EDT. Earlier CFB cycles were aborted by the separately repaired
legacy-recovery candidate defect, so no on-time T-60 payload was stored. The
first immutable T-60-stage payload arrived at 7:39:48 PM EDT, 39.81305 minutes
after the target and still before kickoff. It was current-release, published,
market-coherent, complete across Moneyline/Spread/Total outlooks, and held only
for `t60_capture_late`.

The 8:09 PM cycle successfully wrote three accuracy-only prediction records
from that exact immutable payload with `locked_at` and `published_at` equal to
7:39:48 PM EDT. The member reader nevertheless continued to classify the game
as pending/missed because it recognized only an official on-time T-60 payload
as a visible lock.

## Correction

The official on-time T-60 contract remains unchanged. A new fail-closed member
recovery predicate recognizes only the current-release append-only T-60 payload
shape that is:

- captured before kickoff but beyond the 20-minute official tolerance;
- published with all three coherent market outlooks;
- non-actionable and accuracy-only (`trackingEnabled=false`, no evaluated
  bets, all three markets held);
- held for exactly `t60_capture_late`, with no additional health failure; and
- produced by the active evidence/member/decision release tuple.

That payload is rendered as locked at its actual capture time. It is not
reconstructed, moved backward to the scheduled cutoff, or promoted into an
official on-time T-60 record. Existing evidence and tracking rows remain
unchanged. Ordinary late/malformed payloads still render `LOCK MISSED`.

## Product and model impact

- WKU-Sam Houston renders `LOCKED · 7:39 PM EDT` from the immutable 7:39:48
  payload.
- Moneyline, Spread, Total, score, probabilities, grades, and prices do not
  change.
- Official tracking eligibility, denominator rules, cadence, provider calls,
  and the `prediction_pipeline:cfb` lease do not change.
- The preceding member snapshot remains an explicit transition fallback.

## Validation gates

- Focused CFB production regression, including positive and malformed recovery
  cases.
- Daily Edge lock-state rendering regression.
- TypeScript and ESLint.
- Full `npm run verify:model-change`.
- Clean latest-main integration safety before publication.
- Post-deploy writer, snapshot-release, immutable tracking-record, lease, and
  live browser verification.

## Rollback

Roll back writer r119, fixture r90, lifecycle r2, snapshot r50, and reader r35
together. Retain every immutable evidence and prediction record unchanged.
