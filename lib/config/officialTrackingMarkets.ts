/**
 * Official public tracking market registry — single source of truth.
 *
 * Per [[feedback-public-tracking-vs-internal-audit]], there are TWO
 * independent meanings of "tracked":
 *
 *   1. Public / official tracking — INTENTIONALLY SCOPE-LIMITED.
 *      Only markets we have historically + intentionally launched as
 *      official tracked categories. These create public tracking and
 *      grading history visible to members.
 *
 *   2. Internal audit / lock provenance — UNIVERSAL.
 *      Every displayed model output must be captured at lock for the
 *      auditor. This includes context-only markets that are shown but
 *      NOT publicly tracked (e.g., NBA spread, NHL puck-line).
 *
 * This module covers (1) only. The internal audit substrate
 * (`displayed_context_markets`) is a separate P1 follow-up.
 *
 * RULES:
 *   • Adding a market to OFFICIAL_TRACKING_MARKETS is a deliberate
 *     product launch decision. Engineering does NOT silently extend
 *     this registry — every addition requires product approval +
 *     sample-size baseline + calibration disclosure.
 *   • CONTEXT_ONLY_DISPLAY_MARKETS lists markets that ARE shown in the
 *     reader as model context but MUST NOT enter public tracking. The
 *     UI labels them clearly (e.g., "Sprd*", "PL*") with a footnote.
 *   • A market should appear in AT MOST ONE of the two registries per
 *     sport. The `assertOfficialTrackingMarket` helper enforces this
 *     when called.
 *
 * CALLERS:
 *   • `scripts/operator/audit-current-site-stability.ts` — uses
 *     `getOfficialTrackingMarkets` + `getContextOnlyDisplayMarkets`
 *     instead of hardcoding constants.
 *   • `app/lab/components/daily-edge/DailyEdgeShell.tsx` —
 *     `isContextOnlyMarket` UI helper delegates to
 *     `isContextOnlyDisplayMarket` for sport-aware classification.
 *   • Future: prediction record writers (P1-1 follow-up — see commit
 *     plan; writer integration is deferred to keep blast radius minimal
 *     when the current writers already produce only registry-compliant
 *     markets).
 *
 * NEVER:
 *   • Add NBA spread or NHL puck-line to OFFICIAL_TRACKING_MARKETS
 *     without explicit product approval.
 *   • Remove MLB first_inning, NBA total, or any other entry below
 *     without an intentional product decision.
 *   • Pollute prediction_records with markets that are not in
 *     OFFICIAL_TRACKING_MARKETS for the given sport.
 */

import type { Sport } from "../types/domain/Sport";
import type { TrackedMarketV17 } from "../types/domain/Tracking";

/**
 * Markets that are officially tracked publicly per sport. Generating a
 * `prediction_records` row + `prediction_grades` row for these markets
 * is the intended pipeline. They show up on the public tracking page.
 *
 * Empty arrays for sports that have NOT YET been launched as tracked
 * categories (CBB, UCL). Adding a market to an empty array
 * is a product launch decision.
 */
export const OFFICIAL_TRACKING_MARKETS: Readonly<
  Record<Sport, ReadonlyArray<TrackedMarketV17>>
> = {
  mlb: ["moneyline", "total", "first_inning"],
  nba: ["moneyline", "total"],
  nhl: ["moneyline", "total"],
  // NFL launches forward-only with the 2026 regular season. Preseason is
  // excluded independently by the football tracking lifecycle and the
  // future-dated public tracking boundary.
  nfl: ["moneyline", "total", "spread"],
  cbb: [],
  // CFB launches forward-only with its independent joint-score model and
  // exact-price decision tuples across all three standard football markets.
  cfb: ["moneyline", "total", "spread"],
  ucl: [],
  // 2026-06-11 — WC-1: soccer launches with 3-way result, total goals
  // (canonical 2.5), BTTS, and double_chance. "moneyline" deliberately
  // absent — soccer is 3-way and using "moneyline" here would erase the
  // draw outcome. Double Chance is included as an official tracked
  // launch market because the tracking page already carries a
  // "Double Chance" column (also used by UCL).
  soccer: ["match_result", "total", "btts", "double_chance"],
  // WNBA tracks ALL THREE markets publicly from launch (Daniel 2026-06-23):
  // ML + total + spread, 0-0 forward-only, no backfill. NOT context-only — if
  // spread is shown as an official WNBA market it is tracked publicly. Inert
  // until the Phase 2 writer/cron runs.
  wnba: ["moneyline", "total", "spread"],
} as const;

