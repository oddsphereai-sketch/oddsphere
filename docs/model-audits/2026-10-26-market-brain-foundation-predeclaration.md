# Oddsphere Market Brain foundation — frozen shadow predeclaration

Date: 2026-10-27

Status: prospective raw-provider tape, exact-prior binding, and release-pure research harness; predictive value is not yet proven.
No prediction, probability, projection, grade,
stake, member display, tracking, or lock changes. The sole NFL writer release advances only to attach
the production-inert shadow tape to future unlocked evidence rows.

## Product objective

Oddsphere needs one reusable market-reading architecture across Daily Edge and player props while
retaining sport- and market-specific learned behavior. The objective is prediction accuracy, not
automatic agreement with a sportsbook. The preferred prior is to respect credible price discovery,
but the resolver must be able to confirm it, recenter toward it, cross a prediction boundary, identify
value resistance, fade a misleading move, or stand down when the complete game state supports that
conclusion.

The current NFL stack already captures a rich evidence ledger, but the downstream ledger is not a
lossless input boundary. In particular, the split feed requested Circa, DraftKings, and BetMGM and
then retained only the first complete book, while unavailable candidates could disappear. The active
semantic arbiter also depends on categorical directions and hand-authored resolution. Recording that
every downstream signal was interpreted does not prove that upstream observations survived or that
the interpretation was accurate. This foundation therefore starts before the arbiter.

## Frozen architecture

The Market Brain is a two-stage system:

1. A deterministic evidence layer records source identity, event identity, target-book exclusion,
   exact timestamps, price and number paths, splits, forecast candidates, injuries, weather,
   missingness, and cross-market relationships. It performs data-safety checks but no directional
   betting quotas.
2. A later learned, regularized, sport/market-specific resolver consumes the variable-length masked
   evidence set or sequence. Two-team full-game markets can use a Margin + Total latent state; soccer
   three-way fixtures and player props have distinct subject/prior contracts and are not forced into
   that shape. This release freezes the NFL resolver contract and tournament, but contains no fitted
   resolver artifact and grants no prediction authority.

The resolver must not require three of four signals, two named books, a universal split gap, or a
fixed market weight. Small observations remain small continuous observations. Missing Circa,
DraftKings, SharpAPI, or split data is an explicit mask and source-availability regime, never a zero or
neutral signal. Provider identity stays available to the model so a public consensus split is not
silently treated as Circa flow.

## Internal versus member-facing evidence

The complete internal evidence case may include provider identities, raw split limitations, target
exclusions, and unavailable modalities even when the member product shows a simpler explanation. The
display layer is downstream and may summarize only the final validated interpretation. It may not be
used as a model input and may not suppress an internal observation.

## Historical-evidence policy

Limited history changes the strength of the claim, not the meaning of the evidence. Chronological
testing remains required, but a small or already-opened ledger is used to reject harmful candidates,
measure instability, and define uncertainty. It is not converted into a false claim that no
improvement is possible. When history is insufficient for production authority, the resolver stays in
shadow/capture mode while forward evidence accumulates.

The exact target-free Margin and Total PMF bytes are embedded once per unique NFL event/prior with
event/release/availability identity, marginal hashes, and one content-addressed artifact checksum.
Later append-only captures retain the means and marginal hashes but reference those immutable bytes
by checksum. A missing or divergent referenced artifact fails materialization closed.
The capture contract and sequence materializer independently verify mass, means, timestamps,
identity, and checksums. The research manifest and evaluator enforce rolling chronology, post-cutoff
labels, sequence-checksum binding, and release-pure aggregation rather than accepting self-attested
metadata. A future resolver artifact cannot qualify even for reviewed shadow inference unless it records:

- the exact feature-contract release and immutable checksum;
- ordered selection and later confirmation periods;
- Margin, Total, and flip-probability calibration;
- evaluation under the actual missing-source regimes; and
- source ablations that detect dependence on one feed or book.

## Cost and storage envelope

Market Brain construction is deterministic and makes zero provider requests. It consumes only the
odds, splits, availability, prior, and context already fetched by the sole NFL writer; it creates no
second timer, writer, lease, browser request, or paid AI call. Provider request counts and the existing
hourly/T-60 cadence remain visible in the writer's existing `requestBudget`.

The frozen Week 1 PMFs average roughly 15 KiB before database compression. Repeating them on every
append-only hourly capture would add about 40.8 MiB per 16-game, 168-capture week, or roughly 734 MiB
over 18 such weeks. Content-addressing reduces that prior component to about 1.38 MiB per week and
24.9 MiB over the same illustrative season—about a 97% reduction—while preserving exact bytes. The
automated cost-budget test requires every repeated reference to stay below 1 KiB, at least 95% smaller
than the full artifact, and the illustrated weekly prior component to remain below 2 MiB. These are
conservative raw-JSON estimates; actual database compression is not counted as permission to exceed
the envelope.

Every later sport or prop adapter must ship its own executable budget proof before capture is enabled:
incremental provider requests per refresh, maximum provider credits per slate/day, bytes per case,
duplicate-artifact savings, retention projection, and failure behavior at the cap. A candidate resolver
is ordinary versioned model inference; it must not invoke a paid LLM or other per-pick generative API.
Research jobs must remain bounded/offline and require an explicit cost preview before any paid data pull.

Production promotion is a separate future model-change decision. It additionally requires
release-pure outcome comparison, calibration and accuracy by market, every changed prediction and
harm, paired promotion/demotion analysis, board-count impact, lock precedence, the sole sport writer
and lease, full verification, latest-main integration safety, and post-deploy proof.

## Readiness gates

“Works as intended” is not one test. The NFL program must pass these gates in order:

