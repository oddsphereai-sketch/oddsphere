# NFL full-game evidence arbiter — frozen predeclaration

Date: 2026-10-26

Status: frozen research contract; no production authority until every gate below passes.

## Product defect

The released NFL pipeline captures substantially more evidence than its final side reader interprets.
`nflMarketState` retains continuous book trails, but directional split rows can be discarded below a
direction threshold or after a line mismatch. `nflThreeStateMarketReader` can then return unavailable
when stable named Moneyline history is absent even though fresh target-excluded price consensus,
Spread movement, public or source-identified flow, and a roster-aware projection are present. The
primary exact-stat score is also roster-blind while the separately stored paid projection is
player-aware.

This is an interpretation-coverage defect. It is distinct from unavoidable prediction error: the
system may be wrong after considering every usable observation, but it may not silently omit an
available observation from the decision.

Dallas at Philadelphia is one defect reproduction, not a selection rule. The released score favors
Philadelphia while the player-aware score, current target-excluded Moneyline, and target-excluded
Spread favor Dallas. The released reader reports `no_stable_named_moneyline_direction` and applies no
side correction.

## Frozen signal-accounting contract

Every captured pregame observation must appear once in a game-level ledger with:

1. exact game, market, side, source family, source class, observed time, and target-book-exclusion state;
2. raw number and two-sided price where available, no-vig probability, hold, and opening-to-current
   deltas without rounding away sub-threshold movement;
3. persistence, reversal, buyback, move order, key-number crossings, source disagreement, and stale or
   line-mismatch state;
4. money-minus-ticket gap with denominator limitations retained rather than promoted to absolute bet
   size;
5. roster, quarterback, injury, weather, exact-stat, and player-aware forecast observations with their
   availability and provenance;
6. a disposition of `supports`, `resists`, `uncertainty`, `duplicate`, `stale`, `identity_mismatch`, or
   `unavailable`, plus a machine-readable reason; and
7. a final-decision reference proving that every fresh, identified, nonduplicate observation was
   considered by the arbiter.

Freshness, event identity, source identity, target-book exclusion, and mathematical coherence remain
hard data-safety boundaries. They are not directional betting thresholds. A small or conflicting
signal remains represented with correspondingly small or uncertain influence.

## Candidate architecture

The candidate is a regularized whole-game mixture of coherent forecast experts, not another rule
ladder and not a universal scalar market weight.

- `independent_exact`: the current exact-stat joint margin/Total distribution when available;
- `player_aware`: the current paid player-aware joint score projection;
- `market_conditioned`: a target-excluded joint market forecast derived from Moneyline, Spread, and
  Total levels plus their complete chronological narratives; and
- `released_current`: the released coherent forecast as a continuity comparator.

The arbiter receives the complete continuous ledger and selects one joint forecast expert, or a
predeclared regularized residual candidate, for Margin and Total. It may retain, reduce, or reverse the
independent winner and may cross a Spread or Total boundary when the complete evidence supports it.
It must then rebuild one coherent score distribution from the selected Margin and Total. Moneyline,
Spread, Total, probabilities, representative score, price evaluation, and play grade are all derived
from that one distribution.

The tournament may compare only these predeclared low-capacity families:

1. regularized expert-error selector;
2. regularized joint Margin/Total residual using the full continuous ledger; and
3. regularized winner/cover/Total outcome heads whose probabilities are mapped back to one coherent
   Margin/Total distribution.

No team-specific exception, reported-game exception, minimum number of agreeing signals, automatic
favorite/underdog rule, or one-book flip rule is eligible. The selected family and hyperparameters are
chosen on the selection partition only and evaluated once on the later confirmation partition.

## Frozen chronology

The checksum-matched 59-game current-release ledger is ordered by scheduled start and partitioned
before candidate results are inspected:

- development: first 30 games through 2026-10-11;
- selection: next 14 games from 2026-10-12 through 2026-10-18;
- confirmation: final 15 settled games from 2026-10-19 through 2026-10-26.

The sample is limited and already-opened operational evidence. It is suitable for rejecting harmful
candidates and for an explicitly provisional owner-approved repair, not for claiming a pristine or
universal sharp model. Any larger checksum-matched historical evidence recovered later is an
additional stress test and may not change the already-frozen selection procedure.

## Launch gates

The candidate is rejected unless all of the following are true:

1. 100% of fresh, identified, nonduplicate captured observations have a ledger disposition and a
   final-decision reference; missing preferred named-book history cannot erase other observations.
2. Confirmation Moneyline winner accuracy, Spread direction, Total direction, team-score MAE, Margin
   MAE, and Total MAE are reported against the released reader. Claimed target markets may not regress.
3. Every changed winner, Spread, Total, promotion, demotion, correction, and harm is listed. Aggregate
   improvement cannot hide a failed market or a flatter board.
4. Any actionable demotion has a tested promotion route, and board counts plus exact-price units are
   reported by market and overall.
5. Dallas at Philadelphia is evaluated only after selection is frozen. It cannot select the model.
6. Locked writer and reader precedence tests prove byte-for-byte immutability. Only future unlocked
   payloads may use a qualified release.
7. Model, calibration, decision, grade, member, writer, fixture, snapshot, reader, and artifact releases
   advance together under the sole writer and shared `prediction_pipeline:nfl` lease.
8. Focused NFL tests, TypeScript, `npm run verify:model-change`, latest-main integration safety, protected
   pull-request checks, and post-deploy live release/data/coherence verification all pass.

## Rollback

Restore the released r34/r33/r42/r39 family for future unlocked rows. Never rewrite or reinterpret an
existing lock. Preserve the rejected candidate ledger and artifacts for audit.
