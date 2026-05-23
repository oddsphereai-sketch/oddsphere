/**
 * Closing Line Value (CLV) calculator.
 *
 * CLV measures whether the price you got at pick time was better than the
 * price at close (i.e., did you beat the closing line). Industry standard
 * proxy for sharp skill — over a large enough sample, sustained positive
 * CLV correlates strongly with long-term profitability.
 *
 *   clv_pct = (bet_implied − closing_implied) × 100
 *
 * Convention: positive clv_pct means our bet's implied probability was
 * LOWER than the closing line's implied probability (we got better odds —
 * the market moved against the bookmaker after we placed it).
 *
 * Per the locked Foundation policy, CLV is silenced for the first
 * CLV_SILENCE_DAYS (30 days) after pick time. Brand framing: "we don't
 * show CLV until we have a meaningful sample." Inputs within the silence
 * window return `{ clv_pct: null, beat_closing_line: null }`.
 */

import { CLV_SILENCE_DAYS } from "../../config/constants";
import { americanToImplied } from "../../utils/odds";

export type ClvResult = {
  clv_pct: number | null;
  beat_closing_line: boolean | null;
};

export type ClvInput = {
  bet_odds_american: number | null;
  closing_odds_american: number | null;
  /** YYYY-MM-DD or full ISO timestamp — date the game played. */
  game_date: string;
  /** YYYY-MM-DD — anchor for the silence window. */
  today: string;
  /** Override CLV_SILENCE_DAYS for tests; default uses constants.ts. */
  silenceDays?: number;
};

function daysBetweenISO(later: string, earlier: string): number {
  // Normalize to date-only by truncating to YYYY-MM-DD
  const laterDate = later.length >= 10 ? later.slice(0, 10) : later;
  const earlierDate = earlier.length >= 10 ? earlier.slice(0, 10) : earlier;
  return (
    (new Date(laterDate).getTime() - new Date(earlierDate).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

export function computeClv(input: ClvInput): ClvResult {
  const silenceDays = input.silenceDays ?? CLV_SILENCE_DAYS;

  // Within silence window → silent
  const ageDays = daysBetweenISO(input.today, input.game_date);
  if (ageDays <= silenceDays) {
    return { clv_pct: null, beat_closing_line: null };
  }

  // Missing data → silent (can't compute)
  if (
    input.bet_odds_american === null ||
    input.closing_odds_american === null
  ) {
    return { clv_pct: null, beat_closing_line: null };
  }

  const betImplied = americanToImplied(input.bet_odds_american);
  const closingImplied = americanToImplied(input.closing_odds_american);
  const clvPct = +((betImplied - closingImplied) * -100).toFixed(2);
  // NEGATIVE difference in implied prob = bet got BETTER odds than close.
  // We negate so positive clv_pct = better odds at pick time.
  // Equivalently: positive clv_pct = closing line moved AGAINST what we bet,
  // which is the sharp-confirmation reading.
  const beatClosingLine = clvPct > 0;
  return { clv_pct: clvPct, beat_closing_line: beatClosingLine };
}
