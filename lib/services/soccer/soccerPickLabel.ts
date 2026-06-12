/**
 * Soccer (FIFA WC / UCL) customer-facing pick-label transform.
 *
 * The soccer model writes raw lowercase pick values (`home`, `away`,
 * `draw`, `yes`, `no`, `over`, `under`, plus DC composites like
 * `home_or_draw`). The card chip, reader segment, decision line, why
 * line, sharp read, and model breakdown all need a human-friendly
 * rendering of those values. Centralising the transform here avoids
 * drift between the snapshot text composers (lib side) and the card
 * UI helpers (app side).
 *
 * Pure. No I/O. No side effects.
 */

export type SoccerMarket = "match_result" | "double_chance" | "total" | "btts" | "moneyline" | "first_inning";

/**
 * Format a raw soccer pick value as a customer-facing label.
 *
 * Returns null when the transform shouldn't override the input (caller
 * keeps original). Returns a string for known soccer pick patterns.
 *
 * - match_result / moneyline:
 *     home → homeAbbr ?? "Home"
 *     away → awayAbbr ?? "Away"
 *     draw → "Draw"
 * - btts / first_inning (BTTS lives on the FI slot in the soccer DTO):
 *     yes → "Yes"
 *     no  → "No"
 * - total:
 *     over  → "Over <line>" (when line present), else "Over"
 *     under → "Under <line>" (when line present), else "Under"
 * - double_chance composites:
 *     home_or_draw → "<homeAbbr> or Draw"
 *     away_or_draw → "<awayAbbr> or Draw"
 *     home_or_away → "<awayAbbr> or <homeAbbr>"  (idiomatic "away or home")
 *
 * Composites preserve the operand abbreviation when available; otherwise
 * fall back to "Home"/"Away".
 */
export function soccerPickLabel(
  market: string,
  pick: string | null,
  line: number | null,
  awayAbbr: string | null = null,
  homeAbbr: string | null = null,
): string | null {
  if (pick === null) return null;
  const lower = pick.toLowerCase();

  // Match Result / moneyline single-side
  if (market === "match_result" || market === "moneyline") {
    if (lower === "home") return homeAbbr ?? "Home";
    if (lower === "away") return awayAbbr ?? "Away";
    if (lower === "draw") return "Draw";
  }

  // BTTS — the soccer adapter maps onto the first_inning DTO slot for
  // the existing 3-market shell.
  if (market === "btts" || market === "first_inning") {
    if (lower === "yes") return "Yes";
    if (lower === "no") return "No";
  }

  // Total
  if (market === "total") {
    const lineStr = line !== null ? ` ${line}` : "";
    if (lower === "over") return `Over${lineStr}`;
    if (lower === "under") return `Under${lineStr}`;
  }

  // Double Chance composites (forward-compat for the DC DTO slot).
  if (lower === "home_or_draw") return `${homeAbbr ?? "Home"} or Draw`;
  if (lower === "away_or_draw") return `${awayAbbr ?? "Away"} or Draw`;
  if (lower === "home_or_away") return `${awayAbbr ?? "Away"} or ${homeAbbr ?? "Home"}`;

  return null;
}
