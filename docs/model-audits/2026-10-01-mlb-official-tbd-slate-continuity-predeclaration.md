# MLB official TBD-starter slate continuity — predeclaration

Date: 2026-10-01  
Sport: MLB  
Scope: slate identity, hidden-row isolation, official-TBD bullpen publication, and the existing
`prediction_pipeline:mlb` writer boundary. No projection, probability, side, grade,
stake, market-selection, or first-inning formula is changed.

## Incident

MLB Stats listed one official postseason game for October 1 (PHI at ATL, gamePk
849844) with both starters officially TBD. The lower-authority slate provider also
returned a conditional CHC at SD game that no longer existed on the official schedule.
The stale row remained draft and was counted by slate health gates. The catastrophic
starter gate then blocked the whole slate, even though the member reader already has a
tested pending-card contract for an official game with no prediction.

The active MLB model itself already produces a low-tier both-starters-missing fallback,
but `mlb_data_completeness_v2` correctly declares that output incomplete and not normally
publishable. This repair must not expose that fallback as a completed evaluation.

## Fixed behavior before editing

1. When a successful official MLB schedule fetch is available, a lower-authority game
   that cannot be matched to it is not ingested as an active slate row.
2. A previously hidden row stays outside game-id maps, health gates, model inputs, and
   automatic publication.
3. On an official short postseason slate (one or two games) where the official feed
   explicitly has both starters TBD for every game, the starter gate returns
   `partial_ok` and runs the existing low-tier starter-neutral/bullpen model. The full-game
   Moneyline, Total, decimal score, verified prices, and evidence may publish; Best Angle
   remains blocked and first-inning action remains held without pitcher identity.
4. When official starters arrive, the next ordinary leased writer cycle follows the
   unchanged MLB model and publication flow.

## Release and writer contract

- Projection, probability, decision, and grade formulas remain the MLB champion values.
  The model-layer schema advances to
  `mlb_model_layer_versions_v18_official_tbd_bullpen_eligibility` and stamps
  `mlb_input_eligibility_v1_official_tbd_starter_neutral_bullpen_2026_10_01`.
- Sole prediction writer remains `lib/services/predictionRecordService.ts` under
  `prediction_pipeline:mlb`.
- The normal `slate-cycle` route remains the only scheduled refresh path.
- Locked and settled rows remain immutable.

## Frozen board impact

For the October 1 incident:

- official games: 1 before / 1 after;
- non-official conditional games visible: 0 before / 0 after (the row was already not
  published, and is retained hidden for audit);
- official member cards: 0 before / 1 modeled after;
- completed full-game evaluations: 0 before / 1 after;
- Best Angles / Leans / Watchlists: 0 / 0 / 0 before and after;
- promotions: 0;
- demotions: 0;
- prediction-side changes: 0;
- tracking rows: release-stamped unlocked full-game rows may be created; first-inning
  remains non-actionable until pitching becomes knowable.

This is an availability/lifecycle repair, not board flattening and not a model candidate.

## Acceptance gates

- focused slate-service, slate-publish, automation-gate, and orchestrator tests;
- `npm run verify:model-change`;
- production build and integration safety against current `origin/main`;
- protected pull request with required checks;
- live proof that PHI at ATL is the only October 1 MLB card, CHC at SD stays hidden,
  the TBD card carries no completed prediction record, and a later official-starter
  refresh can promote the normal complete card without a parallel writer.
