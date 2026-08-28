# CFB directional joint-PMF r19 production audit

## Outcome

The candidate closes three production defects without a reader-side prediction
override:

- The dynamic CFB joint PMF can no longer publish opposite expected-score and
  winner-probability directions. Football has no Toss-Up exception.
- The r7 immutable evidence wave remains readable when JSONB omitted an optional
  `undefined` property, and r8 hashes the exact JSON-serializable shape.
- The writer evaluates bounded provider responses at the latest real observation
  included in the payload instead of the earlier scheduled run-start timestamp.

The existing sport-scoped `prediction_pipeline:cfb` lease and sole scheduled
writer remain authoritative. No provider call, writer call, database write,
tracking mutation, or manual cron was made during this audit.

## Exact defect repair

UC Davis at Portland State (`458220`) previously had UCD 26.4857 / PRST 26.6615,
UCD 50.5512%, and a reachable UCD 27-26 final from one quantized PMF. The r19
builder selected the PMF probability winner and found the smallest bounded
symmetrical raw-center correction, 0.10 points per team. The rebuilt PMF is UCD
26.5914 / PRST 26.5499, UCD 51.1349%, reachable UCD 27-26. PMF mass, team means,
margin, total, winner probability, representative winner, and line probabilities
all pass identity checks.

The strict shared gate is
`football_cross_market_coherence_2026_08_28_r3_strict_directional_pmf`.
NFL uses the same strict gate under writer r14; no NFL output changed.

## Current board replay

The SELECT-only replay read 294 immutable rows and compared the latest 38 games /
114 markets.

- Before: 23 exact tuples: 2 Best Angles, 3 Leans, 9 Watchlists, 9 evaluated No
  Plays; 91 unavailable.
- Candidate: 26 exact tuples: 3 Best Angles, 3 Leans, 9 Watchlists, 11 evaluated
  No Plays; 88 unavailable.
- Impact: three availability promotions, zero demotions, zero changes to an
  already evaluated tuple or grade.
- Coherence: 38/38 games passed; the only directional PMF correction was 458220.
- Primary score dispersion across the expanded board: team scores 8.1693-53.4689
  (SD 8.0643), margins -7.8820 to +36.9209 (SD 11.3435), totals 37.0888-76.4267
  (SD 7.7881).
- Strict Sharp split coverage was 2/38 games in the stored wave. Only exact
  league/team/date matches render.

The actual provider completion time recovers:

- SJSU +38.5, FanDuel -104: No Play, 48.4628% model probability, 50.3587% fair,
  -4.9384% EV.
- SJSU-USC Under 61.5, FanDuel -110: Best Angle, 58.9294% model probability,
  50.6254% fair, +12.5015% EV.
- MTST-UTU Under 56.5, BetMGM -108: No Play, 51.3682% model probability,
  49.4939% fair, -1.0686% EV.

SJSU-USC Moneyline remains market-scoped unavailable because the stored evidence
does not contain a coherent two-sided target quote. It does not suppress Spread
or Total. Hawaii-Stanford remains primary Stanford 26.4-22.4 / 60.5%, with the
football-only Hawaii baseline separately labeled. Existing Hawaii, Virginia,
EMU, USC, and all other evaluated exact-price grades are unchanged.

## Releases and rollback

- score artifact: `cfb_v1_joint_score_artifact_2026_08_28_r4_directional_pmf`
- model/distribution/probability/representative: the corresponding 2026-08-28 r2
  directional-PMF releases
- decision/schema: `cfb_v1_daily_edge_decision_2026_08_28_r12_directional_pmf` /
  `cfb_v1_exact_price_decision_tuple_2026_08_28_r6_directional_pmf`
- evidence/member/writer/fixture: r8 / r15 / r18 / r19 directional-PMF releases
- NFL writer: `nfl_forward_evidence_writer_2026_08_28_r14_strict_directional_pmf`

Rollback is CFB score/model r3/r1, decision/schema r11/r5, evidence/member/writer
r7/r14/r17, fixture r18, NFL writer r13, and shared gate r2. Immutable evidence
and tracking rows are never rewritten.

## Validation

Focused CFB directional-PMF, production-contract, weekly-engine, decision,
SharpAPI odds/splits, shared football coherence, and NFL writer/member/coherence
suites passed. TypeScript, the full `npm run verify:model-change` suite, and the
105-route webpack production build passed. Integration safety, protected PR
checks, natural-cycle verification, and signed-in live QA are recorded in the
deployment handoff after completion.
