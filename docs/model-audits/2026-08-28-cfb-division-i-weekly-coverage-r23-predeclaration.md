# CFB Division I weekly coverage r23 predeclaration

Date: 2026-08-28

Status: frozen before implementation and current-board scoring

## Defect

The active CFB weekly window correctly spans Thursday through Monday, but its eligibility
filter requires at least one FBS team. That silently excludes every FCS-only matchup even when
both teams exist in the qualified 256-team weekly artifact and the paid market providers can
supply the event. On Friday, August 28, all seven scheduled games are FCS-only, so the member
board shows only Saturday's eight games.

## Permitted change

- Discover every provider-scheduled NCAAF game inside the existing Eastern Thursday-through-
  Monday window.
- Publish only matchups for which both provider team identities resolve unambiguously to the
  existing qualified weekly artifact. Unknown or ambiguous model identity is excluded rather
  than neutral-imputed into a public betting board.
- When a release first discovers a weekly matchup after kickoff, do not backfill a prediction;
  retain it only if immutable evidence already exists. Upcoming games remain eligible.
- Reuse the existing joint score model, r18 market-informed primary outcome, exact-price grade
  policy, provider clients, one leased writer, T-60 lock, tracking, settlement, member fixture,
  and shared MLB-style reader.
- Preserve every existing August 29 forecast, exact decision tuple, grade, movement trail, and
  split row byte-for-byte.

This change may not alter coefficients, residuals, calibration, thresholds, market selection,
stake, prediction/grade separation, provider request caps, or create another writer.

## Frozen gates

1. The existing eight-game/24-market replay has zero side, probability, quote, promotion, or
   demotion changes and passes the shared PMF/cross-market coherence assertion.
2. A pure-FCS matchup with two qualified artifact identities is eligible; an unknown-team
   matchup is excluded from publication; an out-of-window matchup remains excluded.
3. A game already started before first discovery is not backfilled, preventing a permanently
   incomplete opening-count loop. A previously captured game remains in immutable lifecycle
   handling.
4. Board additions are reported separately from promotions/demotions. New exact-price grades
   remain natural outputs of real provider tuples; no action quota is introduced.
5. Focused weekly-engine/writer/member tests, TypeScript, `npm run verify:model-change`, webpack
   build, diff check, latest-main integration safety, protected PR checks, natural-cycle evidence,
   and signed-in live QA must pass.

## Release boundary

- weekly eligibility: `cfb_weekly_window_2026_08_28_r2_model_covered_division_i`
- collector: `cfb_forward_evidence_collector_2026_08_28_r11_model_covered_division_i`
- member payload: `cfb_v1_member_release_2026_08_28_r11_model_covered_division_i`
- writer: `cfb_forward_evidence_writer_2026_08_28_r13_model_covered_division_i`
- member fixture: `cfb_v1_member_fixture_2026_08_28_r15_model_covered_division_i`

The qualified score, distribution, probability, r18 outcome, r11 exact-price decision, and grade
policy releases remain unchanged because per-game model and decision behavior are unchanged.
