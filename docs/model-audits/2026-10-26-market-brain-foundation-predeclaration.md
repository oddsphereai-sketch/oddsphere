# Oddsphere Market Brain foundation — frozen shadow predeclaration

Date: 2026-10-26

Status: capture contract only; no prediction, probability, projection, grade, stake, member display,
writer, lock, or production release changes.

## Product objective

Oddsphere needs one reusable market-reading architecture across Daily Edge and player props while
retaining sport- and market-specific learned behavior. The objective is prediction accuracy, not
automatic agreement with a sportsbook. The preferred prior is to respect credible price discovery,
but the resolver must be able to confirm it, recenter toward it, cross a prediction boundary, identify
value resistance, fade a misleading move, or stand down when the complete game state supports that
conclusion.

The current NFL stack already captures a rich evidence ledger. Its active semantic arbiter still
depends on categorical named directions, agreement states, legacy split qualification, and
hand-authored forecast selection/reflection. Recording that every signal was interpreted does not
prove that the interpretation was accurate. This foundation preserves the existing evidence work but
does not treat the current arbiter as the cross-sport Market Brain.

## Frozen architecture

The Market Brain is a two-stage system:

1. A deterministic evidence layer records source identity, event identity, target-book exclusion,
   exact timestamps, price and number paths, splits, forecast candidates, injuries, weather,
   missingness, and cross-market relationships. It performs data-safety checks but no directional
   betting quotas.
2. A learned, regularized, sport/market-specific resolver consumes the variable-length masked evidence
   set or sequence and estimates one joint latent state. For full-game markets that state is Margin +
   Total; Moneyline, Spread, Total, probability, score, and grade consequences must derive coherently
   from it. Player-prop heads will use the same evidence contract with player/component outcomes.

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

## First NFL slice

The first code slice adds:

- a cross-sport Market Brain evidence/artifact contract;
- an NFL adapter from the complete full-game evidence ledger;
- continuous retention of sub-threshold splits and book paths;
- explicit feature masks and availability counts;
- joint Margin/Total boundaries and target-excluded evidence identity; and
- a fail-closed `capture_only` decision when no validated artifact is supplied.

There is deliberately no production call site. Existing NFL output and every locked record remain
unchanged. The next NFL step is to materialize release-pure training rows from the forward ledger,
freeze a low-capacity masked set/sequence tournament before examining confirmation results, and run it
in shadow beside the active reader.

## Rollback

Remove the shadow-only contract, NFL adapter, test, and registry note. There is no production state or
locked payload to unwind.
