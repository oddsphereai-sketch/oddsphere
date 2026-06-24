/**
 * WNBA Phase 2 — Stage 3: final-score ingest (2026-06-23).
 *
 * Pulls recently-finished WNBA games from BallDontLie and updates the DB game
 * with final home/away scores + status='final'. Matched by EXACT BDL game id
 * (games.external_id) — finals carry no duplicate-pair ambiguity, so a game is
 * only updated on a clean 1:1 id match. Games BDL reports as final but that we
 * never seeded are reported `unmatched` (never invented). Grading reads these
 * finals; a game without a clean mapping is never graded.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isRealWnbaTeam } from "./wnbaTeams";

const BDL = "https://api.balldontlie.io/wnba/v1";

export type IngestWnbaScoresResult = {
  apply: boolean;
  finalsFound: number;
  matched: number;
  updated: number;
  alreadyFinal: number;
  unmatched: number;
  perGame: Array<{ external_id: number; home_score: number | null; away_score: number | null; action: string }>;
  errors: string[];
};

export async function ingestWnbaFinalScores(opts: {
  supabase: SupabaseClient;
  apply: boolean;
  lookbackDays?: number;
  logger?: (m: string) => void;
}): Promise<IngestWnbaScoresResult> {
  const { supabase, apply, lookbackDays = 2, logger = () => {} } = opts;
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("missing BALLDONTLIE_API_KEY");
  const errors: string[] = [];

  const dates: string[] = [];
  for (let n = -lookbackDays; n <= 1; n++) dates.push(new Date(Date.now() + n * 86400000).toISOString().slice(0, 10));
  const qs = dates.map((d) => `dates[]=${d}`).join("&");
  const raw: Record<string, unknown>[] = [];
  let cursor: number | undefined;
  for (let p = 0; p < 6; p++) {
    const r = await fetch(`${BDL}/games?${qs}&per_page=100${cursor ? `&cursor=${cursor}` : ""}`, { headers: { Authorization: key } });
    if (!r.ok) throw new Error(`BDL games HTTP ${r.status}`);
    const j = (await r.json()) as { data?: Record<string, unknown>[]; meta?: { next_cursor?: number } };
    raw.push(...(j.data ?? []));
    cursor = j.meta?.next_cursor;
    if (!cursor) break;
  }
  const finals = raw.filter((g) => {
    const h = (g.home_team as { id: number } | undefined)?.id, a = (g.visitor_team as { id: number } | undefined)?.id;
    return ["post", "final"].includes(String(g.status).toLowerCase()) && h != null && a != null && isRealWnbaTeam(h) && isRealWnbaTeam(a);
  });

  const extIds = finals.map((g) => g.id as number);
  const { data: dbGames } = extIds.length
    ? await supabase.from("games").select("id, external_id, status, home_score, away_score").eq("sport", "wnba").in("external_id", extIds)
    : { data: [] as Record<string, unknown>[] };
  const byExt = new Map((dbGames ?? []).map((g) => [g.external_id as number, g]));

  const result: IngestWnbaScoresResult = { apply, finalsFound: finals.length, matched: 0, updated: 0, alreadyFinal: 0, unmatched: 0, perGame: [], errors };
  for (const g of finals) {
    const db = byExt.get(g.id as number) as { id: number; status: string; home_score: number | null; away_score: number | null } | undefined;
    const hs = typeof g.home_score === "number" ? g.home_score : null;
    const as = typeof g.away_score === "number" ? g.away_score : null;
    if (!db) { result.unmatched++; result.perGame.push({ external_id: g.id as number, home_score: hs, away_score: as, action: "unmatched (not seeded — skip)" }); continue; }
    result.matched++;
    if (db.status === "final" && db.home_score === hs && db.away_score === as) {
      result.alreadyFinal++;
      result.perGame.push({ external_id: g.id as number, home_score: hs, away_score: as, action: "already final" });
      continue;
    }
    result.perGame.push({ external_id: g.id as number, home_score: hs, away_score: as, action: apply ? "updated" : "would update" });
    if (apply) {
      const { error } = await supabase.from("games").update({ status: "final", home_score: hs, away_score: as }).eq("id", db.id).eq("sport", "wnba");
      if (error) errors.push(`game ${g.id}: ${error.message}`);
      else result.updated++;
    }
  }
  logger(`wnba scores: finals ${finals.length}, matched ${result.matched}, ${apply ? "updated " + result.updated : "would-update " + result.perGame.filter((p) => p.action.includes("update")).length}, unmatched ${result.unmatched}, alreadyFinal ${result.alreadyFinal}`);
  return result;
}
