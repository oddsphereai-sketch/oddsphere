/**
 * First Published ("posted lines") writer (2026-06-16).
 *
 * Records, per market, the picked-side market price at the moment we first
 * publish a prediction — stored set-if-null in
 * game_predictions.sport_specific.posted_lines (per-market JSONB; see v24
 * migration §5). The daily-edge route reads it as the member-facing "First
 * Published" line-tracker stop.
 *
 * Source preference (req 4): the live odds_current_stream main-line price when
 * present (source_kind="current_stream"), else the cron `lines` snapshot at a
 * trusted book (source_kind="rest_cron"). Fails safe (omits the stop) when
 * neither has a price.
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

/** Rich per-market entry — enough for the line tracker + audit (req 7). */
export type PostedLineEntry = {
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  book: string | null;
  observed_at: string;
  source: string; // provider label
  source_kind: "current_stream" | "rest_cron";
};
export type PostedLines = {
  moneyline?: PostedLineEntry;
  total?: PostedLineEntry;
  first_inning?: PostedLineEntry;
};

/** Trusted-book preference for the cron-fallback price (highest first). */
const POSTED_BOOK_PRIORITY = ["pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars"];

export type LineRowLite = {
  market_type: string;
  side: string | null;
  sportsbook: string;
  odds_american: number | null;
  line_value?: number | null;
};
export type StreamRowLite = {
  market_type: string;
  side: string;
  sportsbook: string;
  odds_american: number | null;
  line_value: number | null;
  observed_at: string | null;
};

/** Set-if-null merge: add each incoming market entry ONLY when missing. */
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

function bookRank(book: string): number {
  const i = POSTED_BOOK_PRIORITY.indexOf(book.toLowerCase());
  return i === -1 ? POSTED_BOOK_PRIORITY.length : i;
}

/** Live-stream entry for the picked side (preferred). Null when none. */
export function pickStreamEntry(rows: StreamRowLite[], marketType: string, side: string, nowIso: string): PostedLineEntry | null {
  const hit = rows.find(
    (r) => r.market_type === marketType && r.side === side && r.odds_american !== null && !isBlockedSportsbook(r.sportsbook) && r.sportsbook !== "splits_consensus",
  );
  if (hit === undefined) return null;
  return {
    side, line_value: hit.line_value, odds_american: hit.odds_american, book: hit.sportsbook,
    observed_at: hit.observed_at ?? nowIso, source: "sharpapi_ws", source_kind: "current_stream",
  };
}

/** Cron `lines` entry for the picked side (trusted book). Null when none. */
export function pickCronEntry(rows: LineRowLite[], marketType: string, side: string, nowIso: string): PostedLineEntry | null {
  const eligible = rows.filter(
    (r) => r.market_type === marketType && r.side === side && r.odds_american !== null && !isBlockedSportsbook(r.sportsbook) && r.sportsbook !== "splits_consensus",
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => bookRank(a.sportsbook) - bookRank(b.sportsbook));
  const hit = eligible[0];
  return {
    side, line_value: hit.line_value ?? null, odds_american: hit.odds_american, book: hit.sportsbook,
    observed_at: nowIso, source: "rest_cron", source_kind: "rest_cron",
  };
}

/** Best entry for a picked side: live stream first, cron fallback. */
function pickBestEntry(stream: StreamRowLite[], lines: LineRowLite[], marketType: string, side: string, nowIso: string): PostedLineEntry | null {
  return pickStreamEntry(stream, marketType, side, nowIso) ?? pickCronEntry(lines, marketType, side, nowIso);
}

/**
 * Build the incoming posted-lines patch for one prediction from its picks +
 * current line sources. Markets without a pick or without any price are omitted.
 */
export function buildIncomingPostedLines(
  picks: { mlWinner: string | null; ouSide: string | null; nrfi: boolean | null },
  stream: StreamRowLite[],
  lines: LineRowLite[],
  nowIso: string,
): PostedLines {
  const out: PostedLines = {};
  if (picks.mlWinner === "home" || picks.mlWinner === "away") {
    const e = pickBestEntry(stream, lines, "moneyline", picks.mlWinner, nowIso);
    if (e !== null) out.moneyline = e;
  }
  if (picks.ouSide === "over" || picks.ouSide === "under") {
    const e = pickBestEntry(stream, lines, "total", picks.ouSide, nowIso);
    if (e !== null) out.total = e;
  }
  if (picks.nrfi !== null) {
    const side = picks.nrfi ? "under" : "over"; // NRFI = under 1st-inning total
    const e = pickBestEntry(stream, lines, "first_inning_total", side, nowIso);
    if (e !== null) out.first_inning = e;
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
 * live odds_current_stream (preferred) + cron `lines` (fallback). Never mutates
 * locked rows, never touches picks/grades. Dry-run when apply=false. Never throws.
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
      id: number; game_id: number;
      predicted_ml_winner: string | null; predicted_ou_side: string | null; predicted_nrfi: boolean | null;
      sport_specific: Record<string, unknown> | null;
    }>;
    if (rows.length === 0) return { scanned: 0, updated: 0, dryRun: !opts.apply };

    const gameIds = [...new Set(rows.map((r) => r.game_id))];

    // Cron lines (always available). game_id excluded from the row shape below.
    const { data: linesData } = (await opts.supabase
      .from("lines")
      .select("game_id, market_type, side, sportsbook, odds_american, line_value")
      .in("game_id", gameIds)) as { data: unknown };
    const linesByGame = new Map<number, LineRowLite[]>();
    for (const l of ((linesData ?? []) as Array<LineRowLite & { game_id: number }>)) {
      (linesByGame.get(l.game_id) ?? linesByGame.set(l.game_id, []).get(l.game_id)!).push(l);
    }

    // Live stream (preferred). Defensive: empty when the table is absent.
    const streamByGame = new Map<number, StreamRowLite[]>();
    try {
      const { data: streamData, error: sErr } = (await opts.supabase
        .from("odds_current_stream")
        .select("game_id, market_type, side, sportsbook, odds_american, line_value, observed_at")
        .in("game_id", gameIds)) as { data: unknown; error: unknown };
      if (!sErr) {
        for (const s of ((streamData ?? []) as Array<StreamRowLite & { game_id: number }>)) {
          (streamByGame.get(s.game_id) ?? streamByGame.set(s.game_id, []).get(s.game_id)!).push(s);
        }
      }
    } catch { /* stream table absent → cron fallback only */ }

    for (const r of rows) {
      scanned += 1;
      const incoming = buildIncomingPostedLines(
        { mlWinner: r.predicted_ml_winner, ouSide: r.predicted_ou_side, nrfi: r.predicted_nrfi },
        streamByGame.get(r.game_id) ?? [],
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
