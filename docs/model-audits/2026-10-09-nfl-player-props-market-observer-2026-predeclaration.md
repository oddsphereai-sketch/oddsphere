# NFL player props 2026 market observer by prop — predeclaration

Date: 2026-10-09  
Starting production base: `7075be815f0526e53eaa9180fdc6cb609aa1ccfc`

## Question

Determine, separately for every supported NFL player-prop family, whether real same-sportsbook
opening-to-T-60 movement confirms or opposes OddSphere's locked side strongly enough to improve a
decision. This is a market-reader audit, not an independent-model input. It cannot change an
independent projection or retroactively reinterpret a locked record.

The already-opened aggregate result is disclosed: across 207 canonical locked 2026 scopes,
supportive movement was 21/37 and adverse movement was 42/90. The per-market outcomes, threshold
comparisons, weekly splits, and clustered intervals have not been opened before freezing this plan.

## Frozen source and limitations

- Input release: `nfl_player_props_2026_locked_replay_rows_2026_10_08_r1`, SHA-256 pinned at run
  time. It contains 207 canonical actionable scopes from Weeks 1-4, 47 games, seven ordinary prop
  families, exact settled outcomes, the locked side/line/price/book, and the same book's retained
  opening line/price.
- The sample has no Anytime Touchdown action. That family must report zero eligible rows rather than
  borrow another market's rule.
- Weeks 1-3 did not retain the complete No Play/Watchlist board. This is an actionable-selection
  sample and cannot test a paired promotion rule or authorize a demotion, flip, grade, or board-size
  change.
- The frozen export identifies the stored provider opening and T-60 lock but does not carry the
  opening observation timestamp, intermediate snapshots, player position, source-class label, or
  a separately sampled post-T-60 close. The audit therefore cannot claim opening-timestamp health,
  T-60-to-close behavior, sharp-book behavior, position stability, or complete market selection.
- No cross-book snapshot may become movement. A target/execution book's own movement is described
  as target-book evidence, never target-excluded consensus or a synthetic sharp source.

## Frozen movement states

For each exact sportsbook/player/game/market/side identity:

1. A line move is supportive for an Over when the line falls and for an Under when the line rises;
   the reverse is adverse. Line movement owns the classification because selected-side prices at
   different thresholds are not directly comparable.
2. When the line is unchanged, convert opening and locked American prices to raw selected-side
   implied probabilities. Test absolute movement floors of 1.0, 2.5, and 5.0 percentage points.
   An increase is supportive; a decrease is adverse. This is not a no-vig probability because the
   frozen export does not retain the opposing-side pair.
3. A missing opening, no qualifying change, or contradictory unusable evidence is neutral. Missing
   evidence may not manufacture a vote.

## Chronology and metrics

- Use Weeks 1-2 only to select the price-movement floor per market. Choose the floor with the
  largest support-minus-adverse win-rate gap, then the most rows, then the more conservative higher
  floor.
- Open Weeks 3-4 once per-market floors are selected. Report total/week rows and games, supportive,
  adverse and neutral counts, win rate, support-minus-adverse gap, and the accuracy of fully flipping
  adverse sides.
- Bootstrap support-minus-adverse win-rate differences by game with 4,000 seeded resamples. Report
  an interval only when both states occur in at least five games; otherwise mark it unavailable.
- Report the locked final-probability Brier and log loss for each state as context. Do not fit a
  probability adjustment from this selected sample.
- A family is directionally interesting only if Weeks 1-2 and Weeks 3-4 gaps have the same sign,
  confirmation has at least 20 scopes and at least five games in both support and adverse states,
  and the confirmation point gap is at least five percentage points. This is still audit-only.

## Production gate

This audit cannot authorize production because it lacks complete-board promotion evidence,
position fields, full timestamped sequences, target-excluded source identity, and an untouched
prospective sample under the newly released independent models. A future candidate must be
predeclared per prop, use complete immutable opening/T-24/T-6/T-60 observations, separate line from
price movement and target from target-excluded books, test promotions with demotions, and improve
direction, Brier, and log loss on an untouched release-pure window before it can adjust or flip a
forecast.

No writer, cadence, T-60, lock, fallback, provider call, model release, grade, stake, copy, label,
layout, or stored record is changed by this audit.

## Prospective capture-only continuation

The missing prospective evidence will be collected by the existing production writer only after
its authoritative coherent member snapshot has written successfully. The capture is an internal,
separately keyed research record. It consumes only the already-built exact offers, decisions, and
market-evidence tuples from that writer cycle and must make zero additional provider requests.

The immutable unit is one exact game / provider player (plus exact name) / prop family / canonical
line / sportsbook / source class / observation landmark. It retains the evaluated target-side mask,
the sportsbook's paired Over and Under prices (or the actually supplied Yes price for Anytime TD),
the observed and fetched timestamps, scheduled start, T-60 lock, player position, and the model,
calibration, decision, writer, and capture release stamps. A provider opening is retained only when
the provider supplied a real `openingObservedAt`, opening line, and complete opening price tuple.
First observed is never renamed as provider opening. No cross-book pair may be constructed.

The prospective landmarks are:

- true provider opening, while the game remains unlocked;
- the first coherent observation at or after T-24 and before T-23;
- the first coherent observation at or after T-6 and before T-5; and
- the first coherent T-60 lock observation before kickoff.

T-60 is the product lock, so there is no distinct post-T-60/pre-lock interval to manufacture. A
later close can be added only if the provider and product later retain a genuine separately timed
pre-lock close. Captured rows are append-only by deterministic identity: later cycles may add a
missing book or landmark but may not replace an existing row, and nothing is added after kickoff.

The store must enforce deterministic row, decoded-byte, and gzip-byte ceilings; source-time
ordering; complete same-book prices; idempotent replay; and an exact release/schema checksum. A
corrupt, oversized, failed, or unavailable capture is telemetry-only. It may not fail the writer,
change or delay a prediction/member/locked snapshot, mutate a locked record, alter a probability,
side, grade, stake, or board count, or affect tracking and settlement. Focused tests must prove
these isolation, immutability, timestamp, identity, and size properties before publication.
