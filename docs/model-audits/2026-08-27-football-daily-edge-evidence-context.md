# Football Daily Edge evidence context

Date: 2026-08-27

Scope: NFL and college-football member-reader context only

Production behavior: unchanged

## Decision

The normal NFL and college-football readers now surface compact, market-specific football evidence without changing a prediction, probability, side, price, grade, stake, writer, lock, or tracking record.

The presentation distinguishes three roles:

- `Outcome model input`: a numerical feature carried by the active college-football weekly outcome artifact.
- `Bet model input`: a numerical feature carried by the NFL r6 exact-price decision artifact. These rows are not represented as direct r10 point-model inputs.
- `Current context`: a current evidence-snapshot fact such as expected-quarterback status or venue/weather. Context is never directionally highlighted as if it caused a grade.

## Provenance and reader coverage

NFL rows use the frozen r6 team states already shipped in `nflR6MoneylineShadow.json`: opponent-adjusted offense and defense EPA, success rate, early-down pass efficiency, plays, explosiveness, red-zone touchdown rate, sack rate, prior scoring, and Elo. The card states that the completed-2025 profile was frozen on the artifact generation date. Current quarterback and venue/weather values come from the immutable forward-evidence row used to build the member fixture.

College-football rows use the exact team profile in `cfbV1WeeklyRuntimeArtifact.json`: EPA/play, success, early-down efficiency, prior scoring margin and scoring profile, pace, explosiveness, red-zone success, line yards, Elo, completed-game count, and last completed-game timestamp. Current expected-quarterback status remains separately labeled context.

Existing detailed availability/injury panels, same-book opening/prior/current trails, exact evaluated prices, Playbook consensus, and SharpAPI panels are unchanged and remain the authoritative surfaces for those evidence classes.

The member route applies the same presentation-only enrichment to a compatible compact NFL snapshot read before falling back to a raw evidence rebuild. This prevents the normal snapshot cache from hiding new evidence cards until the next six-hour writer wave. It does not rewrite or republish the cached snapshot, call a provider, or mutate a decision tuple.

## Deliberate gaps

- The NFL member DTO does not persist a public numerical copy of every r10 outcome-vector feature or a chronological game-by-game team history. The reader therefore does not claim the r6 team state is the r10 outcome vector or fabricate a recent-game log.
- The college-football forward payload does not yet contain a separate current injury feed or issued weather forecast. Those facts remain absent rather than inferred from roster data.
- Expected quarterbacks are explicitly `Projected`, `Confirmed`, or `Unknown`; a projected row is not presented as official confirmation.

## Board impact and safety

- actionable promotions: 0
- actionable demotions: 0
- prediction/probability/score changes: 0
- evaluated price/grade/stake changes: 0
- writer, provider, lease, lock, or tracking changes: 0

The change is DTO enrichment plus reader labeling only. Cross-sport regressions ensure EPL and the shared Daily Edge presentation retain their existing semantics.
