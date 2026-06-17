/**
 * Read-only WC slate probe.
 *
 *   • DB: list soccer games + prediction_records for slate_date=today (ET)
 *     and slate_date=tomorrow (UTC) so we can see where CZE@KOR actually landed.
 *   • BDL: list FIFA fixtures whose kickoff falls in the next 36 h UTC, so we
 *     can see what the seed call would pick up if it used correct ET windowing.
 *
 * No writes. Safe to run anytime.
 */
import { supabase } from "../../lib/db/supabase";
import { BallDontLieFifaProvider } from "../../lib/providers/real_api/BallDontLieFifaProvider";
import { BdlFifaClient } from "../../lib/providers/real_api/_bdlFifaClient";

function etYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function etTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

async function main(): Promise<void> {
  const now = new Date();
  const todayEt = etYmd(now);
  const tomorrowEt = etYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  console.log(`now (UTC):           ${now.toISOString()}`);
  console.log(`today's slate (ET):  ${todayEt}`);
  console.log(`tomorrow's slate ET: ${tomorrowEt}`);

  // ============================================================
  // SECTION 1 — Internal DB state
  // ============================================================
  console.log("\n========== DB games (sport='soccer') for both ET dates ==========");
  for (const sd of [todayEt, tomorrowEt]) {
    const { data: games, error } = await supabase
      .from("games")
      .select("id, external_id, slate_date, game_date, status, home_team_id, away_team_id")
      .eq("sport", "soccer")
      .eq("slate_date", sd);
    if (error) {
      console.log(`  ERR slate=${sd}: ${error.message}`);
      continue;
    }
    const list = (games ?? []) as Array<{
      id: number; external_id: number; slate_date: string; game_date: string; status: string | null;
      home_team_id: number | null; away_team_id: number | null;
    }>;
    console.log(`  slate=${sd}: ${list.length} games`);
    for (const g of list) {
      console.log(
        `    id=${g.id} ext=${g.external_id} status=${g.status ?? "?"} game_date=${g.game_date} ` +
          `(ET ${etTime(new Date(g.game_date))}) home_team_id=${g.home_team_id} away=${g.away_team_id}`,
      );
    }
  }

  console.log("\n========== DB prediction_records (sport='soccer') for both ET dates ==========");
  for (const sd of [todayEt, tomorrowEt]) {
    const { data: recs } = await supabase
      .from("prediction_records")
      .select("id, game_id, market, pick, side, line_value, odds_american, confidence, model_probability, market_probability, edge, play_grade, held, hold_reason, locked_at, no_bet, snapshot_json")
      .eq("sport", "soccer")
      .eq("slate_date", sd);
    const list = (recs ?? []) as Array<Record<string, unknown>>;
    console.log(`  slate=${sd}: ${list.length} rows`);
    for (const r of list) {
      const sj = r.snapshot_json as Record<string, unknown> | null;
      const comp = sj === null ? "?" : ((sj as { competition?: string }).competition ?? "(no stamp)");
      console.log(
        `    pr.id=${r.id} game_id=${r.game_id} market=${r.market} pick=${r.pick}` +
          ` held=${r.held} no_bet=${r.no_bet} graded=${r.play_grade ?? "n/a"} locked_at=${r.locked_at ?? "null"}` +
          ` model=${r.model_probability} mkt=${r.market_probability} odds=${r.odds_american}` +
          ` competition=${comp}`,
      );
    }
  }

  console.log("\n========== DB teams (sport='soccer') ==========");
  const { data: teams } = await supabase
    .from("teams")
    .select("id, external_id, abbreviation, display_name, location, logo_url")
    .eq("sport", "soccer");
  const teamList = (teams ?? []) as Array<{
    id: number; external_id: number; abbreviation: string; display_name: string | null;
    location: string | null; logo_url: string | null;
  }>;
  console.log(`  ${teamList.length} soccer teams`);
  for (const t of teamList) {
    console.log(
      `    id=${t.id} ext=${t.external_id} abbr=${t.abbreviation} name="${t.display_name}" loc=${t.location} logo_url=${t.logo_url ?? "null"}`,
    );
  }

  // ============================================================
  // SECTION 2 — BDL truth (what the seed WOULD see with correct logic)
  // ============================================================
  console.log("\n========== BDL FIFA fixtures in the next 36 h UTC ==========");
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  if (bdlKey === undefined || bdlKey === "") {
    console.log("  BALLDONTLIE_API_KEY missing — skipping BDL probe");
    return;
  }
  const provider = new BallDontLieFifaProvider(new BdlFifaClient(bdlKey));
  const allMatches = await provider.listMatches({ per_page: 25 });
  const horizonMs = now.getTime() + 36 * 60 * 60 * 1000;
  const upcoming = allMatches
    .filter((m) => {
      const t = new Date(m.datetime).getTime();
      return t >= now.getTime() - 6 * 60 * 60 * 1000 && t <= horizonMs;
    })
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  console.log(`  BDL total fixtures: ${allMatches.length}`);
  console.log(`  in -6h..+36h window: ${upcoming.length}`);
  for (const m of upcoming) {
    const d = new Date(m.datetime);
    const etDate = etYmd(d);
    const etTm = etTime(d);
    const isBugged = `${m.datetime}`.slice(0, 10) !== etDate;
    console.log(
      `    bdl=${m.provider_match_id} ${m.away_team_abbr} @ ${m.home_team_abbr} ` +
        `kickoff_UTC=${m.datetime} (ET ${etDate} ${etTm}) status=${m.status} ` +
        `stage="${m.stage_name ?? ""}"` +
        (isBugged ? `  ← UTC prefix=${`${m.datetime}`.slice(0, 10)} ≠ ET ${etDate}` : ""),
    );
  }

  // ============================================================
  // SECTION 3 — Buggy-vs-correct filter comparison
  // ============================================================
  console.log("\n========== Slate-date filter: BUGGY (UTC prefix) vs CORRECT (ET sports-day) ==========");
  for (const sd of [todayEt, tomorrowEt]) {
    const buggyHits = allMatches.filter((m) => `${m.datetime}`.startsWith(sd));
    const correctHits = allMatches.filter((m) => etYmd(new Date(m.datetime)) === sd);
    console.log(`  slate=${sd}`);
    console.log(`    BUGGY (UTC prefix):     ${buggyHits.length} hits — ${buggyHits.map((m) => `${m.away_team_abbr}@${m.home_team_abbr}`).join(", ")}`);
    console.log(`    CORRECT (ET sports-day): ${correctHits.length} hits — ${correctHits.map((m) => `${m.away_team_abbr}@${m.home_team_abbr}`).join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
