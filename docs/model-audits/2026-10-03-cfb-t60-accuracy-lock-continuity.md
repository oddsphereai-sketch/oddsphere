# CFB T-60 prediction-lock continuity

## Scope and incident

This is an outcome-blind lifecycle repair for the sole CFB forward writer, compact member fixture,
snapshot reader and official accuracy tracking. It does not alter the independent model, market
reader, joint score distribution, probability, prediction side, exact quote, grade, stake, provider
cadence, schedule, member copy, labels or layout.

Production evidence at 2026-10-03T18:55:02.833Z showed that the scheduled writer was running, but
six complete on-time T-60 forecast cards were not considered immutable because their only health
hold was `authoritative_market_anchor_unavailable`. The cards retained a coherent Moneyline
direction plus exact Spread and Total context lines, but remained `locking` and would age into
`missed`; 18 corresponding accuracy rows were absent. Sixty-three of the 81 eligible market rows
already existed.

## Repair contract

A prediction-only T-60 lock is valid only when all of the following are true:

- it belongs to the current evidence, member and decision release;
- it was captured from T-60 through T-40, strictly before kickoff;
- publication is enabled, exact-price tracking is disabled, and all three exact-price markets are
  held solely because the canonical market anchor is unavailable;
- the immutable public outlook contains a Moneyline direction and finite probability plus exact
  Spread and Total directions, probabilities and lines;
- the authoritative forecast is explicitly stamped `market_anchor_unavailable_hold`.

The member reader freezes that stored card at its real capture timestamp. Tracking writes the same
three forecast directions as accuracy-only No Play rows. It does not reconstruct or retain odds,
market probability, edge, expected value, recommendation, stake or ROI. A late capture, missing
line, post-kickoff observation, model-team-profile failure, second health hold, incomplete release,
or malformed forecast remains ineligible. Existing exact-price T-60 locks are unchanged and retain
priority.

## Paired impact and load

The 99-game live slate retains all 297 member markets and the same score, side, probability, grade
and actionability surface. Promotions: 0. Demotions: 0. Net actionable change: 0. The read-only
tracking audit changes eligibility from 21 games / 63 market rows to 27 games / 81 rows, adding only
the 18 missing accuracy denominators across six already-published cards. The repair adds no API call,
writer, schedule or lease and continues to use `prediction_pipeline:cfb`.

## Verification and rollback

Required verification is the focused CFB production contract, TypeScript, full
`npm run verify:model-change`, current-main integration safety, protected PR checks, and live proof
that the current compact snapshot marks the eligible cards locked and that all three idempotent
tracking rows exist. Roll back fixture r69, snapshot r28, reader r13, tracking r34 and writer r91
together if any score/side/grade changes, a partial three-market insert occurs, a valid existing lock
is replaced, an ineligible health failure is frozen, or the live reader/writer loses coherence.