/**
 * Markets that ARE rendered in the reader as model context but are NOT
 * officially tracked. The UI labels them explicitly (e.g., "Sprd*",
 * "PL*") with a footnote: "* Model context · Not part of official
 * tracking". These markets MUST NOT generate `prediction_records`
 * rows for grading until they are intentionally launched as tracked
 * categories.
 *
 * Each entry is a string rather than `TrackedMarketV17` because some
 * context-only markets (e.g., NBA spread, NHL puck-line — both stored
 * via the `first_inning` DTO slot) intentionally do not align 1:1 with
 * the public tracking enum. See `DailyEdgeShell.tsx` for the UI label
 * mapping.
 */
export const CONTEXT_ONLY_DISPLAY_MARKETS: Readonly<
  Record<Sport, ReadonlyArray<string>>
> = {
  mlb: [],
  nba: ["spread"],
  nhl: ["spread"], // NHL puck-line is stored under market_type="spread" in lines
  nfl: [],
  cbb: [],
  cfb: [],
  ucl: [],
  soccer: [], // no context-only markets at WC launch
  wnba: [], // WNBA spread is publicly tracked (not context-only) — see OFFICIAL_TRACKING_MARKETS
} as const;

/** Returns true if the given (sport, market) tuple is officially tracked publicly. */
export function isOfficiallyTrackedMarket(
  sport: Sport,
  market: string,
): boolean {
  const allowed = OFFICIAL_TRACKING_MARKETS[sport];
  if (allowed === undefined) return false;
  return (allowed as ReadonlyArray<string>).includes(market);
}

/** Returns true if the given (sport, market) tuple is a displayed-but-not-tracked context-only market. */
export function isContextOnlyDisplayMarket(
  sport: Sport,
  market: string,
): boolean {
  const allowed = CONTEXT_ONLY_DISPLAY_MARKETS[sport];
  if (allowed === undefined) return false;
  return allowed.includes(market);
}

/** Per-sport accessor for the officially tracked market list. */
export function getOfficialTrackingMarkets(
  sport: Sport,
): ReadonlyArray<TrackedMarketV17> {
  return OFFICIAL_TRACKING_MARKETS[sport] ?? [];
}

/** Per-sport accessor for the context-only displayed market list. */
export function getContextOnlyDisplayMarkets(
  sport: Sport,
): ReadonlyArray<string> {
  return CONTEXT_ONLY_DISPLAY_MARKETS[sport] ?? [];
}

/**
 * Throws if the given (sport, market) is NOT in the official tracking
 * registry. Use this as a guard at any code path that creates a row
 * destined for public tracking (e.g., `prediction_records` writers).
 *
 * Failure semantics: explicit error with the sport + market + advisory
 * to either add the market to the registry intentionally (product
 * decision) or route it to the context-only display path.
 */
export function assertOfficialTrackingMarket(
  sport: Sport,
  market: string,
): void {
  if (isOfficiallyTrackedMarket(sport, market)) return;
  const allowed = getOfficialTrackingMarkets(sport);
  const isContext = isContextOnlyDisplayMarket(sport, market);
  throw new Error(
    `assertOfficialTrackingMarket: refusing to treat (sport=${sport}, market=${market}) ` +
      `as officially tracked. ` +
      `Allowed for this sport: [${allowed.join(", ") || "<none>"}]. ` +
      (isContext
        ? `This market is registered as CONTEXT-ONLY for ${sport} — it should be rendered as model context (label "*") and captured in displayed_context_markets, NOT in prediction_records.`
        : `This market is not registered for ${sport}. Either add it to the official tracking registry as a deliberate product launch (with baseline + calibration disclosure) OR add it to the context-only display registry if it should be shown as model context.`),
  );
}
