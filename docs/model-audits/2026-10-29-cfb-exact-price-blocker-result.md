# CFB exact-price comparison-count correction

## Scope and owner authorization

The owner explicitly requested publishing this narrow correctness repair
without a large historical testing project. The exception is recorded in
`docs/model-change-safety.md`; no profitability improvement is claimed.
Original base: `bc66ac5a3356b34cf92ed7065bd40f2bac15571c`.

The final grading path preserves every incumbent-priced market. When the
incumbent cannot grade a market, one valid other exact-line book supplies
comparison context; if none exists, the real target's complete opposing pair
supplies explicitly attributed target-only context with zero independent
books. Comparison count cannot itself hold the market or impose a permanent
Watchlist ceiling. Normal exact-price/push EV, confidence, price-tier,
resistance, verified-QB, health and anchorless caps remain authoritative.

Forecast seeding and weather sportsbook selection explicitly retain the
incumbent policy. This repair therefore does not alter reader/forecast inputs
or the score/PMF. No provider, request budget, cadence, writer topology, lease,
member copy, split panel, chart or layout change is introduced.

## Release tuple and immutability

- Calibration / policy / decision / tuple: r28 / r29 / r55 / r42,
  `2026_10_29_*_paired_price_context`.
- Sole writer: r142; member fixture: r96; snapshot / reader: r56 / r41.
- Forecast model/runtime/distribution/probability and market-reader production
  releases, evidence schema r47, member r64 and tracking identity are unchanged.
- The existing `prediction_pipeline:cfb` lease remains mandatory.
- Exact r54 locked payloads retain their original calibration r27, policy r28,
  tuple r41, scores, probabilities, prices, grades and evidence. The prior
  snapshot family remains readable during rollout. Tests prove old-lock reader
  precedence and writer planning protection; no stored lock is rewritten.

## Same-input sole-runtime rehearsal

At `2026-10-29T20:32:15.596Z`, one provider bundle and one authoritative full PMF
per game supplied both policies in the existing writer with `apply:false`.

| Measure | Incumbent | Correction |
| --- | ---: | ---: |
| Upcoming games compared | 96 | 96 |
| Best Angle | 17 | 17 |
| Lean | 26 | 26 |
| Watchlist | 96 | 96 |
| No Play | 17 | 17 |
| Internally held | 132 | 132 |

All 156 previously evaluated markets retain exact sides, grades, probabilities,
prices, EV, edge and price context. Forecast changes: zero. Promotions: zero;
demotions: zero; net actionable change: zero. This particular provider capture
had no qualifying comparison-only recovery. It is not represented as proof of
a recovered live JMU Lean or future profitability.

Targeted regression tests separately reproduce the JMU-shaped −18.5 / −110
zero-comparator case through the actual production decision and market-aware
grade functions: it reaches Lean at 55.665% exact cover probability rather
than a comparison-count hold. A zero-comparator Total at sufficient confidence
reaches Best Angle; low-confidence/negative-EV cases do not. One-comparator,
nearby-line exclusion, malformed/stale/future/wrong-game/unsupported-source
rejection, incumbent parity and future T-60 eligibility are also tested.

The rehearsal proposed 96 unlocked payloads, made zero database writes and
had zero capture failures. Local Playbook credentials were absent: its lines
and splits calls returned 401, which the writer reported while reusing its
existing continuity/fallback behavior. This is not a claim of healthy production
Playbook credentials; production must be checked after deployment. Some FCS
games still lack the authoritative full-game anchor/reference. This unrelated
source/coverage hold is deliberately not bypassed.

Reproduction and complete counts:
`scripts/operator/verify-cfb-price-context-rollout.ts` and
`docs/model-audits/2026-10-29-cfb-price-context-same-input.json`.

## Verification and integration

Passed before publication: complete CFB suite, new paired-context tests,
full `npm run verify:model-change`, TypeScript, focused ESLint and diff check.
The optional Market Brain PostgreSQL proof was skipped because its local URL
was unset; two pre-existing unused-argument lint warnings remain in the CFB
evidence module. No extended historical tournament or threshold tuning ran.

Production main advanced during work to `86c99a4303af9bc5e5dcd0ecec9fecb2315a7743`
(NFL No Play explanation only). Its two changed files do not overlap this
repair; the new base must be integrated and affected tests rerun before push.
Main protection was verified: `current-main-ancestor` is required, strict
up-to-date checking and administrator enforcement are enabled, force pushes
are disabled.

Open PR #811's overlapping CFB hunks were reviewed: they target obsolete
SharpAPI split history and pre-cutover release IDs, not this price-context
policy. This repair preserves the newer main Owls cutover and does not revive
that canceled service. PR #811 is behind main and must undergo its own fresh-
base reconciliation before merging. Open #676 touches the registry in an NFL
props section; #606 touches governance. No unmerged work was copied over main.

## Rollout and rollback

Publish only by protected PR after clean committed integration safety and
fresh-main/tree/check verification. Then verify the deployed commit, r142
leased writer, r55 evidence, r56 snapshot, source/grade coverage, reader
snapshot and the next natural scheduled pass. Do not claim live success from
this rehearsal alone.

Rollback the complete decision r54 / calibration r27 / policy r28 / writer
r141 / fixture r95 / snapshot r55 family together, preserving every already
stored immutable lock and its original release. No backfill, lock relabeling
or independent refresh/writer is authorized.
