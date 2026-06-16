/**
 * First Published ("posted lines") writer (2026-06-16).
 *
 * Records, per market, the picked-side market price at the moment we first
 * publish a prediction — stored set-if-null in
 * game_predictions.sport_specific.posted_lines (per-market JSONB; see v24
 * migration §5). The daily-edge route reads it as the member-facing "First
 * Published" line-tracker stop.
 *
 * Safety:
 *   • Pure merge (mergePostedLines) is set-if-null — re-runs never overwrite an
 *     existing market entry, so the FIRST observed price wins.
 *   • The apply step writes ONLY sport_specific.posted_lines (additive JSONB);
 *     it never touches picks/grades/confidences and only updates UNLOCKED rows
 *     (locked snapshots stay frozen). Never throws.
 *   • Gated OFF by default (POSTED_LINES_WRITE_ENABLED) at the call site.
 */

import { isBlockedSportsbook } from "../config/blockedSportsbooks";

export type PostedLineEntry = { american: number; at: string };
export type PostedLines = {
  moneyline?: PostedLineEntry;
  total?: PostedLineEntry;
  first_inning?: PostedLineEntry;
};

/** Trusted-book preference for the published price (highest first). */
const POSTED_BOOK_PRIORITY = [
  "pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars",
];

/**
 * Set-if-null merge: add each incoming market entry ONLY when `existing` does
 * not already have it. Returns the merged object + whether anything changed.
 */
export function mergePostedLines(
  existing: PostedLines | null | undefined,
  incoming: PostedLines,
): { posted_lines: PostedLines; changed: boolean } {
  const base: PostedLines = { ...(existing ?? {}) };
  let changed = false;
  for (const market of ["moneyline", "total", "first_inning"] as const) {
    if (base[market] === undefined && incoming[market] !== undefined) {
      base[market] = incoming[market];
      changed = true;
    }
  }
  return { posted_lines: base, changed };
}

export type LineRowLite = {
  market_type: string;
  side: string | null;
  sportsbook: string;
  odds_american: number | null;
};

/**
 * Pick the picked-side American price from current `lines` rows for one market,
 * preferring trusted books and never blocked books / splits_consensus.
 * Returns null when no acceptable price exists.
 */
export function pickedSidePrice(
  rows: LineRowLite[],
  marketType: string,
  side: string,
): number | null {
  const eligible = rows.filter(
    (r) =>
      r.market_type === marketType &&
      r.side === side &&
      r.odds_american !== null &&
      r.sportsbook !== "splits_consensus" &&
      !isBlockedSportsbook(r.sportsbook),
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => bookRank(a.sportsbook) - bookRank(b.sportsbook));
  return eligible[0].odds_american;
}

function bookRank(book: string): number {
  const i = POSTED_BOOK_PRIORITY.indexOf(book.toLowerCase());
  return i === -1 ? POSTED_BOOK_PRIORITY.length : i;
}

/**
 * Build the incoming posted-lines patch for one prediction from its picks +
 * current lines. `nowIso` stamps the `at`. Markets without a pick or without a
 * current price are omitted (no fabricated stop).
 */
export function buildIncomingPostedLines(
  picks: { mlWinner: string | null; ouSide: string | null; nrfi: boolean | null },
  lines: LineRowLite[],
  nowIso: string,
): PostedLines {
  const out: PostedLines = {};
  if (picks.mlWinner === "home" || picks.mlWinner === "away") {
    const p = pickedSidePrice(lines, "moneyline", picks.mlWinner);
    if (p !== null) out.moneyline = { american: p, at: nowIso };
  }
  if (picks.ouSide === "over" || picks.ouSide === "under") {
    const p = pickedSidePrice(lines, "total", picks.ouSide);
    if (p !== null) out.total = { american: p, at: nowIso };
  }
  if (picks.nrfi !== null) {
    const side = picks.nrfi ? "under" : "over"; // NRFI = under 1st-inning total
    const p = pickedSidePrice(lines, "first_inning_total", side);
    if (p !== null) out.first_inning = { american: p, at: nowIso };
  }
  return out;
}

// ── Gated DB apply (defensive; not unit-tested — pure parts above are) ──

type SupabaseLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type RecordFirstPublishedOpts = {
  supabase: SupabaseLike;
  sport: string;
  slateDate: string;
  apply: boolean;
  nowIso?: string;
  log?: (line: string) => void;
};

/**
 * Set-if-null posted_lines for every UNLOCKED prediction on the slate. Reads
 * current `lines`, never mutates locked rows, never touches picks/grades.
 * Dry-run when apply=false. Never throws (returns a summary).
 */
export async function recordFirstPublishedLines(
  opts: RecordFirstPublishedOpts,
): Promise<{ scanned: number; updated: number; dryRun: boolean }> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  let scanned = 0;
  let updated = 0;
  try {
    const { data: preds, error } = (await opts.supabase
      .from("game_predictions")
      .select(
        "id, game_id, locked_at, predicted_ml_winner, predicted_ou_side, predicted_nrfi, sport_specific, games!inner ( sport, slate_date )",
      )
      .is("locked_at", null)
      .eq("games.sport", opts.sport)
      .eq("games.slate_date", opts.slateDate)) as { data: unknown; error: unknown };
    if (error) {
      opts.log?.(`posted-lines: read error — skipping (${String((error as { message?: string })?.message ?? error)})`);
      return { scanned: 0, updated: 0, dryRun: !opts.apply };
    }
    const rows = (preds ?? []) as Array<{
      id: number; game_id: number; locked_at: string | null;
      predicted_ml_winner: string | null; predicted_ou_side: string | null; predicted_nrfi: boolean | null;
      sport_specific: Record<string, unknown> | null;
    }>;
    if (rows.length === 0) return { scanned: 0, updated: 0, dryRun: !opts.apply };

    const gameIds = [...new Set(rows.map((r) => r.game_id))];
    const { data: linesData } = (await opts.supabase
      .from("lines")
      .select("game_id, market_type, side, sportsbook, odds_american")
      .in("game_id", gameIds)) as { data: unknown };
    const linesByGame = new Map<number, LineRowLite[]>();
    for (const l of ((linesData ?? []) as Array<LineRowLite & { game_id: number }>)) {
      (linesByGame.get(l.game_id) ?? linesByGame.set(l.game_id, []).get(l.game_id)!).push(l);
    }

    for (const r of rows) {
      scanned += 1;
      const incoming = buildIncomingPostedLines(
        { mlWinner: r.predicted_ml_winner, ouSide: r.predicted_ou_side, nrfi: r.predicted_nrfi },
        linesByGame.get(r.game_id) ?? [],
        nowIso,
      );
      const existing = (r.sport_specific?.posted_lines as PostedLines | undefined) ?? null;
      const { posted_lines, changed } = mergePostedLines(existing, incoming);
      if (!changed) continue;
      updated += 1;
      if (opts.apply) {
        const nextSportSpecific = { ...(r.sport_specific ?? {}), posted_lines };
        await opts.supabase
          .from("game_predictions")
          .update({ sport_specific: nextSportSpecific })
          .eq("id", r.id)
          .is("locked_at", null); // belt-and-suspenders: never write a row that locked meanwhile
      }
    }
  } catch (e) {
    opts.log?.(`posted-lines: unexpected error — skipping (${String(e)})`);
  }
  return { scanned, updated, dryRun: !opts.apply };
}
