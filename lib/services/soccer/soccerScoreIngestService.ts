/**
 * soccerScoreIngestService — mark finished WC fixtures `final` and ingest
 * their 90' regulation score into `games.status` / `home_score` /
 * `away_score`, so the shared grader can resolve match_result / double_
 * chance / total / btts predictions.
 *
 * Why this exists: `seedSoccerGamesService` only writes status/scores for a
 * SINGLE slate day, so once a fixture's slate date passes the seed targets a
 * new date and never re-fetches yesterday's finished games — they freeze at
 * their last-seen status (`in_progress`/`scheduled`). This service re-fetches
 * a yesterday/today/tomorrow window from the BDL FIFA provider and finalizes
 * any match that has reported a terminal status AND a complete two-sided FT
 * score. It writes the CANONICAL status `"final"` (recognized by
 * predictionGrader.isFinalStatus) regardless of which terminal token BDL
 * uses, so grading is decoupled from the provider's exact string.
 *
 * Safety: a match is finalized ONLY when both ft scores are present and the
 * BDL status is a recognized terminal token — never on elapsed time alone,
 * so a live/suspended match is never graded prematurely. Locked prediction
 * snapshots are untouched (this writes the games row, not predictions).
 */

import { supabase } from "../../db/supabase";
import { BallDontLieFifaProvider } from "../../providers/real_api/BallDontLieFifaProvider";
import { BdlFifaClient } from "../../providers/real_api/_bdlFifaClient";

export type IngestSoccerScoresOptions = {
  /** Slate date (YYYY-MM-DD, ET). The window spans this ±1 day. */
  slateDate: string;
  /** When false, computes the diff but performs no DB writes (dry-run). */
  apply: boolean;
};

export type IngestSoccerScoresResult = {
  /** games rows updated to status=final with scores. */
  updated: number;
  /** Count of fixtures detected as final this pass. */
  finalizedCount: number;
  /** Total BDL matches fetched for the window. */
  apiEventsFetched: number;
  errors: string[];
};

/**
 * BDL FIFA terminal-status tokens. The provider passes the vendor status
 * through verbatim; we cover the common "finished" spellings so a single
 * vendor wording change can't silently stop grading. Matching is
 * case-insensitive and ignores spaces/underscores.
 */
const SOCCER_FINAL_TOKENS = new Set([
  "final",
  "finished",
  "fulltime",
  "ft",
  "complete",
  "completed",
  "afterextratime",
  "aet",
  "afterpenalties",
  "penalties",
  "ended",
]);

function isTerminalSoccerStatus(status: string | null): boolean {
  if (status === null) return false;
  const norm = status.toLowerCase().replace(/[\s_-]/g, "");
  return SOCCER_FINAL_TOKENS.has(norm);
}

function dayOffset(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function ingestSoccerFinalScores(
  opts: IngestSoccerScoresOptions,
): Promise<IngestSoccerScoresResult> {
  const result: IngestSoccerScoresResult = {
    updated: 0,
    finalizedCount: 0,
    apiEventsFetched: 0,
    errors: [],
  };

  // Window: yesterday → tomorrow so finished games whose slate date has
  // already rolled over still get finalized.
  const startDate = dayOffset(opts.slateDate, -1);
  const endDate = dayOffset(opts.slateDate, 1);

  // Soccer games in the window that are not already final.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, status, game_date, home_score, away_score")
    .eq("sport", "soccer")
    .gte("game_date", `${startDate}T00:00:00.000Z`)
    .lte("game_date", `${endDate}T23:59:59.999Z`);
  if (gamesErr) {
    result.errors.push(`soccer games query: ${gamesErr.message}`);
    return result;
  }
  const games = (gamesData ?? []) as Array<{
    id: number;
    external_id: number;
    status: string | null;
    game_date: string;
    home_score: number | null;
    away_score: number | null;
  }>;
  const pending = games.filter((g) => g.status !== "final");
  if (pending.length === 0) return result;

  let matches;
  try {
    const bdlKey = process.env.BALLDONTLIE_API_KEY;
    if (bdlKey === undefined || bdlKey === "") {
      result.errors.push("BALLDONTLIE_API_KEY missing from env");
      return result;
    }
    const provider = new BallDontLieFifaProvider(new BdlFifaClient(bdlKey));
    matches = await provider.listMatches({ start_date: startDate, end_date: endDate });
  } catch (e) {
    result.errors.push(`BDL FIFA listMatches: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
  result.apiEventsFetched = matches.length;
  const matchByExternal = new Map(matches.map((m) => [m.provider_match_id, m]));

  for (const g of pending) {
    const m = matchByExternal.get(g.external_id);
    if (m === undefined) continue;
    const finished =
      isTerminalSoccerStatus(m.status) &&
      m.ft_home_score !== null &&
      m.ft_away_score !== null;
    if (!finished) continue;
    result.finalizedCount++;
    if (!opts.apply) continue;
    const { error: updErr } = await supabase
      .from("games")
      .update({
        status: "final",
        home_score: m.ft_home_score,
        away_score: m.ft_away_score,
      })
      .eq("id", g.id);
    if (updErr) {
      result.errors.push(`update game ${g.id}: ${updErr.message}`);
      continue;
    }
    result.updated++;
  }

  return result;
}
