# NFL outcome/value separation and player-state authority — predeclaration

Date: 2026-11-05

Status: owner-directed production candidate; implementation and local gates
complete; not yet published.

Starting production base: `6df2750c6417ed71cd9dc0803466870b56ac36de`.

## Owner contract

The predicted winner, score, margin, total and outcome probabilities answer only
what is most likely to happen. An attractive offered price, expected value or
betting value may not select or move any of those outputs. Price economics are
evaluated only after the final outcome law and contract side are frozen, and may
affect only the Bet grade.

This does not discard market reading. A source's chronological number/juice
reaction may remain evidence about the game. It is distinct from declaring that
the currently offered bet is attractive. Current executable price, break-even
probability, edge and expected value remain downstream grading inputs.

## Exposed defect

The November 5 JAX@BAL capture has a market-free exact-provider score of JAX by
1.89 and a complete player-aware score of JAX by 13.83 after Baltimore's verified
quarterback replacement. The active base selector always chooses the exact team
state when it exists, even though that score has no player or quarterback input.
The relative market reader then transports only the named-price episode captured
after November 3 and publishes JAX by 2.78. The final score therefore misses the
known player-state regime; Baltimore +10 value is then easy to confuse with the
most likely game margin.

Separately, the evidence ledger still receives an absolute
`target_excluded_paired_price_score` candidate. The current relative-innovation
runtime does not normally select that candidate as the final numerical law, but
retaining it as a forecast candidate violates the requested architectural
boundary and leaves an unsafe legacy path.

## Candidate policy

1. Choose exactly one market-free outcome base; never average or weight models.
2. Keep the exact-provider completed-game state as the normal authority.
3. When a verified availability resolution replaces a provider quarterback and
   a complete player-aware projection was collected after the displaced depth
   snapshot, select the player-aware projection as the target-free base because
   it represents the current player regime that the team-state model cannot.
4. Apply the existing same-book relative economic-path reader once to that base.
   Do not substitute an absolute current price, line, market-implied mean, edge or
   expected value for the outcome law.
5. Freeze winner/score/probabilities before selecting the executable contract and
   calculating exact-price EV. The contract line determines the Spread/Total side;
   the offered price and EV may change only its grade.
6. Preserve every existing locked payload byte-for-byte. The candidate applies
   only to future unlocked rows and future locks.

## Required proof before publication

- Unit proof for the player-state authority selector, stale/missing player-aware
  rejection, identity rejection, and no-replacement exact-state retention.
- Metamorphic proof that changing only executable American prices changes no
  forecast score, probability or side, while grades may change.
- Same-input 15-game / 45-market comparison reporting every score, side,
  probability, promotion, demotion and actionable-count change.
- Specific JAX@BAL reasoning receipt separating the predicted margin from BAL +10
  contract value.
- Exact locked-payload hash equality, sole writer and
  `prediction_pipeline:nfl` lease continuity.
- Focused NFL tests, `npm run verify:model-change`, fresh-main integration safety,
  protected PR publication and live release/board verification.

Rollback restores the preceding base selector and reader candidate input for
future unlocked rows only. It never rewrites a stored lock.

## Completed evidence

The final SELECT-only Week 9 replay covered 15 games / 45 markets with zero
writes. It iterated evaluated target-book exclusions to a stable fixed point,
then applied the same market qualification and grade-posture contracts used by
the writer.

- Outcome-base authority: 13 exact-provider state, 2 verified player-aware
  availability regime (JAX@BAL and ARI@SEA).
- Actionables: 18 before, 18 after; zero actionable promotions and zero
  actionable demotions.
- JAX@BAL: JAX by 2.78 / total 46.42 becomes JAX by 14.08 / total 39.18.
  Moneyline remains JAX; Spread changes BAL +10 Lean to JAX -10 Lean; Total
  changes Over 39.5 Lean to Under 39.5 Lean.
- ARI@SEA: SEA by 6.51 becomes SEA by 8.92. Moneyline remains SEA and Total
  remains Under; Spread changes ARI Watchlist to SEA No Play.
- The remaining market-side changes are zero. A sub-tenth BUF@MIN replay delta
  does not change any side or grade. Reconstructed execution-contract selection
  creates non-actionable/tier-only LAR@WSH and GB@NE comparison differences;
  they do not change actionability and are not attributed to the authority rule.

Structural and metamorphic proof now establishes that outcome-base selection
has no line, price, edge, EV, split or sportsbook input; an absolute current
paired-price coordinate is absent from the writer's forecast-candidate list;
and changing only executable prices preserves the full forecast object, selected
side and model probability while allowing the grade to change.

`npm run verify:model-change`, the focused NFL writer/runtime/grade suites,
TypeScript, predecessor continuity and byte-exact lock tests all pass. The local
PostgreSQL Market Brain proof was skipped because `MARKET_BRAIN_POSTGRES_URL` is
unset; that feature is production-neutral and unrelated to this candidate.
