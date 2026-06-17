/**
 * Read-only slate health audit for today.
 * Pulls: games, game_predictions, prediction_records, lines, sharp_signals,
 * teams. Compares to MLB Stats API official schedule.
 */
import { createClient } from "@supabase/supabase-js";

const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  console.log(`\n═══════ Slate health audit · slate_date=${ET_TODAY} ═══════\n`);

  // ─── 1. MLB Stats official schedule (authoritative)
  const mlbUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${ET_TODAY}`;
  let mlbGames: Array<{ gamePk: number; home: string; away: string; venue: string; gameDate: string; status: string }> = [];
  try {
    const r = await fetch(mlbUrl);
    const j: any = await r.json();
    const dates = j?.dates ?? [];
    for (const d of dates) {
      for (const g of d.games ?? []) {
        mlbGames.push({
          gamePk: g.gamePk,
          home: g.teams?.home?.team?.name ?? "?",
          away: g.teams?.away?.team?.name ?? "?",
          venue: g.venue?.name ?? "?",
          gameDate: g.gameDate ?? "?",
          status: g.status?.detailedState ?? "?",
        });
      }
    }
  } catch (e) {
    console.error("MLB Stats fetch failed:", (e as Error).message);
  }
  console.log(`1) MLB Stats API official schedule — ${mlbGames.length} games today (ET ${ET_TODAY})`);
  for (const g of mlbGames) {
    console.log(`   gamePk=${g.gamePk}  ${g.away} @ ${g.home}   ${g.gameDate}  ${g.status}  (${g.venue})`);
  }

  // ─── 2. Our DB slate
  const { data: games } = await sb
    .from("games")
    .select("id, external_id, status, game_date, slate_status, home_team_id, away_team_id")
    .eq("sport", "mlb").eq("slate_date", ET_TODAY).order("id");
  const teamIds = new Set<number>();
  for (const g of games ?? []) { teamIds.add((g as any).home_team_id); teamIds.add((g as any).away_team_id); }
  const { data: teams } = await sb.from("teams").select("id, abbreviation, name").in("id", Array.from(teamIds));
  const teamAbbr = new Map<number, string>((teams ?? []).map((t: any) => [t.id, t.abbreviation]));
  const teamName = new Map<number, string>((teams ?? []).map((t: any) => [t.id, t.name]));

  console.log(`\n2) DB games table — ${games?.length ?? 0} rows for slate_date=${ET_TODAY}`);
  for (const g of (games ?? []) as any[]) {
    const at = teamAbbr.get(g.away_team_id) ?? "?";
    const ht = teamAbbr.get(g.home_team_id) ?? "?";
    console.log(`   id=${g.id} ext=${g.external_id} ${at}@${ht}  ${g.game_date?.slice(0,19)}  status="${g.status}"  slate_status="${g.slate_status}"`);
  }

  // ─── 3. game_predictions
  const ids = (games ?? []).map((g: any) => g.id);
  const { data: preds } = await sb
    .from("game_predictions")
    .select("id, game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, locked_at, computed_at, prediction_source, ml_grade, ou_grade, nrfi_grade")
    .in("game_id", ids.length > 0 ? ids : [-1]);
  console.log(`\n3) game_predictions — ${preds?.length ?? 0} rows`);
  const predByGame = new Map<number, any>((preds ?? []).map((p: any) => [p.game_id, p]));
  for (const g of (games ?? []) as any[]) {
    const p = predByGame.get(g.id);
    const at = teamAbbr.get(g.away_team_id) ?? "?";
    const ht = teamAbbr.get(g.home_team_id) ?? "?";
    if (!p) {
      console.log(`   ${at}@${ht}  game_id=${g.id}  NO PREDICTION ROW`);
    } else {
      console.log(`   ${at}@${ht}  game_id=${g.id}  ml=${p.predicted_ml_winner}/${p.ml_confidence}%  ou=${p.predicted_ou_side}/${p.ou_confidence}%  nrfi=${p.predicted_nrfi}  locked=${p.locked_at?.slice(11,19) ?? "no"}  src=${p.prediction_source}`);
    }
  }

  // ─── 4. prediction_records
  const { data: recs } = await sb
    .from("prediction_records")
    .select("id, game_id, market, pick, locked_at, no_bet, play_grade, best_angle")
    .eq("sport", "mlb").eq("slate_date", ET_TODAY).order("game_id").order("market");
  console.log(`\n4) prediction_records — ${recs?.length ?? 0} rows`);
  const recsByGame = new Map<number, any[]>();
  for (const r of (recs ?? []) as any[]) {
    const arr = recsByGame.get(r.game_id) ?? [];
    arr.push(r);
    recsByGame.set(r.game_id, arr);
  }
  for (const g of (games ?? []) as any[]) {
    const at = teamAbbr.get(g.away_team_id) ?? "?";
    const ht = teamAbbr.get(g.home_team_id) ?? "?";
    const list = recsByGame.get(g.id) ?? [];
    const ml = list.find((r) => r.market === "moneyline");
    const ou = list.find((r) => r.market === "total");
    const fi = list.find((r) => r.market === "first_inning");
    console.log(`   ${at}@${ht}  ML=${ml ? `rec${ml.id}/${ml.pick}/locked=${!!ml.locked_at}` : "MISSING"}  OU=${ou ? `rec${ou.id}/${ou.pick}/locked=${!!ou.locked_at}` : "MISSING"}  FI=${fi ? `rec${fi.id}/${fi.pick}` : "MISSING"}`);
  }

  // ─── 5. MLB vs DB cross-reference
  console.log(`\n5) MLB Stats ↔ DB cross-reference:`);
  const dbExternalIds = new Set((games ?? []).map((g: any) => String(g.external_id)));
  const mlbGamePks = new Set(mlbGames.map((g) => String(g.gamePk)));
  const missingFromDb = mlbGames.filter((m) => !dbExternalIds.has(String(m.gamePk)));
  const extraInDb = (games ?? []).filter((g: any) => !mlbGamePks.has(String(g.external_id)));
  console.log(`   MLB official: ${mlbGames.length}   DB games: ${games?.length ?? 0}`);
  console.log(`   In MLB but missing from DB: ${missingFromDb.length}`);
  for (const m of missingFromDb) console.log(`      MISSING: gamePk=${m.gamePk}  ${m.away} @ ${m.home}  ${m.gameDate}  status="${m.status}"`);
  console.log(`   In DB but not in MLB official: ${extraInDb.length}`);
  for (const g of extraInDb as any[]) console.log(`      EXTRA: id=${g.id} ext=${g.external_id} ${teamAbbr.get(g.away_team_id)}@${teamAbbr.get(g.home_team_id)}`);

  // ─── 6. Look for SEA / BAL specifically
  console.log(`\n6) SEA/BAL probe:`);
  const seaBalMlb = mlbGames.find((m) =>
    /sea|seattle/i.test(`${m.home} ${m.away}`) && /bal|baltimore/i.test(`${m.home} ${m.away}`)
  );
  console.log(`   MLB Stats has SEA/BAL? ${seaBalMlb ? `YES  gamePk=${seaBalMlb.gamePk} ${seaBalMlb.away}@${seaBalMlb.home} ${seaBalMlb.gameDate} (${seaBalMlb.status})` : "NO"}`);
  const seaBalDb = (games ?? []).find((g: any) => {
    const at = teamAbbr.get(g.away_team_id) ?? "";
    const ht = teamAbbr.get(g.home_team_id) ?? "";
    return /SEA|BAL/.test(at) && /SEA|BAL/.test(ht);
  });
  console.log(`   DB games has SEA/BAL? ${seaBalDb ? `YES  id=${(seaBalDb as any).id} ext=${(seaBalDb as any).external_id}` : "NO"}`);

  // ─── 7. Lines coverage per game
  console.log(`\n7) Lines coverage (per game, per market, count of non-null odds rows):`);
  if (ids.length > 0) {
    const { data: lineRows } = await sb
      .from("lines")
      .select("game_id, market_type, side, sportsbook, odds_american")
      .in("game_id", ids).in("market_type", ["moneyline", "total", "first_inning_total"])
      .is("player_id", null);
    const lineGrp = new Map<string, number>();
    for (const l of (lineRows ?? []) as any[]) {
      if (l.odds_american === null) continue;
      const k = `${l.game_id}::${l.market_type}`;
      lineGrp.set(k, (lineGrp.get(k) ?? 0) + 1);
    }
    for (const g of (games ?? []) as any[]) {
      const at = teamAbbr.get(g.away_team_id) ?? "?";
      const ht = teamAbbr.get(g.home_team_id) ?? "?";
      console.log(`   ${at}@${ht}  ml_books=${lineGrp.get(`${g.id}::moneyline`) ?? 0}  ou_books=${lineGrp.get(`${g.id}::total`) ?? 0}  fi_books=${lineGrp.get(`${g.id}::first_inning_total`) ?? 0}`);
    }
  }

  // ─── 8. Sharp signals coverage
  console.log(`\n8) Sharp signals coverage (per game, count of rows):`);
  if (ids.length > 0) {
    const { data: sigRows } = await sb.from("sharp_signals").select("game_id").in("game_id", ids);
    const sigByGame = new Map<number, number>();
    for (const s of (sigRows ?? []) as any[]) sigByGame.set(s.game_id, (sigByGame.get(s.game_id) ?? 0) + 1);
    for (const g of (games ?? []) as any[]) {
      const at = teamAbbr.get(g.away_team_id) ?? "?";
      const ht = teamAbbr.get(g.home_team_id) ?? "?";
      console.log(`   ${at}@${ht}  signals=${sigByGame.get(g.id) ?? 0}`);
    }
  }

  // ─── 9. Model version audit
  console.log(`\n9) Model version audit (per game prediction, sport_specific.model_version):`);
  const { data: predsFull } = await sb
    .from("game_predictions")
    .select("game_id, sport_specific, prediction_source")
    .in("game_id", ids.length > 0 ? ids : [-1]);
  for (const p of (predsFull ?? []) as any[]) {
    const sp = (p.sport_specific ?? {}) as any;
    const game = (games ?? []).find((g: any) => g.id === p.game_id);
    const at = game ? teamAbbr.get((game as any).away_team_id) : "?";
    const ht = game ? teamAbbr.get((game as any).home_team_id) : "?";
    console.log(`   ${at}@${ht}  model_used=${sp.model_used ?? "?"}  model_version=${sp.model_version ?? "?"}  prediction_source=${p.prediction_source ?? "?"}  v2_2_audit=${!!sp.v2_2_audit}  fi_v2_audit=${!!sp.fi_v2_audit}`);
  }

  void teamName;
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
