# CBB unlocked participant-orientation rebuild

Starting production main: c184072ed854b1cc468e46c97fd25f398c5c3332.
Task branch: codex/cbb-uab-gw-slate-repair-20261120.

## Defect and exact scope

The November 20 UAB–George Washington fixture (BDL10883497 / ESPN401919019,
19:00UTC) is present in both source schedules and in canonical games. Its
unlocked November19 member snapshot has UAB home / George Washington away.
Both current schedules instead identify George Washington home / UAB away at
neutral Colonial Hall. The correct school-identity quarantine excluded the
reversed game from fresh analysis indefinitely. A normal refresh reported it
as a changed matchup and retained only schedule eligibility.

The same exact-pair reversal affects upcoming10883604 (Butler–Nebraska),
10883612 (UAlbany–Mercyhurst), and10883696 (Air Force–Army). All four originals
are unlocked and before both original/new T−60 cutoffs. The actual admission
proof independently checks both school IDs and institution names. No unrelated
school replacement is admitted. Today's paid schedule has51 D1/D1 fixtures;
50 are analyzed and this is the only omitted D1/D1 game. Eight cross-division
fixtures remain outside the owner-approved model domain; this repair does not
restore withdrawn unsupported priors.

## Repair

The existing sport-leased pipeline treats a verified eligible reversal as a
fresh input. It does not reuse the old score, probability, side, grade, quote,
flow state, or saved model input under new school labels. All normal provider,
official venue, statistical-input, exact-price, contextual-reader and complete
forecast gates still run. No candidate or a candidate bound to different IDs
cannot replace the original.

Before publishing the fresh unlocked result, the existing member writer
rereads the exact original, proves it has not changed or locked, and archives
the complete untouched payload under a content-addressed
`cbb::orientation-original::<game>::<sha256>` key. The archive uses
insert-on-conflict-ignore semantics and is retained independently of the active
member slot. Failure to preserve it prevents replacement. A receipt in the
new record binds the archive hash, exact old/new IDs and transition time;
ordinary subsequent refreshes retain that receipt without another archive.
The store checks the actual caller clock again after archival so crossing
either cutoff cannot create a late replacement.

Locked payloads return immediately, unchanged, before orientation logic.
Unrelated participant changes and post-cutoff reversals retain the existing
quarantine policy. The original schema remains reader-compatible R2; the
writer publication release is separately versioned R3.

## Versions and behavioral boundary

- Pipeline/input publication: cbb_member_pipeline_2026_11_20_r60_unlocked_orientation.
- Writer publication: cbb_member_game_publication_2026_11_20_r3_unlocked_orientation.
- Input repair receipt: cbb_unlocked_orientation_2026_11_20_r1_exact_pair_rebuild.
- Stored schema remains cbb_member_game_store_2026_11_02_r2_preserved_market_evidence.
- R8 grouped model/calibration, score equations, grade policy, stake policy,
  provider budgets, reader labels, schedule, single writer and
  prediction_pipeline:cbb lease remain unchanged.

For a same-input, same-orientation game there are zero promotions, zero
demotions and zero score/price/pick changes. Previously omitted eligible games
are fully evaluated through the existing symmetric promotion/demotion rules;
no desired grade count or result is manufactured. Live source changes during
ordinary refreshes are not attributed to this repair. No historical tracking
or locked member correction is authorized or performed.

## Required verification

Focused tests cover exact participant/cutoff admission, wrong-school refusal,
fresh score/quote ownership, full original preservation, archive failure,
actual-clock cutoff crossing, idempotent refresh, locked writer immutability
and locked reader precedence. The full pipeline test proves the rebuilt card
reaches the published board and its original survives independently. Existing
clock, tracking, grade, source and full model-change checks must remain green.
A production-shaped preview intercepts every member/archive write and records
the actual restored cards locally. Publication still requires fresh-main,
no-overlap, protected PR and deployed natural-writer/live-card verification.
Private receipts are retained under ops-local/learning-lab/cbb-uab-gw-slate-repair-20261120.
