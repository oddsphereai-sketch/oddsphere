# OddSphere Market Intelligence v2 - Phase 0 Audit

Date: 2026-06-25
Status: read-only audit; no production behavior changed

## Executive Summary

Market Intelligence v2 should not be implemented as a provider fallback or a
raw split swap. The current codebase already has careful provider-boundary
comments, but the production data path still mixes concepts through shared
structures:

- `sharp_signals` is the main production lane for public betting fields,
  Pinnacle/+EV fields, steam/RLM placeholders, and market-signal derivation.
- Playbook public splits can be mapped into the `SharpSignalRecord` shape,
  which is convenient but semantically risky.
- SharpAPI `/splits` public fields currently influence production market
  signal and grade paths through `public_smoke` and sharp-divergence logic.
- A provider-separated `public_splits_observations` table exists, but it is a
  current-row upsert table, not immutable raw observation history.
- Daily Edge display can overlay Playbook-preferred public splits behind a
  flag without changing grades, but this overlay currently touches only
  displayed `publicSplits`.

Conclusion: v2 must start with a new canonical market-intelligence layer in
shadow mode and must not silently replace `sharp_signals` as a production input.

## Provider Role Check

Verified against official docs:

- Playbook `/v1/splits` returns current public consensus/betting splits for
  spread, moneyline, and total, including `booksUsed`.
- Playbook `/v1/lines` returns current game lines by league. It is not
  per-book price movement and should not replace SharpAPI line tracking.
- SharpAPI `/splits` is source-specific split data. The docs also note BetMGM
  `public_bet_pct` in `/odds` as ticket percentage only.
- SharpAPI `timestamp` on odds rows is a feed-refresh/freshness timestamp, not
  a price-last-moved timestamp. Price changes must be computed from distinct
  stored price observations.
- SharpAPI closing line endpoint is the canonical source for post-lock CLV
  when available; do not use it in pregame model features.

## Current Provider/Field Ownership

### Playbook

Files:

- `lib/providers/playbook/playbookClient.ts`
- `lib/providers/playbook/types.ts`
- `lib/providers/playbook/playbookPublicSplitsMapper.ts`
- `lib/providers/playbook/playbookPublicSplitsOverlay.ts`
- `lib/services/syncPublicSplitsObservations.ts`
- `lib/services/publicSplitsDisplayOverlay.ts`
- `app/api/cron/public-splits-observations-refresh/route.ts`

Current behavior:

- Playbook splits are parsed as public bet and money percentages.
- `booksUsed` is captured in `public_splits_observations`.
- `mapPlaybookSplitsToSharpSignalRecords` converts Playbook rows into
  `SharpSignalRecord` public-only records with EV, fair probability, steam, and
  RLM forced null/false.
- `overlayPlaybookPublicSplits` can overlay only `public_betting_pct`,
  `public_money_pct`, and `computed_at` onto a base sharp-signal record.
- Display overlay prefers Playbook when fresh and complete, then SharpAPI, then
  stale-but-valid.

Risk:

- Reusing `SharpSignalRecord` for Playbook keeps old consumers working, but it
  makes it too easy for a Playbook public split to be treated like a sharp
  signal by downstream code.

### SharpAPI Splits

Files:

- `lib/providers/real_api/SharpAPISignalProvider.ts`
- `lib/services/marketSignalDerivationService.ts`
- `lib/services/signalEvidenceClassifier.ts`
- `lib/services/gradeDerivationService.ts`

Current behavior:

- `SharpAPISignalProvider` fetches `/opportunities/ev`,
  `/opportunities/low_hold`, `/opportunities/arbitrage`, and `/splits`.
- SharpAPI `/splits` values are converted from 0-1 fractions to 0-100
  percentages and written into `public_betting_pct` / `public_money_pct`.
- The provider explicitly sets steam and RLM false/null because current tier
  does not expose those labels.
- Splits-only rows can be emitted when public split data exists without an
  opportunity row.

Production influence:

- `deriveMarketSignal` reads raw `public_betting_pct` and `public_money_pct`.
- Public smoke can become `market_signal = public_smoke`.
- `classifyEvidence` computes sharp-divergence tiers from raw
  `abs(public_money_pct - public_betting_pct)`.
- `gradeDerivationService` can convert these market signals/evidence into
  per-market grades and signal types.

Risk:

- Raw provider percentages currently influence play grade and recommendation
  display. A provider swap can change grades without changing model
  probabilities.

### SharpAPI Odds / Price Movement

Files:

