# OddSphere Model Signal Boundaries

Date: 2026-06-24  
Status: source-of-truth inventory for provider/model incorporation

## Purpose

OddSphere should use better data to make better betting decisions, but the model must only consume signals that are real for the provider, sport, market, side, and timestamp.

This document defines what can affect display, market signals, grades, predictions, and future ROI validation for MLB, WNBA, and World Cup.

## Provider Lanes

| Lane | Playbook | SharpAPI / current soccer | Model use |
| --- | --- | --- | --- |
| Public bet % | Primary for MLB/WNBA once promoted | Current MLB backstop only | May affect public-smoke / split-divergence after audit |
| Public money % | Primary for MLB/WNBA once promoted | Current MLB backstop only | May affect public-smoke / split-divergence after audit |
| `booksUsed` / split quality | Playbook-owned | Not current SharpAPI signal field | Display now; model quality flag only after audit |
| Consensus line context | Playbook-owned context | Sharp/current odds still own priced markets | Display/context only; never movement |
| Per-book odds | Not Playbook | Sharp/current odds | Market probability / pricing input |
| Fair/no-vig probability | Not Playbook | SharpAPI / in-house no-vig | Model edge / grade input when source is trusted |
| +EV | Not Playbook | SharpAPI `/opportunities/ev` | Can affect market confirmation/resistance |
| Steam | Not currently exposed by SharpAPI provider; not Playbook | Disabled/false in current provider | Do not use until a real same-timestamp source exists |
| RLM | Not Playbook; not currently exposed by SharpAPI provider | Disabled/false in current provider | Do not use until same-source movement exists |
| CLV | Not Playbook | Future/current tracking lane | Validation metric only until closing data is reliable |
| Player props | Not current Playbook lane | SharpAPI future/potential | Separate future model path |

## Sport Rules

### MLB

Current state:

- MLB already has public split data flowing through `sharp_signals`.
- Public split fields can affect `deriveMarketSignal`, `classifyEvidence`, `deriveGrade`, and ultimately user-facing market/grade labels.
- Therefore, replacing MLB public splits with Playbook is a model-impacting change, not only a display change.

Allowed now:

- Run Playbook splits in shadow.
- Compare Playbook vs current public split values.
- Use Playbook mapper for read-only audits.

Promotion requirement:

- Multi-slate audit must report changes to market signal, grade, verdict, Best Angle, confidence, tracking rows, and eventual results/CLV.

### WNBA

Current state:

- WNBA had no public split lane before Playbook.
- WNBA prediction record writer currently uses model, odds/market, price, grade, and projected score fields, not public split percentages.
- Claude's Step A WNBA public split display should be user-facing/context-first and should not change predictions or grades.

Allowed now:

- Store/display Playbook public bet %, public money %, and freshness for pregame WNBA games.
- Reuse existing public split fields for WNBA because there is no competing WNBA public split source.

Promotion requirement:

- Before WNBA public splits affect grades, Best Angle, confidence, or No Play, add a WNBA-specific model-impact audit.

### World Cup / International Soccer

Current state:

- Playbook does not currently cover World Cup / international soccer in our verified lane.
- Soccer/World Cup prediction logic should continue using the current soccer + SharpAPI/current odds pipeline.

Allowed now:

- Keep World Cup in every site-wide/provider audit.
- Use current soccer odds, market probabilities, and reconciliation logic.

Forbidden:

- Do not synthesize World Cup public splits from Playbook.
- Do not route Playbook consensus lines into soccer movement, RLM, or sharp labels.

## Model Boundary

Base projections remain sport-model owned:

- MLB win probability, projected total, and first-inning probability.
- WNBA moneyline/spread/total model outputs.
- World Cup match result, total, BTTS, double-chance, and score projections.

Market data can influence decision policy only through audited inputs:

- Market probability / no-vig probability.
- True +EV.
- True same-source movement.
- Public split divergence.
- Public smoke.
- Split quality/freshness flags.

Public splits alone must not:

- Flip a model pick.
- Create a Best Angle.
- Pretend to be sharp money.
- Pretend to be steam, RLM, Pinnacle, or CLV.
- Override a sport projection.

## Current Code Facts

- `lib/providers/playbook/playbookPublicSplitsMapper.ts` maps Playbook split rows into public-splits-only records and explicitly leaves +EV, fair probability, steam, RLM, CLV-like fields null/false.
- `lib/providers/real_api/SharpAPISignalProvider.ts` explicitly sets steam and RLM fields false/null because the current SharpAPI tier/provider path does not expose them.
- `lib/services/marketSignalDerivationService.ts` allows public splits to produce `public_smoke`; +EV, steam, and RLM have their own separate branches.
- `lib/services/signalEvidenceClassifier.ts` separates EV, steam, RLM, sharp divergence, and public smoke evidence.
- `lib/automodel/playGrade.ts` already has a `sharpAgreement` hook where true opposing sharp context can block Best Angle.
- `lib/services/wnba/buildWnbaPredictionRecords.ts` does not currently use public split percentages for WNBA record creation.

## Immediate Implementation Sequence

1. WNBA display lane: Playbook splits to user-facing public bet/money/freshness, no model changes.
2. MLB shadow lane: compare Playbook public splits against current MLB split values and grade impact.
3. Model feature inventory: keep this document and `scripts/test-provider-signal-boundaries.ts` passing as provider boundaries change.
4. Sharp signal audit: identify which fields are real, disabled, derived, or missing before expanding model influence.
5. CLV foundation: prove closing-price data quality before claiming process improvement.

## Promotion Standard

A provider feature may affect predictions, grades, or Best Angle only when:

- The source is real and reproducible.
- The feature has sport, market, side, timestamp, and provenance.
- Movement uses the same source from open/current/close.
- Before/after impact is measured.
- Historical or forward validation improves accuracy, ROI, calibration, or avoidance.
- The user-facing claim is truthful.
