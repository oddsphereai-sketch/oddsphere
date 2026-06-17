/**
 * Read-only: hunt the SEA@BAL home probable starter from every
 * provider/source already integrated in this project. No new
 * dependencies. No DB writes.
 *
 * Sources to probe:
 *   1. MLB Stats API (re-confirm; already known empty)
 *   2. BDL (BallDontLie) — already integrated for slates/lines
 *   3. SharpAPI — already integrated for splits/odds
 *   4. lines table — sometimes the book carries pitcher name in metadata
 *   5. line_history — earlier snapshot may have had a starter
 *   6. Any cached pre-existing players row for BAL with role=SP from sometime today
 */
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const SEABAL_EXT = "5058755";
const SEABAL_GAMEPK = 824829;
const BAL_TEAM_ID_DB = 754;

async function main() {
  console.log(`\n═══ SEA@BAL alt-starter hunt ═══\n`);

  // ── 1. MLB Stats authoritative (already known empty, re-confirm)
  console.log("1) MLB Stats /schedule?date=2026-06-08 — home probable:");
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-06-08&hydrate=probablePitcher`);
    const j: any = await r.json();
    const g = j?.dates?.[0]?.games?.find((x: any) => x.gamePk === SEABAL_GAMEPK);
    const hp = g?.teams?.home?.probablePitcher;
    console.log(`   ${hp ? `id=${hp.id} ${hp.fullName}` : "EMPTY"}`);
  } catch (e) { console.log(`   error: ${(e as Error).message}`); }

  // ── 2. BDL — search for any pre-game / starter data
  console.log("\n2) BDL /games?game_ids=" + SEABAL_EXT);
  try {
    const apiKey = process.env.BDL_API_KEY;
    if (!apiKey) { console.log("   BDL_API_KEY not set — skipping"); }
    else {
      const r = await fetch(`https://api.balldontlie.io/mlb/v1/games?game_ids[]=${SEABAL_EXT}`, {
        headers: { Authorization: apiKey },
      });
      const j: any = await r.json();
      const g = j?.data?.[0];
      if (!g) console.log("   no game returned");
      else {
        console.log(`   home_team=${g.home_team?.abbreviation}  away_team=${g.away_team?.abbreviation}`);
        // BDL games endpoint typically does NOT include probable pitchers
        // but try alternate keys defensively.
        const possibleKeys = ["home_probable_pitcher", "home_starting_pitcher", "home_pitcher", "starting_pitcher_home"];
        let found = false;
        for (const k of possibleKeys) {
          if ((g as any)[k]) { console.log(`   ${k}: ${JSON.stringify((g as any)[k])}`); found = true; }
        }
        if (!found) console.log("   no home-pitcher field in BDL games response");
      }
    }
  } catch (e) { console.log(`   error: ${(e as Error).message}`); }

  // ── 3. SharpAPI — has it ever surfaced starter info?
  console.log("\n3) SharpAPI — searching player_props for game (starter strikeouts indicator):");
  try {
    const apiKey = process.env.SHARP_API_KEY;
    if (!apiKey) { console.log("   SHARP_API_KEY not set — skipping"); }
    else {
      // SharpAPI doesn't typically return probable starters directly; player_props on the game would imply one.
      // This is a best-effort probe.
      const r = await fetch(`https://api.sharp.app/v1/opportunities?league=MLB&date=2026-06-08`, {
        headers: { "x-api-key": apiKey },
      });
      const j: any = await r.json();
      const events = j?.data ?? [];
      console.log(`   SharpAPI returned ${events.length} MLB events for today`);
      // Look for an event matching SEA@BAL
      const match = events.find((e: any) => {
        const txt = JSON.stringify(e).toLowerCase();
        return txt.includes("baltimore") || txt.includes("orioles");
      });
      if (match) {
        console.log(`   found BAL event — keys: ${Object.keys(match).slice(0, 20).join(", ")}`);
      } else {
        console.log("   no BAL event found in opportunities");
      }
    }
  } catch (e) { console.log(`   error: ${(e as Error).message}`); }

  // ── 4. lines table — see if pitcher info ever flowed through
  console.log("\n4) lines table — search for BAL-related player_id rows (player_props for starter):");
  const { data: gameLines } = await sb.from("lines").select("market_type, player_id, sportsbook").eq("game_id", 14948);
  const playerProps = (gameLines ?? []).filter((l: any) => l.player_id !== null);
  console.log(`   total lines for game: ${gameLines?.length ?? 0}, with player_id: ${playerProps.length}`);
  if (playerProps.length > 0) {
    const distinctPlayers = new Set(playerProps.map((p: any) => p.player_id));
    console.log(`   distinct player_ids on this game: ${Array.from(distinctPlayers).join(", ")}`);
  }

  // ── 5. line_history — any earlier snapshot with starter info?
  console.log("\n5) line_history — pitcher-strikeout/player-prop markets seen today:");
  const { data: hist } = await sb.from("line_history").select("market_type, player_id, recorded_at").eq("game_id", 14948).not("player_id", "is", null).limit(10);
  console.log(`   ${(hist ?? []).length} rows with player_id`);

  // ── 6. players table — any active BAL SP recently used
  console.log("\n6) players table — BAL pitchers seen in pitcher_season_stats recently:");
  const { data: balPitchers } = await sb.from("players")
    .select("id, full_name, primary_position, team_id, mlb_id")
    .eq("team_id", BAL_TEAM_ID_DB)
    .in("primary_position", ["P", "SP"]).limit(20);
  console.log(`   ${(balPitchers ?? []).length} pitchers on BAL roster in DB`);
  for (const p of (balPitchers ?? []).slice(0, 5) as any[]) {
    console.log(`      ${p.full_name}  pos=${p.primary_position}  mlb_id=${p.mlb_id}`);
  }

  // ── 7. Cross-check the away pitcher just to confirm method works
  console.log("\n7) Cross-check: SEA away_pitcher_id=14303 → who is this in players table?");
  const { data: seaP } = await sb.from("players").select("id, full_name, mlb_id, team_id").eq("id", 14303).maybeSingle();
  console.log(`   ${seaP ? `${(seaP as any).full_name} (mlb_id=${(seaP as any).mlb_id}, team_id=${(seaP as any).team_id})` : "missing"}`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
