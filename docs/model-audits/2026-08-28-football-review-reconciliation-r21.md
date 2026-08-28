# Football prediction and sportsbook-evidence reconciliation r21

Date: 2026-08-28

Status: production candidate; protected publication, natural-cycle evidence, and live QA pending

## Owner requirements

1. Prediction means the model prediction. Missing sportsbook evidence cannot replace,
   blank, hold, or relabel the score/winner/Spread/Total forecast.
2. Missing named-book evidence is a writer/provider defect to exhaust and monitor, not
   an acceptable generic “book unavailable” endpoint.
3. “Held” is not a member prediction or Bet grade. Internal fail-closed recovery remains
   machine-visible, while the member contract is a live prediction plus reasoned No Play.
4. NFL and CFB score, winner, Spread, and Total outputs must pass the same logical
   publication checks used by the mature Daily Edge product.

## Prediction authority repair

The NFL and CFB member fixtures now publish `marketPrediction` from their primary joint
score distribution:

- Moneyline: the joint-PMF winner and winner probability.
- Spread: the higher cover probability from the same joint PMF at the displayed line.
- Total: the higher Over/Under probability from the same joint PMF at the displayed line.

The exact-price Bet selection remains a separate field with its sportsbook, line, price,
calibrated probability, fair probability, EV, and grade. It cannot overwrite the
prediction. Missing odds cannot erase the model-native projected margin or projected total.

The existing runtime `football_cross_market_coherence_2026_08_28_r1_event_containment`
boundary remains active in both sole leased writers. It rejects PMF-mass, expected-score,
winner-direction, reachable-score, market-count, duplicate-market, side/line identity,
quote, EV, actionable-value, and Moneyline/Spread event-containment failures before the
single append. The member fixtures add release-specific 8/24 and 16/48 assertions so a
future reader change cannot silently substitute `pick` for `marketPrediction` again.

### Concrete corrections

- NE at SEA: expected score remains NE 23.5-SEA 25.4 and winner prediction SEA 55.3%.
  At +3.5, the score-distribution Spread prediction is NE +3.5, not the separately
  calibrated SEA -3.5 No Play selection shown in the prior reader.
- Hawaii at Stanford: primary expected score remains Hawaii 22.4-Stanford 26.4 and the
  Moneyline prediction is Stanford 60.5%. Hawaii at +152 remains a separately labeled
  thin price-value Lean under the unchanged exact-price policy; it is never presented as
  OddSphere's predicted winner. Hawaii +4 is a separate exact spread contract and remains
  No Play because its stored exact-price EV is negative.
- NC State at Virginia: primary UVA 27.8-23.8 / 60.6%. UVA -177 is No Play on price while
  UVA -4 -109 is Lean; the two exact contracts carry their own probabilities, EVs, and
  thresholds instead of being forced to share a grade.

## Paid-source sportsbook coverage

A bounded read-only audit used every configured paid CFB market source: BALLDONTLIE,
SharpAPI, and Playbook. It made three BALLDONTLIE requests, two exact-event SharpAPI
requests, one Playbook request, and zero writes.

For strict event `ncaaf_sanjosestatespartans_usctrojans_2026-08-29_b2`:

- SharpAPI returned nine named books.
- Complete Spread pairs were present at BetOnline, 1xBet, Rebet, and theScore Bet.
- Complete Total pairs were present at Bally Bet, BetOnline, Goldrush, 1xBet, Pinnacle,
  Rebet, and theScore Bet.
- BetMGM posted a verified one-sided SJSU Moneyline at +6600.
- Sportzino posted a verified one-sided SJSU Moneyline at +2000.
- No sportsbook posted the opposing USC Moneyline side.
- Playbook separately reported consensus USC -50000 / SJSU +1825, Spread USC -38.5,
  and Total 61.5. It remains consensus context, never a named target-book quote.

The previous Sharp normalizer discarded one-sided offers before member DTO construction,
and the writer passed only the six grading books into the display surface. The candidate
now retains every verified main-market observation from the paid BALLDONTLIE response and
the strict SharpAPI exact-event response in `displayBooks`. Complete paired grading books
remain separately scoped in `currentBooks`.

