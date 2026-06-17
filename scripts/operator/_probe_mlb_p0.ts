/** P0 read-only audit: MLB for 2026-06-12 ET sports-day. */
import { supabase } from "../../lib/db/supabase";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function main(): Promise<void> {
  const today = etToday();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  })();
  console.log(`=== ET today: ${today}  |  yesterday: ${yesterday} ===\n`);

  // MLB games today (slate_date and game_date views).
  const { data: gamesBySlate } = await supabase
    .from("games")
    .select("id, external_id, status, slate_date, game_date, home_team_id, away_team_id")
    .eq("sport", "mlb")
    .eq("slate_date", today)
    .order("game_date", { ascending: true });
  console.log(`MLB games where slate_date='${today}': ${(gamesBySlate ?? []).length}`);
  for (const g of (gamesBySlate ?? []) as any[]) {
    console.log(`  id=${g.id} ext=${g.external_id} status=${g.status} game_date=${g.game_date}`);
  }

  // Yesterday for contrast
  const { data: gamesYesterday } = await supabase
    .from("games")
    .select("id, slate_date, status")
    .eq("sport", "mlb")
    .eq("slate_date", yesterday);
  console.log(`\nMLB games where slate_date='${yesterday}': ${(gamesYesterday ?? []).length}`);

  // Look broader: any MLB game with game_date in last 36h (UTC) or next 36h (UTC)
  const nowMs = Date.now();
  const nearStart = new Date(nowMs - 36 * 3600_000).toISOString();
  const nearEnd = new Date(nowMs + 36 * 3600_000).toISOString();
  const { data: gamesNear } = await supabase
    .from("games")
    .select("id, sport, status, slate_date, game_date")
    .eq("sport", "mlb")
    .gte("game_date", nearStart)
    .lte("game_date", nearEnd)
    .order("game_date", { ascending: true });
  console.log(`\nMLB games where game_date in next±36h: ${(gamesNear ?? []).length}`);
  const slateCount = new Map<string, number>();
  for (const g of (gamesNear ?? []) as any[]) {
    slateCount.set(g.slate_date, (slateCount.get(g.slate_date) ?? 0) + 1);
  }
  for (const [sd, n] of slateCount) console.log(`  slate_date=${sd}: ${n} games`);

  const todayGameIds = (gamesBySlate ?? []).map((g: any) => g.id);

  // prediction_records today (sport=mlb, slate_date=today)
  const { count: prCount } = await supabase
    .from("prediction_records")
    .select("id", { count: "exact", head: true })
    .eq("sport", "mlb")
    .eq("slate_date", today);
  console.log(`\nMLB prediction_records slate_date=${today}: ${prCount ?? 0}`);

  // pred records by game (so we see which games have predictions and which don't)
  if (todayGameIds.length > 0) {
    const { data: prByGame } = await supabase
      .from("prediction_records")
      .select("game_id, market, locked_at, computed_at")
      .eq("sport", "mlb")
      .in("game_id", todayGameIds);
    const prGameMap = new Map<number, any[]>();
    for (const p of (prByGame ?? []) as any[]) {
      if (!prGameMap.has(p.game_id)) prGameMap.set(p.game_id, []);
      prGameMap.get(p.game_id)!.push(p);
    }
    console.log(`MLB prediction_records by game (today):`);
    for (const gid of todayGameIds) {
      const rows = prGameMap.get(gid) ?? [];
      const markets = rows.map((r: any) => r.market).join(",");
      console.log(`  game=${gid}: ${rows.length} rows [${markets}]`);
    }
  }

  // lines + line_history for today's MLB games
  if (todayGameIds.length > 0) {
    const { count: linesCount } = await supabase
      .from("lines")
      .select("id", { count: "exact", head: true })
      .in("game_id", todayGameIds);
    const { count: lineHistCount } = await supabase
      .from("line_history")
      .select("id", { count: "exact", head: true })
      .in("game_id", todayGameIds);
    console.log(`\nMLB lines (today's games): ${linesCount ?? 0}`);
    console.log(`MLB line_history (today's games): ${lineHistCount ?? 0}`);
  }

  // slate_state
  const { data: slateRows } = await supabase
    .from("slate_state")
    .select("slate_date, sport, status, last_publish_at, last_refresh_at")
    .eq("slate_date", today);
  console.log(`\nslate_state rows for ${today}:`);
  for (const s of (slateRows ?? []) as any[]) {
    console.log(`  sport=${s.sport} status=${s.status} publish=${s.last_publish_at} refresh=${s.last_refresh_at}`);
  }

  // data_refresh_log — last 24h
  const since = new Date(nowMs - 24 * 3600_000).toISOString();
  const { data: refreshLog } = await supabase
    .from("data_refresh_log")
    .select("id, refresh_type, refresh_status, sport, records_updated, started_at, completed_at, details")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(40);
  console.log(`\ndata_refresh_log entries last 24h: ${(refreshLog ?? []).length}`);
  for (const r of (refreshLog ?? []) as any[]) {
    const reasonOrErr =
      typeof r.details === "object" && r.details !== null
        ? (r.details.error ?? r.details.outcome ?? r.details.reason ?? "")
        : "";
    console.log(
      `  ${r.started_at}  ${r.refresh_type} sport=${r.sport ?? "(none)"} status=${r.refresh_status} updated=${r.records_updated ?? 0}  ${reasonOrErr}`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
