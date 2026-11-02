# CBB verified St. Thomas historical venue input repair

Base: `5a4148c94bbec7db367476dc372efa7a283c1e52`.

## Scope and frozen rules

Correct only 123 previously unknown historical venue flags for provider school
332 (ESPN2900). Rebuild the existing sequential2022–25 fitter with the exact
same ridge/pace/carry/recency settings, uncertainty and score-correction
coefficients. No market-score blend, grade threshold, price hierarchy,
provider request, cadence, stake or lease is added or changed. This is a
factual input repair, not an outcome-selected new scoring formula.

The original22777-game normalized dataset has been recovered byte-for-byte:
`d2bde4460339e83a21e04864bc8168ec2236f25c21663288f8b2124ce4064e48`.
It reconstructs the frozen366-team prior exactly. All1070 cached historical
r2 forecasts also reproduce exactly, with zero numerical difference. Preserve
the original artifact and historical research runtime unchanged in meaning.

The123 venue corrections have unique original game/date/home/away/final-score
matches to explicit official ESPN neutral-site flags. Source bodies and hashes
are retained with the patch. The corrected input hash is
`1b097a4cde620c583291ce56cd335be9fea968d908a8a565bda63cfa71ca4bbf`;
the corrected367-team prior hash is
`553acdc90ea2d03228420e2579fcfb438c9589d96ae48e317be076bf0d75476f`.
Other schools' ratings change through the released opponent-adjusted fitter;
they are not manually frozen or copied. The original null factor-summary
transport fields are preserved because the next-season fitter resets them.

## Release and authority

- Score: `cbb_candidate_2026_11_02_r3_verified_stthomas_venue_prior`.
- Board: `cbb_candidate_2026_11_02_r6_verified_venue_prior`.
- Sole publisher: `cbb_member_pipeline_2026_11_02_r11_verified_venue_prior`.
- Tracking: `cbb_tracking_writer_2026_11_02_r4_locked_model_release`.
- Grade policy remains r2, stored DTO schema r2 and reader evidence r5.

One shared mathematical engine reproduces frozen r2 and corrected r3 artifacts.
Only currentScoreRuntime is imported by the production pipeline. The legacy
research path remains release-bound to r2. New boards stamp their score release;
tracking resolves the frozen board's actual model and grade releases. Known
unstamped legacy boards retain r2; unknown lineage fails closed. Existing
locked snapshots return before any candidate/evidence migration. No existing
lock, original App record, or historical tracking row is corrected or relabeled.

## Historical diagnostic and limits

Fixed inputs/cutoffs/target quotes on1070 already-opened historical games:
ML713→711 (0 corrections/2 harms), Spread566→570 (7/3, one changed push),
Total544→551 (7/0). Margin MAE9.102138→9.097957 and Total
MAE13.438166→13.430043 improve slightly. Overall winner Brier/log loss improve
slightly; later229 winner calibration worsens slightly (Brier
.000025/log loss+.000192) while winner/Total counts stay equal and Spread
improves130→131. This is not a universal accuracy, pristine holdout or ROI claim.
There is no outcome-based tuning or selectively retained opponent rating.

## Same-input current-board impact

The18:42:41Z no-write replay uses four genuine current-season training games,
identical real quotes for both artifacts, seven bounded BDL reads and one
Owls read.113 comparable future games/339 markets retain exact grade counts:
Best72, Lean44, Watch115, No Play108. Actionable promotions/demotions are0/0;
no existing eligible game is lost. Maximum team-score change is0.9553points.
St. Thomas–Presbyterian10882515 becomes one additional complete game with
three real priced markets; previous immutable locks are excluded from changes.
This is a captured-source replay, not a promise of unchanged later live prices.

## Reproduce and verify

```sh
node --import tsx scripts/fixtures/cbb-stthomas-prior-recovery-20261102/rebuild-and-verify.mjs "$PWD"
node --env-file=.env.local --import tsx scripts/test-cbb-verified-venue-prior.ts
node --env-file=.env.local --import tsx scripts/test-cbb-tracking-writer.ts
```

Run full model verification, focused CBB tests, build, TypeScript/lint and clean
latest-main integration before protected PR publication. Before deployment,
save all stored locked member payloads and tracking tuples; after deployment,
prove their exact equality, current r3/r11 lineage, the117-game/351-price
expected board when source coverage is unchanged, the restored game's reader,
normal cron/lease behavior and provider-call ceiling. Retain all provider
timestamps and history. Roll back future unlocked publication to r2 on a lost
eligible game, changed old lock, incoherent release/score or writer/load failure;
never rewrite a newly stored r3 locked record to an older model.
