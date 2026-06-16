/**
 * CLV reconcile core (2026-06-16). PURE — no DB, no Next. The cron route
 * (app/api/cron/clv-reconcile/route.ts) supplies the rows; this module does the
 * closing-line selection + CLV math.
 *
 * Closing line is APPROXIMATED (vendor has no true closing flag — see memory):
 * the last accepted price for the picked side strictly before kickoff/first
 * pitch, from a trusted book (never blocked books, never splits_consensus).
 *
 * Lock-safety: this path ONLY ever produces updates to the additive CLV
 * columns (closing_odds_american / clv_pct / beat_closing_line) +
 * bet_odds_american. It NEVER touches picks, grades, confidences, or any
 * locked decision field.
 */

import { isBlockedSportsbook } from "../config/blockedSportsbooks";
import { computeClv } from "../streaming/clvMath";

/** Trusted-book preference for the closing price (highest first). */
const CLOSING_BOOK_PRIORITY = [
  "pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars",
];

export type HistoryTick = {
  sportsbook: string;
  odds_american: number | null;
  recorded_at: string; // ISO
};

/**
 * Pick the closing American odds for a picked side: the latest acceptable tick
 * strictly before `gameDateMs`. Acceptable = real book (not blocked, not
 * splits_consensus) with a non-null price. Among ties at the latest timestamp,
 * the highest-priority book wins. Returns null when nothing qualifies.
 */
export function pickClosingLine(history: HistoryTick[], gameDateMs: number): number | null {
  const eligible = history.filter(
    (t) =>
      t.odds_american !== null &&
      t.sportsbook !== "splits_consensus" &&
      !isBlockedSportsbook(t.sportsbook) &&
      Number.isFinite(Date.parse(t.recorded_at)) &&
      Date.parse(t.recorded_at) < gameDateMs,
  );
  if (eligible.length === 0) return null;
  const maxTs = Math.max(...eligible.map((t) => Date.parse(t.recorded_at)));
  const atClose = eligible.filter((t) => Date.parse(t.recorded_at) === maxTs);
  atClose.sort((a, b) => bookRank(a.sportsbook) - bookRank(b.sportsbook));
  return atClose[0].odds_american;
}

function bookRank(book: string): number {
  const i = CLOSING_BOOK_PRIORITY.indexOf(book.toLowerCase());
  return i === -1 ? CLOSING_BOOK_PRIORITY.length : i;
}

export type ClvRecord = {
  gamePredictionId: number;
  gameId: number;
  market: string;
  /** Picked-side price at the moment we published/bet (posted line, else lock price). */
  betAmerican: number | null;
};

export type ClvUpdate = {
  gamePredictionId: number;
  gameId: number;
  market: string;
  bet_odds_american: number | null;
  closing_odds_american: number | null;
  clv_pct: number | null;
  beat_closing_line: boolean | null;
};

/** Compute the CLV update for one record given its closing line. Null when no bet price. */
export function computeClvUpdate(record: ClvRecord, closingAmerican: number | null): ClvUpdate | null {
  if (record.betAmerican === null) return null;
  const { clvPct, beatClosing } = computeClv(record.betAmerican, closingAmerican);
  return {
    gamePredictionId: record.gamePredictionId,
    gameId: record.gameId,
    market: record.market,
    bet_odds_american: record.betAmerican,
    closing_odds_american: closingAmerican,
    clv_pct: clvPct,
    beat_closing_line: beatClosing,
  };
}
