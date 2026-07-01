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
import { isDisplayableAmericanOdds } from "../streaming/oddsSanity";

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
    (r) =>
      r.market_type === marketType &&
      r.side === side &&
      isDisplayableAmericanOdds(r.odds_american) &&
      !isBlockedSportsbook(r.sportsbook) &&
      r.sportsbook !== "splits_consensus",
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
    (r) =>
      r.market_type === marketType &&
      r.side === side &&
      isDisplayableAmericanOdds(r.odds_american) &&
      !isBlockedSportsbook(r.sportsbook) &&
      r.sportsbook !== "splits_consensus",
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
  const log = opts.log ?? (() => {});
  let scanned = 0;
  let updated = 0;
  let updateErrors = 0;
  try {
    // Two-step selection (robust): resolve the slate's game ids from `games`,
    // then read unlocked game_predictions by game_id. Avoids relying on an
    // embedded-resource filter and makes the matched set explicit/loggable.
    const { data: gamesData, error: gErr } = (await opts.supabase
      .from("games")
      .select("id")
      .eq("sport", opts.sport)
      .eq("slate_date", opts.slateDate)) as { data: unknown; error: unknown };
    if (gErr) {
      log(`posted-lines: games read error — skipping (${String((gErr as { message?: string })?.message ?? gErr)})`);
      return { scanned: 0, updated: 0, dryRun: !opts.apply };
    }
    const slateGameIds = ((gamesData ?? []) as Array<{ id: number }>).map((g) => g.id);
    log(`posted-lines: ${opts.sport} ${opts.slateDate} slate games=${slateGameIds.length}`);
    if (slateGameIds.length === 0) return { scanned: 0, updated: 0, dryRun: !opts.apply };

    const { data: preds, error } = (await opts.supabase
      .from("game_predictions")
      .select("id, game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi, sport_specific")
      .in("game_id", slateGameIds)
      .is("locked_at", null)) as { data: unknown; error: unknown };
    if (error) {
      log(`posted-lines: predictions read error — skipping (${String((error as { message?: string })?.message ?? error)})`);
      return { scanned: 0, updated: 0, dryRun: !opts.apply };
    }
    const rows = (preds ?? []) as Array<{
      id: number; game_id: number;
      predicted_ml_winner: string | null; predicted_ou_side: string | null; predicted_nrfi: boolean | null;
      sport_specific: Record<string, unknown> | null;
    }>;
    log(`posted-lines: unlocked game_predictions=${rows.length}`);
    if (rows.length === 0) return { scanned: 0, updated: 0, dryRun: !opts.apply };

    const gameIds = [...new Set(rows.map((r) => r.game_id))];

    // PAGINATE past the Supabase 1000-row .in() cap — a slate's lines /
    // odds_current_stream run to thousands of rows (markets × sides × books),
    // so an un-paginated read silently truncates and tail games would wrongly
    // fall back to cron. Chunk the games + range-paginate.
    const pageAll = async (table: string, cols: string): Promise<Array<Record<string, unknown>>> => {
      const out: Array<Record<string, unknown>> = [];
      for (let i = 0; i < gameIds.length; i += 20) {
        const chunk = gameIds.slice(i, i + 20);
        let from = 0;
        for (;;) {
          const { data, error } = (await opts.supabase
            .from(table)
            .select(cols)
            .in("game_id", chunk)
            .range(from, from + 999)) as { data: unknown; error: unknown };
          if (error) return out; // table missing / error → degrade (stream) or what we have
          const page = (data ?? []) as Array<Record<string, unknown>>;
          out.push(...page);
          if (page.length < 1000) break;
          from += 1000;
        }
      }
      return out;
    };

    // Cron lines (always available).
    const lineRows = (await pageAll("lines", "game_id, market_type, side, sportsbook, odds_american, line_value")) as unknown as Array<LineRowLite & { game_id: number }>;
    const linesByGame = new Map<number, LineRowLite[]>();
    for (const l of lineRows) {
      (linesByGame.get(l.game_id) ?? linesByGame.set(l.game_id, []).get(l.game_id)!).push(l);
    }

    // Live stream (preferred). Defensive: empty when the table is absent.
    const streamByGame = new Map<number, StreamRowLite[]>();
    let streamCount = 0;
    try {
      const sRows = (await pageAll("odds_current_stream", "game_id, market_type, side, sportsbook, odds_american, line_value, observed_at")) as unknown as Array<StreamRowLite & { game_id: number }>;
      streamCount = sRows.length;
      for (const s of sRows) {
        (streamByGame.get(s.game_id) ?? streamByGame.set(s.game_id, []).get(s.game_id)!).push(s);
      }
    } catch { /* stream table absent → cron fallback only */ }
    log(`posted-lines: lines rows=${lineRows.length} stream rows=${streamCount}`);

    let loggedSample = false;
    for (const r of rows) {
      scanned += 1;
      const incoming = buildIncomingPostedLines(
        { mlWinner: r.predicted_ml_winner, ouSide: r.predicted_ou_side, nrfi: r.predicted_nrfi },
        streamByGame.get(r.game_id) ?? [],
        linesByGame.get(r.game_id) ?? [],
        nowIso,
      );
      if (!loggedSample) {
        loggedSample = true;
        log(`posted-lines: sample game_id=${r.game_id} incoming=${JSON.stringify(incoming)}`);
      }
      const existing = (r.sport_specific?.posted_lines as PostedLines | undefined) ?? null;
      const { posted_lines, changed } = mergePostedLines(existing, incoming);
      if (!changed) continue;
      updated += 1;
      if (opts.apply) {
        const nextSportSpecific = { ...(r.sport_specific ?? {}), posted_lines };
        const { error: upErr } = (await opts.supabase
          .from("game_predictions")
          .update({ sport_specific: nextSportSpecific })
          .eq("id", r.id)
          .is("locked_at", null)) as { error: unknown }; // never write a row that locked meanwhile
        if (upErr) {
          updateErrors += 1;
          log(`posted-lines: UPDATE error id=${r.id}: ${String((upErr as { message?: string })?.message ?? upErr)}`);
        }
      }
    }
    log(`posted-lines: scanned=${scanned} updated=${updated} updateErrors=${updateErrors} apply=${opts.apply}`);
  } catch (e) {
    log(`posted-lines: unexpected error — skipping (${String(e)})`);
  }
  return { scanned, updated, dryRun: !opts.apply };
}
