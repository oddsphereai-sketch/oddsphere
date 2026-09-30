# Cross-sport market-intelligence integrity predeclaration — 2026-09-30

## Owner direction and scope

The owner directed Oddsphere to verify and repair the internal market-reading
marriage across every currently live Daily Edge model: MLB, NFL, CFB, NHL, and
WNBA. The member product must retain its existing cards, copy, labels, and
layout. In particular, a healthy last-known fallback may continue to occupy the
existing **Sharp Book Splits** panel silently. Display continuity does not grant
that fallback the same predictive authority as a verified named sharp book.

This audit covers the complete internal chain:

1. exact-event and exact-market identity;
2. provider, source-book, source-type, line, price, and observation-time
   provenance;
3. same-book opening/current movement and reverse-line interpretation;
4. sport-specific authority for confirmation, resistance, adjustment, or a
   validated direction flip;
5. one coherent final score distribution, prediction side, exact-price
   decision, and play grade; and
6. append-only publication, lock, tracking, and reader continuity.

No result from one sport authorizes a coefficient or rule in another sport.
Each sport remains an independent model and release family.

## Predeclared defects and hypotheses

### Cross-sport source identity

- **Defect hypothesis:** a SharpAPI row whose advertised source is
  `consensus` can currently be classified as `sharp_adjacent_book`. This can
  make a display fallback eligible for internal rules intended for a named
  sharp-book source.
- **Required behavior:** `consensus`, DraftKings, BetMGM, Playbook, and any
  other fallback remain available for the unchanged display hierarchy, but
  retain their truthful internal source class. Only a verified named book may
  activate a named-book rule.
- **Primary endpoint:** no decision path that requires named sharp-book
  evidence may consume a consensus or retail fallback as that evidence.

### MLB

- **Defect hypothesis:** the coherent price-map path can accept an isolated
  Circa two-sided price outlier even when the surrounding named-book market is
  coherent, because its group median has no cross-book outlier guard.
- **Repair candidate:** apply one deterministic, side-symmetric robust
  cross-book probability filter before sharp/retail group aggregation. The
  filter may reject an isolated observation only when adequate cross-book
  breadth exists; it must retain ordinary Circa/Pinnacle disagreement and must
  never fabricate a price.
- **Primary endpoints:** Moneyline probability calibration/Brier and Total
  direction on release-pure locked rows; exact-price/source coherence; current
  board coverage.
- **Required case review:** Toronto, Colorado, and Yankees examples identified
  by the owner, using only evidence available at each decision timestamp.

### NFL

- **Hypothesis:** the active independent team-score path and final joint PMF
  are coherent, but source-specific split and same-book movement arbitration
  may not match the documented authority hierarchy in every market.
- **Primary endpoints:** team-score MAE, margin MAE, total MAE, Moneyline
  Brier/log loss, Spread/Total direction, score/side coherence, and actionable
  board counts, separated by release and locked timestamp.

### CFB

- **Defect hypothesis:** the current 75% canonical-market / 25% independent
  mixture is inconsistent with the owner-directed independent-model-first
  architecture and can suppress genuinely predictive separation.
- **Candidate under separate release:** retain the improved sport-specific
  independent model and use chronological, source-aware market evidence for
  arbitration rather than broad market anchoring.
- **Primary endpoints:** team-score MAE, margin MAE, total MAE, Moneyline Brier
  and winner accuracy, Spread/Total direction, coverage, and board counts on
  chronological release-pure evaluation.

### NHL

- **Null hypothesis:** the current r9 decision to exclude public/fallback split
  nudges remains correct because the documented confirmation window was worse
  with that nudge. Same-book named-price movement and the 20% no-vig sanity
  input remain separately auditable.
- **Primary endpoints:** team-goal MAE, margin/total MAE, Moneyline Brier and
  direction, puck-line/Total direction, source identity, and board counts.

### WNBA

- **Defect hypothesis:** source-aware rows and same-book movement are captured
  incompletely by the incumbent writer, so the dynamic market probability
  blend and public-context grade logic may not represent the complete market
  evidence contract.
- **Primary endpoints:** score/margin/total MAE, Moneyline Brier and direction,
  Spread/Total direction, source coverage, score/side coherence, and board
  counts, evaluated only where release-pure settled evidence is sufficient.

## Evaluation and leakage controls

- All performance claims are release-separated and timestamp-bounded. Inputs
  observed after a decision or lock are excluded.
- A source-specific rule is evaluated only on rows whose source identity and
  timestamp were captured before the decision. Missing evidence is unavailable,
  never neutral, supportive, or fabricated.
- Current-slate replay is a coverage/coherence/board-impact test, not an
  accuracy claim.
- Historical exploration and confirmation windows are disclosed separately.
  No opened diagnostic window is called a pristine holdout.
- A market flip is eligible only when the sport-specific chronological evidence
  supports that class of flip. Otherwise the evidence may confirm, resist, or
  leave the independent forecast unchanged.

## Publication gates

For each production model change:

- bump every affected runtime/release identifier and update
  `docs/current-model-releases.md` in the same commit;
- preserve the single sport-scoped `prediction_pipeline` writer/lease;
- report current-board games and all market counts, prediction-side changes,
  promotions, demotions, and actionable-count changes;
- pair any actionable demotion rule with an evaluated symmetric promotion path;
- require zero score/winner/Spread/Total contradictions and no missing healthy
  game or market;
- run focused tests, `npm run verify:model-change`, the production build, and
  latest-main integration safety from a clean committed worktree;
- publish only through a protected pull request; and
- verify the live release, writer/cron health, source coverage, model
  coherence, lock/tracking behavior, and member reader after merge.

Display-only fallback continuity may ship without changing predictions only
when its tests prove zero side, score, grade, and board-count impact. A model
change that does not clear these gates remains audit-only and does not alter
production behavior.