- `lib/providers/real_api/SharpAPIOddsProvider.ts`
- `lib/services/linesService.ts`
- `lib/services/lineHistoryWriter.ts`
- `lib/services/streamOverlay.ts`
- `lib/streaming/marketInterpretation.ts`
- `app/api/lab/daily-edge/route.ts`

Current behavior:

- Game lines are written to `lines`.
- History is append-only in `line_history`.
- V2 odds refresh uses SharpAPI opportunities and splits fallback for event
  discovery/enrichment.
- `splits_consensus` synthetic line rows may be created as fallback line
  context, but the UI labels them as `splits_consensus`.
- Daily Edge computes line open/current display from stored lines/history and
  stream overlay when available.

Risk:

- `splits_consensus` is a useful fallback, but it must never be treated as a
  real sportsbook or as a sharp-book movement source.
- SharpAPI feed timestamps should remain freshness-only; line movement must be
  computed from stored distinct prices.

## Tables and Persistence

Existing relevant tables:

- `lines`: current per-book/synthetic line rows.
- `line_history`: append-only price observations.
- `sharp_signals`: current production market signal input lane.
- `sharp_signals_history`: last-known-good fallback for split display.
- `odds_current_stream`, `odds_events_raw`, `line_movements`: streaming overlay
  and movement tables.
- `public_splits_observations`: provider-separated current-row split table.
- `game_predictions`: live prediction and grade columns.
- `prediction_records`: locked tracking snapshots.

Gap versus v2 requirements:

- No immutable canonical split observation history with raw payload hash.
- No canonical price observation table with normalized selection keys and
  explicit sharp-book flag.
- No provider-specific normalization distribution table/service.
- No unified v2 market-read resolver schema.
- No shadow-only model feature store for normalized split/price features.
- No admin provider-audit view for coverage, drift, correlations, or lift.

## Current Display Fields

Daily Edge route:

- `moneyPct` / `betsPct`: picked-side scalars from `sharp_signals`.
- `publicSplits`: two-sided rows from `sharp_signals`, optionally overlaid by
  `publicSplitsDisplayOverlay`.
- `marketInterpretation`: compact market chip generated from current line
  movement and picked-side split scalars.
- `lineOpenAmerican` / `priceAmerican`: line movement display, sourced from
  `lines`, `line_history`, and stream overlay.
- `marketImpliedPct`: computed from two-sided odds where available, with
  `splits_consensus` last-priority fallback.

Potential mismatch:

- Display overlay can change `publicSplits` without changing the picked-side
  scalar fields or `marketInterpretation`.

## Missing Data and Neutral Defaults

Observed safe patterns:

- Most split fields preserve `null` when missing.
- First-inning split data stays null because split providers do not cover it.
- UI types document that null means unavailable.
- Daily Edge route comments explicitly avoid a 0.5 placeholder for edge.

Observed risky patterns:

- Some tests use 0.5 fixtures for provider payloads. That is fine for tests,
  but production adapters should explicitly reject malformed values and must
  not fabricate 0.50 for missing data.
- Current `public_splits_observations` stores 0-100 percentage values and does
  not validate opposing sides summing approximately to 100.
- No raw payload hash dedupe exists for split observations.

## Averaging / Blending Audit

No direct production path found that averages Playbook and SharpAPI raw split
percentages together.

However:

- The current `publicSplitsDisplayOverlay` chooses Playbook or SharpAPI for
  display by provider priority/freshness, which is safe and non-blended.
- `overlayPlaybookPublicSplits` can replace fields in a `SharpSignalRecord`.
  This is not averaging, but it is still a provider swap inside a shared shape
  and must stay gated/audited.

## Snapshot Cadence and History

Current cadence:

- `slate-cycle` and line refresh write `lines`, `line_history`, and
  `sharp_signals` on scheduled runs.
- `pregame-sweep` lock-only now runs every 15 minutes in the lock window.
- `public-splits-observations-refresh` is gated by
  `PUBLIC_SPLITS_OBSERVATIONS_ENABLED=true`; comments say 15-minute cadence,
  MLB only for now.

History:

- `line_history` is append-only and can support movement computation.
- `public_splits_observations` is current-row only and cannot support rolling
  empirical normalization by itself.
- Existing Playbook impact audit docs/scripts provide a starting point for
  historical A/B but not a full walk-forward provider evaluation framework.

## Production Risk Map

High risk:

- Replacing raw `public_betting_pct` / `public_money_pct` in `sharp_signals`
  can change `market_signal`, `grade`, play grade, and recommendation display.
