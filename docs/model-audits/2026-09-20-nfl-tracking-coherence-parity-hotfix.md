# NFL tracking coherence parity hotfix

Date: 2026-09-20

## Scope and incident

The active NFL Daily Edge writer correctly applies the released one-point
same-PMF mean/median tolerance before accepting a prediction payload. The
official T-60 tracking adapter repeated the coherence assertion without that
NFL-specific argument, silently reverting to the shared 0.25-point default.
At 16:06 UTC the authoritative leased writer immutably captured the on-time
T-60 payloads for the 17:00 UTC games, including NO@BAL. Later publication and
tracking attempts rejected NO@BAL's Total because its PMF and decision selected
Under 45.5 while the mean was 0.4148 points above the line. That payload is
inside the already released and tested one-point NFL boundary.

The same audit found a second release-parity defect: the active r17 publication
can intentionally retain an aligned r6 Moneyline model/calibration tuple, but
the tracking lifecycle allowlist admitted only the base Moneyline pair. Four of
the eight on-time 17:00 UTC payloads were therefore stamped tracking-ineligible
despite passing publication. The other four were eligible, but the tracking
adapter's NO@BAL assertion aborted the batch before any record insert. The
pre-hotfix production baseline is consequently 0 official records for these
eight games.

## Candidate and board impact

Pass `NFL_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS` to the tracking adapter's
existing coherence assertion, exactly as the sole NFL writer already does.
Advance the official tracking-record release from
`nfl_official_tracking_record_2026_09_20_r8_ml_total_coherence` to
`nfl_official_tracking_record_2026_09_20_r9_coherence_parity`; tracking
lifecycle / composite / tuple boundary to r12 / r8 / r9 release parity; and the
sole writer to `nfl_forward_evidence_writer_2026_09_20_r33_tracking_parity`.
The lifecycle admits the two already-active Moneyline model/calibration pairs.
The writer recomputes tracking eligibility from the immutable payload instead
of trusting the old stored boolean, permitting delayed serialization without
reconstructing a prediction.

This hotfix changes no forecast, probability, projected score, side, line,
price, grade, promotion, demotion, actionable count, stake, copy, label,
provider request, schedule, or lease. Promotions and demotions are 0/0, and the
member board is identical. Tracking eligibility for the frozen eight-game T-60
cohort moves from 4 games / 12 markets to 8 games / 24 markets; because the old
batch failed before insert, the recovery appends all 24 missing rows. It
serializes only the exact on-time immutable payload already accepted by the
writer. Existing records are neither updated nor deleted.

The single authoritative path remains `/api/cron/nfl-forward-evidence` under
the shared `prediction_pipeline:nfl` lease. The current r8 tracking reader and
all model/calibration/decision/member releases remain otherwise unchanged.

## Verification and rollback

The focused tracking test includes a PMF-selected Under whose distribution
mean is 0.414 points above the same 45.5 line. Publication/tracking parity must
accept it, while the existing greater-than-one-point rejection test remains in
place. It also proves the active r6 Moneyline pair is eligible and that delayed
recovery recomputes the immutable boundary. Run the focused NFL coherence,
official tracking, writer, and member
snapshot tests; TypeScript; targeted lint; `npm run verify:model-change`; the
production build; and latest-main integration safety.

After protected merge, require a successful natural or authorized writer
cycle, no active lease, new append-only tracking rows for every eligible T-60
market, an unchanged member board, and a responsive production reader. Roll
back the adapter to r8 if the tracked tuple differs from its immutable evidence
payload, any old record is rewritten, releases mix within a new record, the
writer or reader fails, or load/lease health regresses.
