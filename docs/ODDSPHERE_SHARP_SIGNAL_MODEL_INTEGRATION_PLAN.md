# OddSphere Sharp Signal Model Integration Plan

Status: planning / model-integrity track  
Date: 2026-06-24  
Purpose: define how sharp-market data should move from UI/grade context into prediction accuracy, calibration, and ROI improvement without overfitting or fake sharp claims.

## Goal

Use sharp-market data to improve OddSphere's actual betting process:

- Better pick selection.
- Better confidence calibration.
- Better Best Angle selection.
- Better Caution / No Play discipline.
- Better ROI over time.

This is not a claim that sharp signals automatically improve the model. They must earn influence through backtests and forward validation.

## Source Ownership

SharpAPI remains the primary owner for true sharp-market features:

- Per-book odds.
- Fair/no-vig probability.
- +EV.
- Closing odds / CLV.
- Delta movement.
- Streaming movement.
- Arbitrage / middles / low-hold.

Playbook remains the primary owner for public-market context:

- Public bet percentage.
- Public money/handle percentage.
- `booksUsed`.
- Consensus market context.

Derived in-house features:

- Steam.
- Reverse line movement.
- Sharp money divergence.
- Public smoke.
- CLV performance by bucket.

## Model Layers

### Layer 1: Base Projection

Base projections are the sport model's independent view.

Examples:

- MLB win probability.
- MLB projected total.
- First-inning probability.
- WNBA/NBA/NHL model probabilities.

Rule: sharp data should not blindly overwrite this layer. It can become an input only after validation.

### Layer 2: Market Prior / Calibration

Market data can improve calibration by anchoring or regularizing the model.

Allowed candidate inputs:

- No-vig market probability.
- Consensus market probability.
- Sharp-book/fair probability.
- Market total.
- Book-count / source-quality metadata.

Use cases:

- Shrink extreme model probabilities toward market when the model has fragile inputs.
- Detect impossible model-market gaps.
- Improve confidence calibration.

### Layer 3: Sharp Signal Features

Sharp signals can become model features after validation.

Candidate features:

- Aligned +EV percentage.
- Opposing +EV percentage.
- No-vig model edge.
- Sharp money divergence.
- Public bet / money gap.
- Public-heavy flat-money smoke.
- Same-source line movement.
- Reverse line movement.
- Steam count / speed / book count.
- Closing-line movement after pick time.
- `booksUsed` and split-quality flags.

Important: each feature needs source, timestamp, market, side, and confidence metadata.

### Layer 4: Decision Policy

This is where signals affect what users see.

Allowed impacts after validation:

- Upgrade from Watchlist to Lean.
- Downgrade from Lean to Watchlist.
- Block Best Angle.
- Trigger Caution.
- Trigger No Play.
- Change staking/confidence bucket internally.

Not allowed without strong evidence:

- Flip a pick solely because public splits disagree.
- Create a Best Angle solely from public splits.
- Treat Playbook consensus as book movement.
- Treat a single weak sharp signal as decisive.

## Validation Path

### Step 1: Shadow Feature Logging

Log candidate features beside existing picks without changing predictions.

Track:

- Feature values at pick time.
- Existing pick/grade/verdict.
- Proposed feature-driven adjustment.
- Result.
- Closing price when available.

### Step 2: Backtest / Replay

Replay historical slates where data exists.

Measure:

- Win rate.
- ROI/units.
- Calibration by confidence bucket.
- Grade performance.
- Best Angle performance.
- Caution/No Play avoidance value.
- CLV when closing data exists.

### Step 3: Forward Validation

Run the new policy in shadow on live slates.

Compare:

- Current production decision.
- Proposed sharp-signal decision.
- Result.
- Units.
- CLV.
- Whether the change helped or hurt.

### Step 4: Promote Small

Promote only one controlled behavior at a time.

Examples:

- Public-smoke downgrade only.
- Opposing very-strong EV blocks Best Angle.
- Aligned strong EV upgrades Watchlist to Lean only when model edge clears a floor.
- RLM caution only when same-source movement and public side are both valid.

## ROI Discipline

ROI improvement should be measured by decisions, not anecdotes.

Required reporting:

- Baseline production ROI.
- Shadow policy ROI.
- Delta units.
- Sample size.
- Confidence bucket changes.
- Grade bucket changes.
- Sport/market split.
- Whether improvement came from better picks or better avoidance.

Do not promote a signal just because it sounds sharp. Promote it because it improves the betting process.

## Immediate Next Tickets

1. `o-sharp-signal-feature-inventory`  
   Inventory which sharp features are currently real, fake/disabled, derived, or unavailable.

2. `o-sharp-signal-model-impact-audit`  
   Build a read-only audit comparing current predictions to proposed sharp-signal adjustments.

3. `o-clv-foundation`  
   Confirm what closing price data exists, what is missing, and what is required to measure CLV correctly.

4. `o-market-signal-correctness-audit`  
   Already on the Overhaul board. Must validate EV, steam, RLM, public smoke, and line movement labels.

5. `o-playbook-model-impact-audit`  
   Already started. Public splits are one input family; they must be evaluated separately from true sharp signals.

## Promotion Rule

No sharp signal becomes a production model/projection/prediction input until:

- The source is valid.
- The same-source movement rule is satisfied where movement is involved.
- The feature can be reproduced in an audit.
- The before/after impact is measured.
- The result improves accuracy, ROI, calibration, or avoidance.
- The UI claim is truthful.

The standard is not "more sharp data." The standard is better decisions.