For SJSU-USC Moneyline the member result is therefore:

- prediction: USC from the primary joint PMF;
- real representative sportsbook context: Sportzino SJSU +2000, explicitly one-sided;
- rejected display outlier: BetMGM SJSU +6600 versus Sportzino +2000 and
  Playbook consensus +1825;
- Bet grade: No Play because no complete target-book pair/no-vig benchmark exists;
- no synthesized USC price, implied probability, EV, movement, or tracking tuple.

## Board replay and grade impact

The latest SELECT-only current CFB replay read 240 immutable rows and compared all eight
games / 24 markets. The NFL replay read 928 rows and compared all 16 games / 48 markets.

| Board | Before | Candidate | Promotions | Demotions | Tuple changes |
| --- | --- | --- | ---: | ---: | ---: |
| CFB | 1 Best Angle / 3 Lean / 7 Watchlist / 10 evaluated No Play / 3 incomplete grade tuples | unchanged | 0 | 0 | 0 |
| NFL | 3 Best Angle / 11 Lean / 7 Watchlist / 27 No Play | unchanged | 0 | 0 | 0 |

All eight CFB games and all 16 NFL games pass score/winner coherence. NFL publishes 48/48
model-owned market predictions. Fourteen NFL exact-price selections differ from their
model prediction at the exact line; 13 are No Play and the only actionable difference is
the same-team WSH line comparison (+4.5 prediction versus +5.5 Lean). Those differences
remain on the explicitly separate Bet-grade axis.

## External-review reconciliation

The attached review was prepared against pre-PR-241 commit `919e0061`. Its broad concerns
about score/market inconsistency, missing exact CFB odds, brittle per-game exceptions,
provider visibility, NFL Player Props verification, homepage sport copy, and legacy record
provenance were reconciled against current production before changing code.

Unsafe proposals remain rejected: guessed CFB calibration coefficients, a placeholder FCS
Elo offset, weakening two-book grading consensus to manufacture action, arbitrary NFL Props
model-weight changes, and treating player participation probability as outcome probability.
Those require chronological refits and old-versus-new decision evidence, not launch-time
constants.

## Release contract

- BALLDONTLIE CFB slate: `balldontlie_ncaaf_slate_2026_08_28_r3_display_quote_coverage`
- Sharp price fallback: `cfb_sharpapi_named_book_fallback_2026_08_28_r4_display_quote_coverage`
- CFB evidence / collector / member / writer:
  `cfb_forward_evidence_snapshot_2026_08_28_r7_display_quote_coverage` /
  `cfb_forward_evidence_collector_2026_08_28_r10_display_quote_coverage` /
  `cfb_v1_member_release_2026_08_28_r10_representative_market_quotes` /
  `cfb_forward_evidence_writer_2026_08_28_r12_display_quote_coverage`
- CFB fixture: `cfb_v1_member_fixture_2026_08_28_r12_representative_market_quotes`
- NFL fixture: `nfl_week_one_member_fixture_2026_08_28_r9_primary_prediction_authority`

The decision/calibration thresholds, exact grading tuples, action counts, leases, writer
ownership, provider-call ceilings, T-60 locks, tracking, settlement, and stakes are unchanged.

## Verification

Completed before publication:

- focused CFB Sharp exact-event/display-quote tests;
- focused CFB production/member/T-60 contract tests;
- focused NFL 16-game/48-prediction member contract tests;
- TypeScript `--noEmit`;
- SELECT-only CFB and NFL grade replays; and
- bounded paid-source CFB book-coverage audit;
- full `npm run verify:model-change`; and
- webpack production build;
- latest-main reconciliation onto production `a2a0c8832671` (MLB r72) with
  `node scripts/verify-integration-safety.mjs --base-ref=origin/main` passing
  from a clean committed worktree.

Still required at this document revision:

- protected PR checks;
- natural leased-writer capture under the candidate releases; and
- signed-in desktop/mobile live QA of prediction, Bet grade, representative Sportzino
  +2000 context with BetMGM +6600 excluded as an outlier,
  complete SJSU-USC Spread/Total evidence, and unmatched-Sharp suppression.
