# NFL player props: field goals made and kicking points predeclaration

Date: 2026-10-15

Status: research only; production and public actionability unchanged

## Question

Can a football-structured kicking model improve independent Field Goals Made and Kicking Points accuracy by decomposing team scoring opportunities from kicker conversion skill, without sportsbook inputs?

## Chronology and evidence boundary

Fit on 2017-2024, select architectures on 2025, refit through 2025, and score 2026 Weeks 2-5. Report the four kickers from OddSphere's two archived Week 5 games separately. The private archive and observer contain no Field Goals Made or Kicking Points offers, so economic and market-reader conclusions are unavailable.

## Decomposition

Field Goals Made is modeled as:

1. team field-goal attempt opportunity, driven by recent attempts, drives, red-zone/goal-to-go possessions, scoring mix, offensive volume, opponent concessions, game environment, and coaching tendency;
2. kicker make probability, partially pooled by recent attempts/makes and distance buckets, with roof, wind, and temperature context.

Kicking Points is modeled as the compound result `3 × field goals made + PATs made`. Field-goal and PAT count means are estimated separately. Threshold probabilities are generated from the convolution of independent Poisson component distributions; this independence assumption is audited as a limitation because both components share team scoring opportunity.

## Architectures

- Foundation: shrunk rolling team attempt volume × shrunk kicker conversion rate for field goals, plus a shrunk team/kicker PAT component.
- Candidate A: regularized Poisson GLMs for field goals made and PATs made.
- Candidate B: shallow, strongly regularized Poisson tree models for each component.

All features are pregame and football-only. Actual same-game scoring, sportsbook totals/spreads, lines, prices, and movements are excluded.

## Selection and gates

Each component architecture is selected by 2025 mean Poisson deviance, then threshold Brier and MAE. The selected component pair is evaluated on 2026.

Field Goals Made must improve mean Poisson deviance, MAE, average Brier over 0.5/1.5/2.5/3.5, and at least three thresholds. Kicking Points must improve MAE, RMSE, and average Brier over 4.5/5.5/6.5/7.5/8.5/9.5. Game-cluster bootstraps quantify uncertainty.

Even if both gates pass, production remains unauthorized until release-pure exact offers/prices are retained and a versioned product path is reviewed. No live release, grade, stake, writer, reader, or public page is changed.
