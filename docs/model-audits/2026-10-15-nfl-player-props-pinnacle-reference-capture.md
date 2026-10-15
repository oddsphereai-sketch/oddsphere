# NFL player props Pinnacle reference capture — October 15, 2026

## Scope and predeclaration

This release may change only NFL player-prop provider observation and additive
internal market-observer coverage. It must not change a production projection,
probability, prediction side, grade, stake, member row, lock, official tracking
record, copy, label, or layout. Existing locked records retain exact precedence.

The hypothesis is source-specific, not a blind-book rule: FanDuel may be a
useful de-vig reference, while genuinely independent sharper sources may
confirm, weaken, or oppose that read. No source receives forecast authority
until release-pure settled evidence shows more corrections than harms without
flattening the board.

## Defect

The authoritative collector requested one unfiltered SharpAPI NFL `props`
catalog and stopped at its bounded eight-page / 1,600-row ceiling. The catalog
was still incomplete. A read-only Week 6 inventory retained broad FanDuel
coverage through BALLDONTLIE but only 13 Circa identities and zero Pinnacle,
NoVig, Bet365, ProfitX, or Polymarket identities. Provider metadata and bounded
named-book probes established:

- Pinnacle is active, marked sharp, and supports player props on the account.
- The current Pinnacle main-line catalog completes in four 200-row pages (696
  raw rows before exact slate reconciliation).
- NoVig supports props but requires six pages for the current slate.
- Bet365 is present in provider metadata but the account returns HTTP 403.
- Polymarket is not a player-prop source in this provider contract; ProfitX and
  Bookmaker are not exposed as usable prop sources.

The absence of Pinnacle was therefore pagination crowd-out, not a deliberate
modeling decision or genuine provider absence.

## Settled diagnostic

The immutable Week 5 private archive contains only the two games captured after
the full-board archive launched, so it cannot validate a new hierarchy. In that
limited sample, FanDuel was 12-8 at provider opening but 6-9 at T-60. Where the
independent side and FanDuel disagreed at T-60, changing to FanDuel produced two
corrections and two harms. FanDuel alone is not promoted to source of truth.
There were no Pinnacle observations in the historical capture, which is the
coverage defect this release repairs prospectively.

## Released behavior

- Provider observation release:
  `nfl_player_props_provider_observation_2026_10_15_r12_pinnacle_reference_capture`.
- Sole writer:
  `nfl_player_props_writer_2026_10_15_r50_pinnacle_reference_capture`.
- The existing generic feed remains the only input to the production forecast
  board. A separate Pinnacle-only, `is_main_line=true`, four-page lane is used
  only to enrich the internal market-observer evidence.
- The lane runs once per UTC hour and once in the final pre-lock comparison
  window. Ordinary 15-minute writer wakes do not multiply the extra calls.
- The lane is failure-isolated after the generic collection: rate limits,
  authorization failures, malformed responses, or incompleteness add health
  telemetry but cannot erase or interrupt the authoritative board.
- Collection remains in the sole NFL props writer under the shared
  `prediction_pipeline:nfl` lease. Maximum collection / incremental calls are
  explicitly bounded at 57 / 107, up from 53 / 103.
- No public copy or labels are added.

## Current-slate rehearsal

The no-write Week 6 rehearsal collected 390 reconciled Pinnacle reference
observations and built 16,536 research offers while leaving the 16,341-offer
production input separate. The bounded compact evidence retained Pinnacle on
102 exact market identities, alongside the already available books. The cycle
used 45 total calls, below the 107-call ceiling. Reference collection did not
enter the production `offers` array and therefore cannot change forecasts or
grades in this release.

The next settled release-pure audit will evaluate FanDuel direction and price,
Pinnacle/Circa confirmation or opposition, same-book movement, cross-book
dispersion, and the independent projection together. Promotions and demotions
must be paired, and any authority change requires a new model/calibration/
decision release.

## Verification and rollback

Focused collector, runtime, production lifecycle/lock, market-evidence, and
market-observer tests must pass with the repository-wide model-change suite and
integration-safety check. Rollback is provider observation r11 / writer r49;
already captured internal research and every locked/member/tracking record are
preserved unchanged.
