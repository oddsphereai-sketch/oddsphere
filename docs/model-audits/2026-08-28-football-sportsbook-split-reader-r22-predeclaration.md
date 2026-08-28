# Football sportsbook split reader r22 predeclaration

Date: 2026-08-28

Status: frozen before implementation

## Problem

The NFL writer already makes one bounded, strictly matched SharpAPI split request, but the
member fixture publishes only Playbook public consensus. Even if a valid named-book row arrives,
the existing NFL reader cannot render it. The CFB writer already stores exact-match Circa and
DraftKings rows, but the member fixture renders only Circa and drops a complete DraftKings row
instead of using it as source-specific sportsbook context. The shared reader also describes an
NFL Moneyline outcome prediction as having "no sportsbook line" even when a verified American
price is present; Moneyline has no point spread, not no sportsbook quote.

## Predeclared change

1. Keep Circa first for every market. A complete, strictly matched Circa row is the only source
   allowed to populate the sharp-book decision section.
2. When Circa is absent or incomplete, show a complete, strictly matched DraftKings row in the
   existing display-only sportsbook split field. BetMGM may be used only when a complete exact
   row exists and DraftKings does not. Neither fallback is relabeled as Circa, SharpAPI consensus,
   Playbook consensus, or a grading input.
3. For NFL ingestion, reject SharpAPI consensus and ambiguous cross-book rows. Resolve exact
   league/team/date identity first, then choose the first complete named-book row in the fixed
   order Circa, DraftKings, BetMGM. Preserve the selected source name and provider timestamp in
   the immutable payload.
4. Wire NFL and CFB source-specific rows into the existing MLB-shared Market & Price hierarchy.
   Do not add a football-only card, dashboard, writer, route, provider call, or timer.
5. Preserve the established two-card member presentation: Public Consensus and Sharp Book
   Splits. The complete named-book fill-in occupies the existing Sharp Book Splits card until a
   complete Circa row replaces it, without adding a fallback banner or changing the layout.
   Source identity remains in typed payload and audit provenance.
6. Replace the misleading Moneyline tab copy with "model outcome forecast · exact-price grade
   separate." The outcome prediction, exact quote, Bet grade, and tracking tuple remain unchanged.

## Acceptance gates

- NFL unit coverage for exact identity, Circa priority, invalid-Circa fallback, DraftKings before
  BetMGM, rejection of consensus/ambiguity, and complementary two-sided percentages.
- NFL member coverage for all three source-specific split markets, strict separation from
  Playbook public consensus, and no render when no exact row exists.
- CFB member coverage for Circa priority and DraftKings display fallback without changing the
  grade decision.
- The current 16-game/48-market NFL and 8-game/24-market CFB replays retain identical prediction,
  price, probability, grade, promotion, demotion, lock, and tracking tuples.
- Focused tests, TypeScript, `npm run verify:model-change`, webpack build, latest-main integration
  safety, protected PR checks, natural scheduled-cycle confirmation, and signed-in live QA.

## Rollback

Restore the prior member fixtures, NFL split matcher, and shared panel labels. Immutable evidence
rows remain valid and are not rewritten.
