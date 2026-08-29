# CFB market/sharp-aware authoritative provisional release r41

Date: 2026-08-29

Status: production candidate under the owner-approved PR #265 emergency exception; live proof pending protected merge and deployment

## Scope and authorization

This production cutover uses the exact PR #265 candidate release
`cfb_market_sharp_aware_shadow_2026_08_29_r3_borderline_spread` without changing its math or
grade thresholds. The governing exception landed on protected `main` in PR #266 at commit
`c78040e7fa3ad44133a56d40d58bd45f3574b37f`. It acknowledges that historical
source-specific CFB split validation is unavailable and authorizes this candidate only.

The sole existing CFB forward-evidence writer remains authoritative under
`prediction_pipeline:cfb`. This release adds no writer, cron, lease, provider request, stake,
reader-side prediction override, or historical rewrite.

## Authoritative release set

- Candidate / production: `cfb_market_sharp_aware_shadow_2026_08_29_r3_borderline_spread` / `cfb_market_sharp_aware_provisional_2026_08_29_r4_authoritative`
- Score runtime: `cfb_v1_joint_score_runtime_2026_08_29_r5_market_sharp_authoritative`
- Model / distribution / probability / representative score: `cfb_v1_market_sharp_score_model_2026_08_29_r3_provisional` / `cfb_v1_market_sharp_joint_distribution_2026_08_29_r3_provisional` / `cfb_v1_market_sharp_joint_probability_2026_08_29_r3_provisional` / `cfb_v1_market_sharp_reachable_score_2026_08_29_r3_provisional`
- Calibration / grade / decision / tuple: `cfb_v1_market_sharp_exact_price_calibration_2026_08_29_r2_provisional` / `cfb_v1_composite_grade_policy_2026_08_29_r2_market_sharp_balanced` / `cfb_v1_daily_edge_decision_2026_08_29_r16_market_sharp_authoritative` / `cfb_v1_exact_price_decision_tuple_2026_08_29_r10_market_sharp_authoritative`
- Evidence schema / collector / member / writer: `cfb_forward_evidence_snapshot_2026_08_29_r12_market_sharp_authoritative` / `cfb_forward_evidence_collector_2026_08_29_r19_market_sharp_authoritative` / `cfb_v1_member_release_2026_08_29_r21_market_sharp_authoritative` / `cfb_forward_evidence_writer_2026_08_29_r26_market_sharp_authoritative`
- Fixture / outcome / tracking / presentation: `cfb_v1_member_fixture_2026_08_29_r27_market_sharp_authoritative` / `cfb_market_sharp_public_outcome_contract_2026_08_29_r30_provisional` / `cfb_official_tracking_record_2026_08_29_r3_market_sharp_authoritative` / `daily_edge_member_presentation_2026_08_29_r18_cfb_market_sharp_authoritative`

## Coherent writer path

For every FBS-board game, the writer requires a canonical current market anchor before it can
append any r12 row. It builds a sharp-adjusted market PMF, mixes it with the independent PMF at
the frozen 25%/75% weights, and recomputes scores, winner probability, line probabilities,
predicted sides, calibrated probability, EV, and probability grade. The balanced
promotion/demotion overlay then owns the final play grade in that same decision tuple. Strict
Circa evidence requires league/team/date identity and exact Spread/Total line identity. Its
anchor influence remains capped at one margin point and one total point. Missing or mismatched
evidence is unavailable and contributes no fabricated adjustment.

The independent PMF is stored separately as immutable diagnostic provenance. The member reader
maps the writer's authoritative PMF directly; it cannot substitute a market-aware display value
over an independent stored decision. Cross-market coherence is checked before the writer's one
all-game append.

## Same-board impact

The zero-write replay read eight FBS games and 22 evaluated exact-price markets:

- preceding grades: 2 Best Angles / 2 Leans / 7 Watchlists / 11 No Plays;
- candidate probability grades: 0 / 4 / 7 / 11;
- final balanced grades: 0 / 5 / 12 / 5;
- promotions: 7, including six nonactionable Watchlists and one Watchlist-to-Lean;
- demotions: 2;
- net actionable change: +1;
- prediction-side changes: 0;
- strict Circa coverage: 8/22;
- same-book movement coverage: 5/22.

TCU -8.5 at DraftKings -105 follows the candidate's writer-owned bounded recalibration and is
a Lean at 54.398% probability, +4.994 percentage-point edge, and +6.205% EV. It is not a reader
override. The rule cannot create a Best Angle or a stake.

## Immutable transition, tracking, and rollback

The reader activates r12/r21/r16 only as a complete wave. During the one-way refresh, it may
carry an immediate r11/r20/r15 row only when that exact row is already T-60 immutable or the
game has started; a missing future unlocked game rejects the partial new wave. Carried rows keep
their original releases and values. Tracking filters to exact r12/r21/r16/r4 payloads, so an old
T-60 payload cannot be rewritten under the new tracking release.

The preceding coherent authority is r11/r20/r15 with writer r25, fixture r26, outcome r29,
presentation r17, grade policy r1, and tracking r2. Any mixed release, writer/reader mismatch,
missing required FBS price anchor, crash, lease overlap, stale snapshot resurfacing, or
unexpected actionable collapse aborts before append or requires rollback. Existing locked and
settled rows remain immutable and forward evaluation remains separated by release and lock time.

## Verification record

Before publication, the focused CFB suite passed, the 184-test Daily Edge experience suite
passed, TypeScript `--noEmit` passed, changed-file ESLint passed with zero errors, the complete
`npm run verify` / `verify:model-change` suite passed, and the Next.js production webpack build
passed. Repository-wide `npm run lint` was executed and remains red on 1,303 pre-existing errors
outside this change; no affected file has a lint error. Latest remote `main` remained
`c78040e7fa3ad44133a56d40d58bd45f3574b37f` immediately before publication; integration safety
is recorded from the clean commit. After protected merge, success additionally requires the production database
and member site to prove the new release set, coherent FBS board, TCU tuple, fresh reader, one
leased writer, release-separated tracking, and responsive pages. Until then this status remains
production candidate, not live success.
