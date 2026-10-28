# CFB Owls capture cutover — 2026-10-27

## Scope

Replace the sole production CFB writer's live SharpAPI dependency with Owls
without changing the separately governed CFB market reader. Preserve every
stored locked payload exactly.

## Production boundary

- The cron requires `OWLS_INSIGHT_API_KEY`; it no longer requires
  `SHARPAPI_KEY`.
- One Owls odds request and one Owls splits request cover the complete weekly
  provider slate. There is no per-game Owls request loop.
- Complete Circa/Pinnacle pairs are stored only in compact line-history
  evidence with `provider=owls`, `targetEligible=false`, and
  `marketReadingEligible=false`.
- Complete Circa, DraftKings, or BetMGM split pairs are retained in the existing
  immutable member-evidence slot with explicit `provider=owls` provenance.
- Before forecast, grade, complete-reader, coordinator, or historical-reader
  evaluation, all `provider=owls` split rows are removed from the decision
  input. Legacy SharpAPI rows retain their exact incumbent behavior until their
  existing freshness rules expire.
- BALLDONTLIE, Playbook, CFBD, The Odds API, and ESPN retain their prior price,
  public-consensus, and fallback responsibilities.

## Releases

- Writer: `cfb_forward_evidence_writer_2026_10_27_r141_owls_capture_only`
- Collector: `cfb_forward_evidence_collector_2026_10_27_r65_owls_capture_only`
- Compact capture: `cfb_daily_edge_forward_context_capture_2026_10_27_r4_owls_price_provenance`
- Compact schema: `cfbfec4`
- Model, distribution, probability, calibration, decision, grade, member,
  fixture, snapshot, tracking, and lock releases: unchanged.

## Live read-only coverage

Window: 2026-10-27 through 2026-11-03.

- Canonical BALLDONTLIE games: 115
- Owls odds events: 56
- Exact matched odds games: 56
- Games with Circa price pairs: 55
- Games with Pinnacle price pairs: 56
- Owls split events: 56
- Exact matched split games: 54
- Identity rejections: 0

The two unmatched split games reflect incomplete upstream split publication,
not an Oddsphere identity/abbreviation miss. Playbook remains the public
consensus fallback; missing Owls evidence is never relabeled or invented.

## Board impact and immutability

Owls rows are mechanically excluded from every production decision input in
this release. Best Angle, Lean, Watchlist, No Play, Held, promotion, demotion,
and actionable-count deltas are therefore zero by contract. The focused test
proves legacy Sharp rows remain eligible while Owls rows are excluded.

No stored evidence row, lock, projection, probability, pick, grade, price,
stake, or settlement is updated or reconstructed. New optional provider
provenance applies only to future unlocked captures.

## Rollback

Revert the writer/collector/capture release commit. Existing append-only rows
remain readable. Do not restore active SharpAPI calls without a valid
subscription and a separate owner-approved provider release.