- Calling money minus bets "sharp money" is embedded in existing naming and
  comments. v2 should rename this internally to source-specific money/ticket
  divergence unless backed by normalized empirical evidence.

Medium risk:

- Display overlay can create field-level inconsistencies if only `publicSplits`
  changes and other fields continue using old scalar splits.
- Current-row upsert observations lose history needed for normalization.

Low risk:

- Adding a new immutable observation table and shadow resolver behind
  `MARKET_INTELLIGENCE_V2_ENABLED=false` by default.
- Adding pure parsers/tests for provider payload validation.
- Adding admin/debug views that read only v2 shadow tables.

## Recommended Implementation Order

1. Add feature flags only:
   - `MARKET_INTELLIGENCE_V2_ENABLED=false`
   - `MARKET_INTELLIGENCE_V2_UI_ENABLED=false`
   - `MARKET_SPLITS_MODEL_MODE=shadow`
   - a kill switch for existing raw public-split grade influence.

2. Add canonical immutable observation tables:
   - `market_split_observations_v2`
   - `market_price_observations_v2`
   - optional `market_intelligence_snapshots_v2`
   - keep existing tables untouched.

3. Build provider-specific canonical adapters:
   - Playbook splits -> provider `playbook`, source_book `consensus`,
     source_type `multi_book_consensus`.
   - SharpAPI splits -> provider `sharpapi`, source_book `draftkings` /
     `circa`, source_type `retail_book` / `sharp_adjacent_book`.
   - SharpAPI BetMGM `public_bet_pct` -> ticket-only source with
     `money_pct=null`.
   - SharpAPI odds -> price observations; timestamps marked as feed freshness.

4. Add normalization service:
   - rolling distributions by provider/source/league/market/time bucket.
   - hierarchical fallback with sample size and fallback level recorded.

5. Add price-action service:
   - compute open/current/T-24/T-6/T-1/T-15/close from stored distinct prices.
   - use sharp-book median no-vig where available.
   - compute movement percentiles by league/market/time bucket.

6. Add unified resolver:
   - output -5..+5 market read and member-facing label.
   - do not feed output into outcome model.
   - generate one explanation without provider-disagreement language.

7. Add UI behind `MARKET_INTELLIGENCE_V2_UI_ENABLED`:
   - display Playbook-only consensus percentages as "Consensus Bets/Money".
   - display SharpAPI-derived line movement.
   - display unified OddSphere Market Read.
   - no raw DK/Circa percentages in normal member UI.

8. Add shadow evaluation command:
   - walk-forward, not random cross-validation.
   - compare baseline vs normalized Playbook vs normalized SharpAPI vs both.
   - block bootstrap by event/date.

9. Only after audit:
   - consider limited/production model mode.
   - never silently change production picks.

## Immediate No-Go Items

- Do not write Playbook splits into `sharp_signals` as the production split
  source without a before/after grade audit.
- Do not use `booksUsed` as a multiplier.
- Do not infer line movement from Playbook `/lines` versus SharpAPI per-book
  prices.
- Do not infer price movement from SharpAPI feed timestamp changes.
- Do not expose DK/Circa raw percentages as "consensus".
- Do not implement learned provider weights until there is sufficient
  out-of-sample calibration and CLV evidence.

## Useful Existing Assets

- `docs/ODDSPHERE_MLB_PLAYBOOK_SPLITS_PROMOTION_AUDIT_2026_06_24.md`
- `docs/ODDSPHERE_MODEL_SIGNAL_BOUNDARIES_2026_06_24.md`
- `docs/ODDSPHERE_CANONICAL_LINE_SOURCE_POLICY.md`
- `scripts/operator/playbook-model-impact-audit.ts`
- `scripts/operator/playbook-mlb-splits-promotion-audit.ts`
- `scripts/operator/dual-splits-observation-sync.ts`
- `scripts/operator/dual-splits-observation-verify.ts`
- `lib/services/publicSplitsDisplayOverlay.ts`
- `lib/services/syncPublicSplitsObservations.ts`

## External References

- Playbook Splits: https://docs.playbook-api.com/splits-26181491e0
- Playbook Lines: https://docs.playbook-api.com/lines-26181600e0
- SharpAPI Splits: https://docs.sharpapi.io/en/api-reference/splits/
- SharpAPI Odds Delta: https://docs.sharpapi.io/en/api-reference/odds-delta/
- SharpAPI Closing Line: https://docs.sharpapi.io/en/api-reference/odds-closing/
- SharpAPI Timestamp Semantics:
  https://docs.sharpapi.io/en/concepts/pinnacle-odds-changed-at/
