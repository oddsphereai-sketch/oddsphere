/**
 * Phase 7L Phase 4 — NHL final score ingest + game-status sync.
 *
 * Pulls /v1/score/{date} from the NHL public API for the requested
 * slate, finds matching `games` rows (sport='nhl'), and writes final
 * scores + status when the game is OFF/FINAL.
 *
 * Used by the grading pipeline: predictions can't be graded until we
 * have a final home_score / away_score / status on the games row.
 *
 * Scope:
 *   • Reads:  api-web.nhle.com /v1/score/{date}.
 *   • Writes: games table (home_score, away_score, status) for rows
 *             whose external_id matches an NHL API event.
 *   • NEVER writes any MLB / NBA row.
 *   • Idempotent: re-running on a completed game is a no-op (same
 *     score values).
 */

import { supabase } from "../../db/supabase";
import { fetchNhlScoreForDate } from "../../providers/nhl/_nhlApiClient";

export type IngestNhlScoresOptions = {
  /** ET slate-date YYYY-MM-DD. The service derives the UTC date(s) to
   *  fetch from the matched games' game_date column. */
  slateDate: string;
  /** false = dry-run; true = write final scores. */
  apply: boolean;
  logger?: (msg: string) => void;
};

export type IngestNhlScoresResult = {
  mode: "dry-run" | "write" | "no-games";
  gamesInDb: number;
  apiEventsFetched: number;
  matched: number;
  updated: number;
  /** Games that ARE final per NHL API and whose status changed in DB. */
  finalizedCount: number;
  errors: string[];
};

type DbGameRow = {
  id: number;
  external_id: number;
  game_date: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

export async function ingestNhlFinalScores(
  opts: IngestNhlScoresOptions,
): Promise<IngestNhlScoresResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];

  // Load games on the slate.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, game_date, status, home_score, away_score")
    .eq("sport", "nhl")
    .eq("slate_date", opts.slateDate);
  if (gamesErr) throw new Error(`load NHL games: ${gamesErr.message}`);
  const games = (gamesData as DbGameRow[] | null) ?? [];
  log(`NHL games on slate ${opts.slateDate}: ${games.length}`);
  if (games.length === 0) {
    return {
      mode: "no-games",
      gamesInDb: 0,
      apiEventsFetched: 0,
      matched: 0,
      updated: 0,
      finalizedCount: 0,
      errors,
    };
  }

  // Derive UTC date(s) to fetch from NHL API.
  const utcDates = new Set<string>();
  for (const g of games) utcDates.add(g.game_date.slice(0, 10));
  log(`NHL API fetch dates (UTC): ${[...utcDates].sort().join(", ")}`);

  let apiEvents = 0;
  const apiByExtId = new Map<string, {
    score_home: number | null; score_away: number | null; game_state: string;
  }>();
  for (const d of [...utcDates].sort()) {
    const events = await fetchNhlScoreForDate(d);
    apiEvents += events.length;
    for (const e of events) {
      apiByExtId.set(e.nhl_game_id, {
        score_home: e.home.score,
        score_away: e.away.score,
        game_state: e.game_state,
      });
    }
  }
  log(`NHL API events fetched: ${apiEvents}`);

  // Match + update.
  let matched = 0;
  let updated = 0;
  let finalizedCount = 0;
  for (const g of games) {
    const api = apiByExtId.get(String(g.external_id));
    if (!api) continue;
    matched += 1;
    // Only update when something differs.
    const wantsStatus = api.game_state;
    const wantsHome = api.score_home;
    const wantsAway = api.score_away;
    if (g.status === wantsStatus && g.home_score === wantsHome && g.away_score === wantsAway) {
      log(`  = ${g.external_id}: state=${wantsStatus} score=${wantsAway}-${wantsHome} (no change)`);
      continue;
    }
    const isNowFinal = (wantsStatus === "FINAL" || wantsStatus === "OFF") && g.status !== "FINAL" && g.status !== "OFF";
    if (!opts.apply) {
      log(`  [dry-run] ${g.external_id}: ${g.status} → ${wantsStatus}, score ${g.away_score}-${g.home_score} → ${wantsAway}-${wantsHome}${isNowFinal ? "  ←  now FINAL" : ""}`);
      updated += 1;
      if (isNowFinal) finalizedCount += 1;
      continue;
    }
    const { error: upErr } = await supabase
      .from("games")
      .update({
        status: wantsStatus,
        home_score: wantsHome,
        away_score: wantsAway,
      })
      .eq("id", g.id);
    if (upErr) {
      const msg = `  ✗ update game ${g.id}: ${upErr.message}`;
      log(msg);
      errors.push(msg);
    } else {
      log(`  ✓ ${g.external_id}: state=${wantsStatus} score=${wantsAway}-${wantsHome}${isNowFinal ? "  ←  FINALIZED" : ""}`);
      updated += 1;
      if (isNowFinal) finalizedCount += 1;
    }
  }

  return {
    mode: opts.apply ? "write" : "dry-run",
    gamesInDb: games.length,
    apiEventsFetched: apiEvents,
    matched,
    updated,
    finalizedCount,
    errors,
  };
}
