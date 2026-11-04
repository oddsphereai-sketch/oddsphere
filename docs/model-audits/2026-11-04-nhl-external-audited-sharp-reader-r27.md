# NHL external-audited sharp market reader r27

Date: 2026-11-04  
Sport: NHL regular season  
Status: production candidate pending protected PR, merge, writer refresh and live proof

## Owner direction

The owner requested repeated external AI review of whether the NHL reader
captures sharp evidence, interprets it rather than blindly following it, and
correctly applies qualified consequences to final scores, predictions and play
grades. The requested qualification is functional product correctness followed
by forward evaluation, not another long historical betting experiment.

## Release tuple

- Model: `nhl_regular_2026_r27_external_audited_sharp_reader`
- Calibration: `nhl_regular_calibration_2026_r27_external_audited_sharp_reader`
- Decision: `nhl_regular_decision_2026_r27_external_audited_sharp_reader`
- Reader: `nhl_daily_edge_reader_2026_11_04_r20_identity_bound_reader_receipt`
- Receipt: `nhl_reader_receipt_2026_11_04_r2_identity_bound_market_evidence`
- Starting production base: `8042a567281c3e96ff651ac50b8aeece774925f5`
- Rollback tuple: r25 model/calibration/decision and r18 reader

The existing sole writer, `prediction_pipeline:nhl` lease, refresh cadence,
exact-price grading policy, stakes and official markets remain unchanged.

## External review rounds and repairs

Three independent reviewers rejected r25 and successive candidate states until
the following evidence-backed gaps were repaired:

1. Split evidence now has distinct source-observation and local-availability
   clocks. A move must occur after evidence was locally available.
2. One shared physical-book canonicalizer handles Circa, Pinnacle and Bookmaker
   aliases for breadth, leadership and execution-book exclusion.
3. Future quote clocks, stale complements, partial pairs and ambiguous
   alternate contracts are quarantined.
4. A stale priority professional split cannot suppress a fresh fallback;
   opposed fresh professional books create an explicit veto and cannot silently
   fall through to public consensus.
5. The receipt retains every professional split as selected or rejected.
   Numerical authority and display are separate: the locked card preserves
   fresh neutral/conflicting Circa evidence and fresh fallbacks, while invalid,
   future and stale rows never appear as current evidence.
6. Total history uses the exact current main contract. A historical number
   migration is admitted only when one unique complete pair proves the main
   contract changed; an alternate ladder cannot replace it.
7. A clean post-availability response is classified on its causal leg even if
   the earlier path contained volatility. Post-pressure buyback or reversal
   still vetoes numerical authority.
8. A verified flat hold can be contextual resistance, but its zero innovation
   has no numerical author and cannot claim score authority.
9. Correlated Moneyline and puck-line evidence has exactly one side-axis author;
   the persisted causal response clocks choose that author, and opposed side
   axes fail closed rather than double-counting.
10. Qualified Moneyline, puck-line and Total innovations enter one joint
    distribution. All final scores, picks, probabilities and exact-price grades
    derive from that one final distribution.
11. The receipt is canonical, hash-bound, size-bounded and bound to exact game,
    team, slate, scheduled lock boundary and complete release identity. A later
    T-60 database lock timestamp cannot invalidate it.
12. Sibling-row receipt and quote coherence is checked before fast precedence.
    Legacy locked rows retain exact stored precedence and are never recomputed.
13. Per-market member fields expose each market's categorical interpretation;
    discovery is not mislabeled as confirmation, and Total/spread no longer
    publish a null market read when one was stored.
14. An incomplete current/future MoneyPuck pair no longer erases complete prior
    state. The existing exact settled-game ID gate still rejects genuinely
    missing historical coverage.

## Decision law

The independent NHL forecast is the sole prior. The reader does not average
models, blend book probabilities, weight the score toward a current market
level, install a generic point cap, or mechanically follow a favorite or a
split.

For each of Moneyline, exact puck line and exact main Total, r27 builds complete
same-book economic paths for all available books. The exact evaluated execution
family is removed. Named professional evidence must be fresh, contract-correct,
causally ordered and internally coherent. Without split pressure, discovery
requires one unique named-book leader plus a later independent named-book
follower. One physical source authors amplitude; followers prove breadth but
never add amplitude. Opposed books, indistinguishable leaders, causal reversal,
buyback or incomplete evidence fail closed.

Accepted innovations constrain one independent product-Poisson score
distribution:

- Moneyline constrains home-win probability relative to the independent prior.
- Puck line constrains exact-line home-cover probability.
- Total constrains expected goals relative to the independent Total.

Unspecified independent coordinates are preserved. An infeasible or
nonconvergent constraint set returns the exact independent distribution. The
same evidence cannot alter the score and then apply a second categorical grade
bonus; exact-price grades consume the final probability once.

## Immutable writer and reader contract

The writer stores one identical `nhl_reader_receipt_v2` in all three sibling
prediction rows. It freezes evaluated and opposing quotes, complete trails,
source and availability clocks, public consensus, all selected/rejected
professional sources, considered market paths, author/followers, observed and
applied innovation, independent/final decision points and independent/final
scores.

The locked reader validates the receipt identity and hash and renders it before
mutable stats, roster, split, current-line or history reads. Invalid new
receipts are reported while exact stored tuples remain retained. Legacy r23-r25
locks render their exact legacy payloads and are never rewritten, suppressed or
reinterpreted under r27 semantics.

## Verification contract

Required checks:

- `npx tsc --noEmit`
- `npm run test:nhl-regular-model`
- `npm run verify:model-change`
- `node scripts/verify-integration-safety.mjs --base-ref=origin/main`

Focused tests cover causal timing, source/receipt clocks, future/stale
quarantine, fresh professional fallback, professional conflict veto, selected
locked split display, sportsbook aliases, execution exclusion, unique
leadership, pre-pressure volatility, post-pressure reversal, contextual holds,
exact Total contract migration, one side author, all three score consequences,
projection fail-closed, paired actionable promotion/demotion, receipt tamper and
identity checks, sibling coherence, locked precedence, market-scoped counts and
per-market member signals.

## Current-board rehearsal

The November 4 read-only rehearsal processed four games and twelve markets with
zero errors. Against the r25 stored rows it produced one Total side change,
zero promotions, one demotion and seven actionables instead of eight: zero Best
Angle, seven Lean and five Watchlist. The current named-book episodes were flat
or otherwise non-authoritative after exact execution-book exclusion, so no
reader innovation changed a score on this snapshot. The changed Total is the
coherent final-distribution result rather than an invented market consequence.
No actionability quota was used.

## Remaining boundary

R27 qualifies reader function and evidence integrity. It does not guarantee
future betting accuracy or guarantee that every future game has a qualified
episode. Forward performance must be evaluated by exact release identifier and
locked timestamp; releases must never be blended in reporting.

## Rollback

Rollback is the complete r25 model/calibration/decision tuple and r18 reader.
Never relabel an r27 row as r25, mutate an r27 or legacy locked snapshot, or mix
release records in performance reporting.
