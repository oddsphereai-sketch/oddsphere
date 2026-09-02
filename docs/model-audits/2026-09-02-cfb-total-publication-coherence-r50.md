# CFB Total publication coherence r50

Date: 2026-09-02
Status: production candidate; no push or publication before owner integration review

## Scope and unchanged authority

This is a publication-coherence repair, not a model or grading change. The r49 score runtime, model, joint distribution, probability, representative score, calibration, grade policy, decision release, exact-price tuple and market/sharp production release remain unchanged. The existing CFB forward-evidence writer remains the sole writer under `prediction_pipeline:cfb`; no provider request, schedule, weekly-slate rule, quarterback substitution, injury/weather safety rule, grade threshold, stake, lock, tracking or reader-copy behavior changes.

The candidate changes only these repository files:

- `lib/services/football/cfbForwardEvidenceWriter.ts`
- `lib/services/football/cfbForwardEvidence.ts`
- `lib/services/football/cfbMemberFixture.ts`
- `scripts/test-cfb-v1-production.ts`
- `docs/current-model-releases.md`
- this audit

Publication releases advance to:

- member: `cfb_v1_member_release_2026_09_02_r29_total_publication_coherence`
- writer: `cfb_forward_evidence_writer_2026_09_02_r40_total_publication_coherence`
- fixture: `cfb_v1_member_fixture_2026_09_02_r42_total_publication_coherence`
- public outcome contract: `cfb_market_sharp_public_outcome_contract_2026_09_02_r42_total_publication_coherence`

The explicit same-schema fallback is `cfb_v1_member_release_2026_09_01_r28_coherent_movement_evidence`. Evidence schema r19, collector r26 and tracking r13 remain unchanged because the payload shape, collection, decision mathematics and tracking behavior do not change.

## Defect and repair

The live Albany–Buffalo row had a complete authoritative Total decision and six complete named-book two-sided Total quotes, including BetMGM 48.5 at Over -102 / Under -118. Its expected total was 48.7, its public consensus was Over 53% money / 43% tickets, and its strictly matched sharp split was truthfully unavailable. After the unchanged decision engine selected the PMF side and assigned its negative-EV `No Play`, a writer-only helper removed that exact tuple, nulled the Total outlook and emitted `mean_pmf_near_tossup_conflict`. The member reader therefore displayed “Total prediction unavailable” even though required market evidence was complete. Repeated current r28 rows proved this was not a stale-reader or identity/coverage failure.

The repair deletes only that post-decision suppression. The published row retains the authoritative PMF-selected side, probability, exact sportsbook/line/price, EV and existing `No Play` grade. It does not use the expected-score mean to derive a replacement side, does not promote the Total, does not synthesize confidence or sharp evidence, and does not reinterpret public consensus as sharp splits. The r29 member handoff accepts a complete r28 wave until r29 is complete and may mix only exact valid immutable r28 T-60 rows into a partial r29 wave; ordinary future unlocked gaps keep the complete r28 wave.

## Frozen 87-game comparison

The no-write replay froze the September 3–7 weekly window at `2026-09-02T11:54:55.920Z`. All 87 FBS-involved games were present. The stored r28 board contained 215 evaluated tuples: **18 Best Angles / 39 Leans / 107 Watchlists / 51 No Plays**, with 57 actionables. Applying only the publication repair produced 217 evaluated tuples: **18 / 39 / 107 / 53**, still 57 actionables. All 215 existing tuples remained byte-for-byte inputs to the candidate comparison. There were zero projection, existing-tuple probability, side, grade, actionable or stake changes.

Exactly two markets changed availability, and both were complete negative-EV Total No Plays previously removed solely by `mean_pmf_near_tossup_conflict`:

- UALB@BUF: Under 48.5, 50.4409536284%, FanDuel -110 observed `2026-09-02T11:16:04.636Z`, target-excluded fair probability 51.1583600786%, EV -3.7036339821%, `No Play`. Six complete two-sided named-book Totals were present. Playbook public consensus was Over 53% money / 43% tickets across eight books; strictly matched sharp splits were `event_not_published` and contributed nothing. The owner's earlier live BetMGM -118 observation is preserved by the focused exact-quote regression; the later frozen capture truthfully selected the then-current FanDuel -110 tuple.
- CMU@UNM: Under 46.5, 50.1164221481%, BetMGM -105 observed `2026-09-02T11:16:04.636Z`, target-excluded fair probability 50.2166002426%, EV -2.1536519967%, `No Play`. Six complete two-sided named-book Totals were present. Playbook public consensus was Over 51% money / 55% tickets across eleven books; strictly matched sharp splits were `event_not_published` and contributed nothing.

The comparison does not promote either Total or count availability as actionability. It preserves the decision engine's exact side, natural probability precision, evaluated quote, economics and grade. No other unavailable market is filled.

## Tests and rollback

Focused regression coverage preserves a UALB-like BetMGM 48.5 Under -118 tuple with its authoritative probability, negative EV and `No Play` grade while sharp splits are pending. Release-transition tests prove complete-r28 fallback before a complete r29 wave and byte-for-byte precedence for a valid r28 T-60 row. Full CFB, model-safety, type/lint/build and integration-safety results are recorded before handoff.

Pre-publication gates on the fresh `d4011de2da10fa2303c79bf2d1c1a9243cd40f1e` base:

- `npm run test:cfb-v1-production` — passed
- `npx tsc --noEmit` — passed
- scoped ESLint over all changed TypeScript files — passed
- `npm run verify:model-change` — passed
- `npm run build` with the default Next.js 16.2.6 Turbopack path — passed, including TypeScript and all 105 static pages
- `node scripts/verify-integration-safety.mjs --base-ref=origin/main` — passed from the final committed candidate against `d4011de2da10fa2303c79bf2d1c1a9243cd40f1e`

Rollback the writer/member/fixture/outcome publication identifiers to r49 if a natural cycle changes any forecast, projection, probability, side, grade, actionable count or stake; drops an exact quote; changes tracking behavior; violates atomic fallback or locked-row precedence; yields mixed current-slate publication releases; or causes reader/writer failure. Preserve all r29 and locked rows unchanged during rollback.
