# NHL matchup-accuracy r6 predeclaration — 2026-09-29

## Objective and unchanged product contract

Test whether sport-specific matchup inputs can improve the active NHL regular-season
score model's chronological prediction and projection accuracy. The research target is
incremental improvement toward a 60% selected-side hit rate; 60% is a goal, not a
promised result. No candidate may change member copy, labels, layout, markets, stakes,
writer ownership, schedule, lock behavior, or historical records.

The active r5 score model remains production-authoritative unless a candidate clears
the gates below. Existing locks are immutable.

## Predeclared feature families

Every target-game feature must be constructed before applying that game's result.
Candidates are limited to these hockey-specific families:

1. **Training stability** — replace the one-season coefficient fit with a longer
   recency-weighted training window, while retaining the same chronological 2024
   selection and 2025 untouched report boundaries.
2. **Runtime parity repair** — remove any fitted input that production cannot supply
   and correct the research warm-up counter so a team needs five actual prior games.
3. **Opponent-adjusted form** — dynamic attack and defense strength that credits or
   penalizes results for the quality of the opponent already faced.
4. **Shot-quality matchup** — rolling high-danger expected goals, rebound expected
   goals, and score-adjusted shot-credit offense versus the opponent's defense.
5. **Special-teams opportunity matchup** — power-play/penalty-kill quality combined
   with prior penalties drawn and taken rather than a generic team-strength nudge.
6. **Rest and travel** — prior-game location, travel distance, time-zone change, and
   back-to-back interaction, using only the already known schedule.
7. **Starting-goalie prior form** — the target game's starter identity may be used only
   as a diagnostic upper bound because the archived dataset does not prove when that
   identity became available. All goalie-quality values must be computed solely from
   earlier games. It cannot ship until production has a timestamped pregame starter
   source and equivalent historical provenance.

No unrestricted feature search, result-derived target-game field, grade threshold,
or market-line anchoring is allowed in this tournament.

## Chronological protocol

- 2022: warm-up only.
- 2023: fit score and ability heads.
- 2024: select feature family, decay, and regularization.
- First 70% of priced 2025 games: select any fixed market-marriage parameters.
- Final 30% of priced 2025 games: untouched report set.
- Also report complete 2024 and complete priced-2025 direction and score-error results
  so a small final segment cannot hide instability.

The active r5 architecture is replayed on the identical rows. Market opening odds are
joined only after the independent forecast exists. The Total line remains zero-weighted
unless a separately predeclared market candidate proves an improvement; no such change
is part of this feature tournament.

## Acceptance and publication gates

A production candidate must:

- improve untouched-holdout winner accuracy, Brier score, or log loss while also
  improving at least one of team-score, margin, or Total MAE;
- avoid a material regression in the other score-error and Spread/Total directions;
- show the same directional benefit on the complete 2024 and priced-2025 reports;
- use only inputs available with bounded slate-level work in production;
- preserve one coherent joint score distribution for Moneyline, Total, and puck line;
- preserve every current game and market, with paired promotion/demotion reporting and
  no hidden board flattening;
- bump every affected release identifier and update the release registry;
- pass focused tests, `npm run verify:model-change`, TypeScript, production build,
  latest-main integration safety, protected pull-request checks, and live release,
  coverage, lease, lock, and reader verification.

If a feature is useful only with retrospectively known starter or lineup identity, it
remains research evidence and is not activated. If no candidate clears these gates,
r5 remains live and the result is reported without claiming a 60% model.
