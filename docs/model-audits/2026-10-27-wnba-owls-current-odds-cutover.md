# WNBA Owls current-odds cutover and all-sport capture

Date: 2026-10-27  
Owner direction: retire the cancelled SharpAPI dependency and continue the
Owls integration without changing existing locks or granting the separate
Market Reader project new authority.

## Scope

- Replace the active WNBA current-line request with one Owls `/api/v1/wnba/odds`
  request.
- Accept only complete coherent Circa/Pinnacle Moneyline, Spread, and Total
  pairs with provider timestamps.
- Keep Playbook as public consensus and the market-level fallback.
- Schedule the existing observation-only Owls split/price collector for MLB,
  WNBA, NBA, NHL, NFL, CFB, and CBB. NBA and weekly football use one bounded
  seven-day canonical-game window.
- Preserve every stored locked prediction, projection, probability, grade,
  price, stake, split, and evidence field unchanged.

## Release boundary

- WNBA model: `wnba_v1_8_owls_current_odds`
- WNBA reader: `wnba_daily_edge_reader_2026_10_27_r3_owls_current_odds`
- WNBA schedule: `wnba_daily_refresh_schedule_2026_10_27_r2_owls_current_odds`
- Capture: `market_intelligence_v2_shadow_capture_2026_10_27_r9_all_sport_owls_schedule`

The WNBA release bump prevents future Owls-input records from being blended
with the prior SharpAPI-input generation. Calibration, distribution, grade
policy, decision tuple, tracking contract, one writer, cadence, and
`prediction_pipeline:wnba` lease are unchanged.

## Live evidence and impact

The owner-provided Owls trial returned current complete Circa split pairs for
MLB, NBA, WNBA, NFL, NCAAF, and NHL. A read-only canonical-slate rehearsal also
returned matched Owls prices for the active MLB, NBA, NHL, and CFB records. The
2026-10-27 WNBA production slate contains zero scheduled games, so the current
same-input impact is:

- side changes: 0
- promotions: 0
- demotions: 0
- actionable-count change: 0
- locked-row changes: 0

The adapter fixture proves that a coherent Circa WNBA event yields exactly six
current sides, preserves the provider tip and price, and resolves the exact
canonical team pair. Incomplete or incoherent pairs fail closed inside the
shared Owls normalizer.

## Rollback

Roll back the four release identifiers together if Owls crosses game identity,
admits an incomplete pair, regresses coverage, changes a locked record, or
causes an unreviewed actionable board change. Do not restore live SharpAPI
requests; fall back to Playbook and the existing stored last-known-good board
while the provider issue is investigated.
