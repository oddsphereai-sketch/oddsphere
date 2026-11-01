# NFL explicit market episode resolution

Starting production base: `9241e0a6020bc8af93caa89b0fbab8e700ebe7ea`.

Owner requested repair of the spot-check findings and forward evaluation of accuracy.
Scope is NFL Moneyline, Spread, Total, the existing full-game arbiter, sole forward
writer and member snapshot reader. No new writer, provider loop, cadence, stake,
member copy or layout. The existing `prediction_pipeline:nfl` lease is unchanged.
Locked records retain exact stored precedence.

The preceding private candidate was writer r97 / model r41 / calibration r40 /
decision and grade r49 / member r46 / fixture r61 / snapshot r53. The production
predecessor remains r43 decision / r40 member / r55 fixture / r47 snapshot.

This repair exposes an unconfirmed named episode separately from confirmed market
direction. Only the full-game arbiter may corroborate a stable lone named episode
using a matching current target-excluded paired-price implication, backed by at
least two distinct fresh families. The ordinary confirmed-direction contract in
other NFL layers is preserved. Buyback, reversing and number/juice-conflicting
episodes cannot acquire authority through this path.

Opposing qualified flow is explicitly resolved against the current paired-price
implication before a side correction. A reverse-flow observation may favor the
price path; it is not an automatic veto or proof of bookmaker intent. Without
corroborating price direction the forecast is retained. Each market records the
actual value held or changed, price implication, named direction, split-source
agreement, supporting/opposing/context signal IDs and resolution reason. A Total
that did not change cannot report an applied scoring-environment change merely
because the side changed. These fields are internal evidence, not member copy.

The existing production snapshot predecessor key now includes its actual decision
release. The regression proves the stored payload is returned unchanged.

New candidate family: writer r98, model r42, calibration r41, decision/grade r50,
member r47, fixture r62, snapshot r54; market state r5, ledger r8, arbiter r24,
runtime r8 (`2026_11_01_*_explicit_episode_resolution`). Other model equations and
grade thresholds are unchanged. Existing symmetric grade eligibility remains;
there is no new conflict-driven demotion or quota-driven promotion.

Verification records are appended after execution. Current-input functional
rehearsals measure coverage and decision consequences, not historical accuracy.
Publication requires complete checks, same-input board impact, fresh-main
integration safety and protected PR publication. Roll back only unlocked future
outputs to the preceding complete production family; never rewrite locks.

## Executed verification

- `npm run test:nfl-v1-production`: passed, including writer and immutable lock tests.
- `npm run verify:model-change`: passed, including post-verification. Optional
  PostgreSQL proof skipped because `MARKET_BRAIN_POSTGRES_URL` is unset.
- `npx tsc --noEmit --pretty false`: passed.
- Independent AI review caught and corrected family-count self-confirmation,
  missing-price flow labeling, cross-market reason attribution, and Total
  story/reason consistency. Final review found no critical issue.
- Current-input r98 rehearsal: 13 games / 39 evaluations; zero database writes,
  13/13 complete named paired-price histories, zero rejected price pairs.
  Public Playbook observations use stored timestamped fallback in this local
  workspace. Owl's partial/mismatched contract qualifications remain explicit;
  unqualified splits cannot direct predictions.
- Same-run upstream to final reader: 9 Best Angles / 1 Lean / 11 Watchlists /
  18 No Plays becomes 5 / 2 / 8 / 24. Zero actionable promotions, three
  demotions, four market side changes; actionables 10 to 7. This comparison
  measures the final stage, not a full current-production-versus-candidate
  comparison. It does not establish accuracy or create replacement promotions.
- PHI@WSH resolves to 18.04–24.34: opposing moneyline flow is explicitly
  resolved toward the corroborated price path, Total held with a price/path
  disagreement reason. LV@NYJ resolves to 22.96–24.49: conflicting flow
  sources are recorded, NYJ ML Lean, LV Spread No Play. BAL@BUF retains
  23.22–32.14: current paired prices do not corroborate opposing spread
  movement. These are source-clock-specific functional checks.

Release qualification remains separate from the passing implementation checks:
the current board has three actionable demotions and no replacements. The broader
candidate must not be declared fully production-qualified from this rehearsal.
