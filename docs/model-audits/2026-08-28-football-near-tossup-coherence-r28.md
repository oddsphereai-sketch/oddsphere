# Football near-toss-up coherence (r28)

Date: 2026-08-28

Status: verified production candidate. No provider, cron, writer, or database was manually invoked.

## Result

The shared football coherence gate now distinguishes a real cross-surface contradiction from a mathematically valid discrete-distribution toss-up. A score/winner sign mismatch may pass only when:

- a joint PMF or complete margin/total distribution is supplied;
- that distribution independently reproduces the published expected score and win probability;
- absolute expected margin is no more than 0.5 points; and
- the home-away win-probability gap is no more than 2 percentage points.

Provider game `458220` is the exact incident regression: expected home margin `+0.1757457846952022`, home win `49.448767833981844%`, and an away-winner representative score. Its distribution identity passes, so the near-toss-up mean no longer aborts the entire slate. The same values without a checkable distribution remain fatal. Material expected-score/winner disagreement remains fatal.

## Invariants

No PMF, score, probability, prediction side, representative final, exact quote, line, price, market fair probability, EV, threshold, grade, stake, split, lock, or tracking row changes. There are zero promotions and zero demotions. PMF mass/identity, representative-score winner, three-market disposition, exact side/line identity, EV recomputation, positive-value actionability, and Moneyline/Spread event containment all remain mandatory.

The single CFB and NFL writers and their `prediction_pipeline` leases are unchanged. Only their release identifiers advance so the assertion behavior is not changed under an old runtime stamp.

## Releases

- Shared gate: `football_cross_market_coherence_2026_08_28_r2_distribution_tossup`
- CFB writer: `cfb_forward_evidence_writer_2026_08_28_r17_distribution_tossup`
- NFL writer: `nfl_forward_evidence_writer_2026_08_28_r13_distribution_tossup`
- Model, distribution, probability, decision, grade, collector, member, fixture, lock, and tracking releases: unchanged.

## Verification

- Focused shared coherence regression: pass.
- CFB production and Sharp exact-event suites: pass.
- NFL forward writer and release-contract suites: pass.
- TypeScript: pass.
- `npm run verify:model-change`: pass.
- `npm run build -- --webpack`: pass, 105/105 static pages.
- `git diff --check`: pass.

## Production acceptance

Protected merge is followed by an untouched natural CFB writer cycle. Completion requires a successful atomic append, current-slate replay, exact USC/EMU evidence review, unmatched-Sharp rejection, and signed-in CFB/MLB QA.

## Rollback

Restore shared gate r1, CFB writer r16, and NFL writer r12. Immutable evidence and locked/tracking rows remain unchanged.
