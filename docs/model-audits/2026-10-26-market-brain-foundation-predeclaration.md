# Oddsphere Market Brain foundation — frozen shadow predeclaration

Date: 2026-10-26

Status: prospective raw-provider tape plus release-pure sequence materializer; predictive value is not yet proven.
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
   that shape. No resolver is present in this release.

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

No artifact validator is included in this capture release. A future validator must verify artifact
bytes, checksums, metrics, and chronological partitions rather than accepting self-attested metadata.
An artifact cannot qualify even for reviewed shadow inference unless it records:

- the exact feature-contract release and immutable checksum;
- ordered selection and later confirmation periods;
- Margin, Total, and flip-probability calibration;
- evaluation under the actual missing-source regimes; and
- source ablations that detect dependence on one feed or book.

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
and freezes the gate-3 input corpus as `nfl_market_brain_behavior_scenarios_2026_10_26_r1`. Raw
BALLDONTLIE and SharpAPI response manifests now precede complete-pair normalization and family
replacement. They retain response hashes, returned/matched/unmatched/ambiguous row accounting,
duplicate and unsupported states, individual incomplete sides, and every recognized SharpAPI row in
the fetched pages. The release-pure materializer enforces cutoff availability and whole-target-family
exclusion before it derives continuous paths or chronology roles. Feed-side omissions, bounded
pagination, suspension lifecycle, limits, and private order flow remain explicit blind spots. No
resolver exists to pass gate 3 yet.
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
- target-free prior, quarterback/depth, injury-report, and weather availability with references to
  the sibling raw forward-evidence payload rather than copied display summaries;
- source reputation separated from observed event role;
- explicit declarations that absolute handle, ticket count, bet sizes, limits, origin, suspension
  lifecycle, and private order flow are unobservable from the current feeds; and
- no candidate decision object at all; capture has zero inference authority.

The sole existing NFL writer is the capture call site, so prospective rows accumulate the evidence
needed for honest chronological research. The whole tape has a bounded byte budget. The field is
ignored by all production/member/tracking
readers and is not attached when rebuilding around a pre-existing locked record. Existing NFL output
and every lock remain unchanged. A shadow-construction error is stored as `capture_failed` and cannot
hold or alter the production payload. The next NFL step is to persist enough prospective multi-capture
games, bind each case to the immutable prior distribution artifact, freeze a low-capacity model
tournament before examining confirmation results, and run inference in shadow.

## Rollback

Stop attaching the optional `marketBrainShadow` field and remove the all-source manifest, contract,
tests, and registry note. Previously written shadow fields are inert evidence and need not be mutated;
there is no prediction or locked member payload to unwind.
