# CFB paired-price context repair — October 30, 2026

## Owner direction

Keep the complete CFB board, including FCS-FCS. Repair missing-price behavior
without fabricating prices, removing games, or turning a valid complete
two-sided sportsbook quote into an automatic hold merely because fewer than
three books currently quote the exact line.

## Contract

- The independent score, PMF, side, and market reader remain authoritative and
  unchanged.
- Every decision the incumbent target-excluded same-line policy can already
  form retains byte-for-byte precedence.
- Only an otherwise-held market may use the evaluated sportsbook's own real,
  complete, two-sided, main-line price pair as price context.
- The pair must be exact-game, exact-line, pregame, no more than 60 minutes old,
  internally coherent, within a 0%-20% hold range, and unambiguous for that
  normalized sportsbook.
- Owl reference rows, target-ineligible books, alternates, partial pairs,
  mismatched games/lines, future or stale timestamps, invalid American prices,
  and conflicting duplicates fail closed.
- The repair does not manufacture public or sharp splits, does not convert a
  target quote into independent consensus, and cannot bypass health, value,
  market-reader, or grade caps.
- All FBS-FBS, FBS-FCS, and FCS-FCS games remain eligible. The existing paid
  FCS odds fallback remains unchanged and reserve-protected for genuinely
  missing prices.

## Zero-write current-board rehearsal

At `2026-10-30T16:45:51.334Z`, the same-runtime audit evaluated 93 unlocked
games from the 100-game writer window. The Odds API key was explicitly empty,
so the audit consumed zero paid Odds API credits and made zero writes.

- existing market decisions preserved exactly: 192;
- forecast, PMF, and side changes: 0;
- held markets: 87 to 72;
- Best Angles: 28 to 28;
- Leans: 34 to 35;
- Watchlists: 112 to 124;
- No Plays: 18 to 20;
- actionable promotions: 1;
- actionable demotions: 0;
- net actionables: 62 to 63.

Fifteen markets recovered an exact evaluated price. The sole actionable
promotion was North Carolina Central Moneyline at DraftKings -208; the model
side and probability were already present, and the existing grade policy
assigned Lean after the real pair cleared price eligibility. Remaining holds
in this no-paid-fallback rehearsal were genuine quote/pair absence, not the
retired comparison-count rule.

## Releases

- calibration: `cfb_v1_exact_price_calibration_2026_10_30_r30_paired_price_context`
- grade policy: `cfb_v1_composite_grade_policy_2026_10_30_r29_paired_price_context`
- decision: `cfb_v1_daily_edge_decision_2026_10_30_r57_paired_price_context`
- decision tuple: `cfb_v1_exact_price_decision_tuple_2026_10_30_r44_paired_price_context`
- sole writer: `cfb_forward_evidence_writer_2026_10_30_r146_paired_price_context`
- member fixture: `cfb_v1_member_fixture_2026_10_30_r99_paired_price_context`
- compact snapshot: `cfb_forward_member_snapshot_2026_10_30_r59_paired_price_context`
- reader: `cfb_member_snapshot_reader_2026_10_30_r44_paired_price_context`
- tracking: `cfb_official_tracking_record_2026_10_30_r51_paired_price_context`

The sole `prediction_pipeline:cfb` lease, collection cadence, lock timing,
settlement, stakes, and provider budgets remain unchanged. Existing locked
payloads retain exact stored precedence; r56/r98/r58 is the immediate rollout
fallback family.

## Verification and rollback

Required checks are the paired-price safeguards, CFB decision and production
contracts, TypeScript, `npm run verify:model-change`, latest-main integration
safety, protected PR checks, and post-deploy verification of the live release,
writer health, snapshot, board counts, price coverage, and locks.

Rollback restores decision/calibration/policy/tuple r56/r29/r28/r43 and
writer/fixture/snapshot/reader/tracking r145/r98/r58/r43/r50 for future
unlocked rows only. It must not rewrite or reinterpret a stored lock.
