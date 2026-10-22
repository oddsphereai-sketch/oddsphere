# UCL r14 exact diacritic/club identity repair

## Scope

This is a future-unlocked UCL provider-identity and calibration-release repair.
It does not alter the r11 independent score model, coherent market-reader math,
probabilities, score projections, grading thresholds, stakes, writer, cadence,
shared soccer lease, settlement, or any stored locked payload.

## Root cause

Sharp's live event catalog contained both missing fixtures, but strict identity
matching rejected them. `Bodø/Glimt` normalized to `bodglimt` because Unicode
`ø` does not decompose to `o`; the registry contained only `bodoglimt` and
`bodoeglimt`. Sharp also supplied `FC Sabah Masazir`, while the exact registry
covered Sabah, Sabah FK, Sabah Masazir, and Sabah Baku FK but not that complete
club form. The repair adds only those exact normalized aliases and retains the
existing no-substring rule.

## Same-input evidence

- Provider catalog: 47 events.
- Scheduled UCL fixtures: 18.
- Complete fresh fixture matches: 16/18 before, 18/18 after.
- Selected current prices: 66/72 before, 72/72 after.
- Complete outcome prices: 166/180 before, 180/180 after.
- Held markets: six before, zero after.
- Current stored-board comparison: 30 No Plays / 29 Watchlists / 13 Leans
  before; 27 No Plays / 32 Watchlists / 13 Leans after.
- Actionable impact: zero promotions, zero demotions; all 13 actionables remain.
- Prediction impact: zero side changes. No locked rows exist on the slate.
- Coherence and economics: zero incoherent games and zero nonpositive-EV
  actionables.

## Releases and rollback

Future unlocked rows use
`ucl_grade_policy_2026_10_22_r14_exact_diacritic_club_identity` and
`ucl_sharp_market_identity_2026_10_22_r6_exact_diacritic_club_identity`.
Rollback restores r13/r5 for future unlocked rows only. Existing locked records
remain byte-for-byte authoritative and must never be rewritten or reconstructed.