1. **Observable-evidence completeness.** Every requested source has an explicit state; every returned
   exact-identity row survives; target and target-excluded quotes remain distinguishable; missingness
   and current-feed blind spots are visible; source reputation does not invent move leadership.
2. **Production non-interference.** Removing `marketBrainShadow` from a future payload reproduces the
   incumbent production/member/tracking input, a capture error cannot hold the game, no locked row is
   adapted, and no production reader consumes the field.
3. **Frozen behavioral scenarios.** Before training, freeze examples for genuine sharp discovery,
   retail follow-through, no-move resistance, price-only movement, key-number crossing, reversal,
   buyback, split disagreement, stale/missing sources, favorite/underdog asymmetry, and cross-market
   Moneyline/Spread/Total contradiction. Each scenario needs an expected confirm/recenter/flip/fade/
   stand-down distribution, not a required count of agreeing inputs.
4. **Release-pure chronological replay.** Materialize sequences only from information available at
   each timestamp; separate training, selection, and later confirmation windows; report calibration,
   Brier/log loss, prediction accuracy, economic results, changed picks, harms, promotions,
   demotions, and board counts by missingness/source regime.
5. **Prospective shadow probation.** Run the frozen resolver without authority, compare it with the
   incumbent and actual outcomes/closing markets, inspect every disagreement, and require stable
   behavior across enough games and source outages before proposing any production influence.

This release implements gate 2, the observable portion of gate 1 available from the current feeds,
and freezes the gate-3 input corpus as
`nfl_market_brain_behavior_scenarios_2026_10_27_r2_probabilistic`. Every one of the 13 stories now
contains a non-one-hot expected distribution across confirm, recenter, flip, fade-market, retain, and
stand-down plus a bounded probabilistic comparison; these are evaluation fixtures, never points,
signal-count requirements, or production inference rules. Raw
BALLDONTLIE and SharpAPI response manifests now precede complete-pair normalization and family
replacement. They retain response hashes, returned/matched/unmatched/ambiguous row accounting,
duplicate and unsupported states, individual incomplete sides, and every recognized SharpAPI row in
the fetched pages. The release-pure materializer enforces cutoff availability, exact-prior
verification, and whole-target-family exclusion before it derives continuous paths or chronology
roles. The research evaluator rejects labels available at or before the case, mixed releases,
duplicate events, and non-chronological partition manifests; it records corrections and harms
against the exact prior baseline. Feed-side omissions, bounded
pagination, suspension lifecycle, limits, and private order flow remain explicit blind spots.
`nfl_market_brain_resolver_contract_2026_10_27_r5_reproducible_manifest_bound` freezes three low-capacity candidate
families, their complete hyperparameter grids, ablation order, rolling-origin selection objective,
artifact provenance, and shadow-only authority under
`nfl_market_brain_tournament_2026_10_27_r5_reproducible_manifest_bound`. A candidate must emit one feasible
joint NFL score-state distribution; Margin, Total, expected team scores, and winner probabilities are
derived from it. The independent action-probability head was removed because it could contradict that
posterior; the resolver records only factual prior/posterior deltas and boundary crossings, which
cannot directly assign points, grades, or stakes. No fitted resolver artifact exists, so gate 3 has
not been passed.
`nfl_market_brain_resolver_features_2026_10_27_r5_lossless_availability_timeline` is the sole eligible trainer
boundary: it preserves the exact independent prior and all eligible continuous paths, splits,
context, chronology, and missingness, but excludes evaluated-family prices, splits, and expected-input
states. Target-only additions cannot change its feature payload hash.
Passing repository tests is not evidence that gates 3–5 have passed, and it does not authorize a
confirm, flip, fade, grade, or stake change.

## First NFL slice

The first NFL code slice adds:

- a discriminated cross-sport observable-evidence contract for two-team games, three-way fixtures,
  and player markets;
- a source-by-source SharpAPI manifest that keeps the incumbent preferred split unchanged while
  separately retaining every exact-identity Circa, DraftKings, and BetMGM row;
- explicit incomplete, duplicate, unavailable, stale, future, and unsupported states;
- raw opening/current quote selections before incumbent complete-pair filters, directional thresholds,
  or same-family replacement, with response checksums, row accounting, and exact-evaluated,
  same-family, and target-excluded provenance;
- distinct provider-observed, provider-fetched, Oddsphere-ingested, and inference-available times;
- target-free prior, quarterback/depth, player-level injury-report facts, and numeric weather
  observations with their own availability-safe timestamps;
- source reputation separated from observed event role;
- explicit declarations that absolute handle, ticket count, bet sizes, limits, origin, suspension
  lifecycle, and private order flow are unobservable from the current feeds; and
- no candidate decision object at all; capture has zero inference authority.

The sole existing NFL writer is the capture call site, so prospective rows accumulate the evidence
needed for honest chronological research. Each tape has a 96 KiB hard cap and an explicit zero-new-
provider-request budget. It is removed from the authoritative payload before the NFL evidence append
and written afterward to an isolated append-only research table; a research read/write failure cannot
block, roll back, or alter the authoritative append, member snapshot, tracking record, or lock. It is
not attached when rebuilding around a pre-existing locked record. Existing NFL output and every lock
remain unchanged. A shadow-construction error is stored as `capture_failed`. The next NFL step is to persist enough prospective multi-capture
games, freeze a low-capacity model tournament before examining confirmation results, adapt the
incumbent semantic reader only as a candidate/comparator against this lossless contract, and run
inference in shadow. The companion `Rebuild Daily Edge models` work has been explicitly coordinated:
its opened 59-game result is development/regression evidence only and cannot serve as confirmation.

## Rollback

Stop attaching the optional `marketBrainShadow` field and remove the all-source manifest, contract,
tests, and registry note. Previously written shadow fields are inert evidence and need not be mutated;
there is no prediction or locked member payload to unwind.
