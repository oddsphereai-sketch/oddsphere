/**
 * Closing-line / CLV capture at settle time (2026-06-22, "B" capture patch).
 *
 * Predictions lock with `odds_american` = the bet/lock price. The CLOSING line
 * is reconstructed from `line_history`: the last priced row at/before game start
 * for the picked (market, side), from the highest-priority non-blocked book. We
 * then compute CLV vs the lock price and persist a `closing_line_value` audit
 * blob into `prediction_records.snapshot_json` (additive — never touches any
 * decision field). This is internal calibration substrate, so it bypasses the
 * public 30-day CLV silence window (the closing line is final at game start).
 *
 * Pure module (no DB/Supabase imports) so the selection + CLV math are unit
 * testable without env. The grading service does the I/O and calls these.
 */
import { computeClv } from "../models/tracking/clvCalculator";
import { isBlockedSportsbook } from "../config/blockedSportsbooks";

/**
 * Closing-line book priority. Intentionally a local copy of
 * predictionRecordService's BOOK_PRIORITY (not imported) so this module stays
 * dependency-light and pure for testing. Pinnacle first = sharpest close.
 * Keep in sync with predictionRecordService.BOOK_PRIORITY.
 */
export const CLOSING_BOOK_PRIORITY: readonly string[] = [
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365 us",
  "bookmaker",
  "ballybet",
  "onexbet",
  "saba",
  "splits_consensus",
] as const;

export type ClosingLineHistoryRow = {
  market_type: string | null;
  side: string | null;
  sportsbook: string | null;
  odds_american: number | null;
  line_value: number | null;
  recorded_at: string | null;
};

export type ClosingLineSelection = {
  odds_american: number;
  line_value: number | null;
  sportsbook: string;
  recorded_at: string | null;
};

/**
 * Pick the closing line for (market, side): the latest priced, non-blocked row
 * recorded at/before game start, preferring the highest-priority book. Returns
 * null when nothing qualifies (e.g. first_inning, which line_history does not
 * carry, or a game with no pre-start history) — caller skips gracefully.
 */
export function selectClosingLine(
  rows: readonly ClosingLineHistoryRow[],
  market: "moneyline" | "total",
  side: string,
  gameStartISO: string,
): ClosingLineSelection | null {
  const start = new Date(gameStartISO).getTime();
  if (!Number.isFinite(start)) return null;
  const sideLc = side.trim().toLowerCase();
  const candidates = rows.filter(
    (r) =>
      r.market_type === market &&
      typeof r.odds_american === "number" &&
      r.sportsbook !== null &&
      !isBlockedSportsbook(r.sportsbook) &&
      (r.side ?? "").trim().toLowerCase() === sideLc &&
      r.recorded_at !== null &&
      Number.isFinite(new Date(r.recorded_at).getTime()) &&
      new Date(r.recorded_at).getTime() <= start,
  );
  if (candidates.length === 0) return null;
  const toSel = (r: ClosingLineHistoryRow): ClosingLineSelection => ({
    odds_american: r.odds_american as number,
    line_value: r.line_value,
    sportsbook: r.sportsbook as string,
    recorded_at: r.recorded_at,
  });
  const latestFirst = (a: ClosingLineHistoryRow, b: ClosingLineHistoryRow): number =>
    new Date(b.recorded_at as string).getTime() - new Date(a.recorded_at as string).getTime();
  // Highest-priority book that has a pre-start row → its latest such row.
  for (const book of CLOSING_BOOK_PRIORITY) {
    const forBook = candidates
      .filter((r) => (r.sportsbook ?? "").trim().toLowerCase() === book)
      .sort(latestFirst);
    if (forBook.length > 0) return toSel(forBook[0]);
  }
  // No priority-listed book matched — fall back to the overall latest candidate.
  return toSel([...candidates].sort(latestFirst)[0]);
}

export type ClosingLineValue = {
  market: "moneyline" | "total";
  side: string;
  bet_odds_american: number | null;
  closing_odds_american: number | null;
  closing_line_value: number | null;
  closing_sportsbook: string | null;
  closing_recorded_at: string | null;
  clv_pct: number | null;
  beat_closing_line: boolean | null;
  captured_at: string;
  source: "line_history";
};

/**
 * Build the `closing_line_value` audit blob (closing odds + provenance + CLV).
 * `silenceDays: 0` — internal capture, not the public CLV surface.
 */
export function buildClosingLineValue(args: {
  market: "moneyline" | "total";
  side: string;
  betOddsAmerican: number | null;
  selection: ClosingLineSelection | null;
  gameDateISO: string;
  nowISO: string;
}): ClosingLineValue {
  const { market, side, betOddsAmerican, selection, gameDateISO, nowISO } = args;
  const closingOdds = selection?.odds_american ?? null;
  const clv = computeClv({
    bet_odds_american: betOddsAmerican,
    closing_odds_american: closingOdds,
    game_date: gameDateISO,
    today: nowISO.slice(0, 10),
    silenceDays: 0,
  });
  return {
    market,
    side,
    bet_odds_american: betOddsAmerican,
    closing_odds_american: closingOdds,
    closing_line_value: selection?.line_value ?? null,
    closing_sportsbook: selection?.sportsbook ?? null,
    closing_recorded_at: selection?.recorded_at ?? null,
    clv_pct: clv.clv_pct,
    beat_closing_line: clv.beat_closing_line,
    captured_at: nowISO,
    source: "line_history",
  };
}
