/**
 * Audit line-move data on today's MLB slate.
 * Card shows "Line moved from X to Y" — driven by lineOpenAmerican
 * (from line_history oldest captured) vs priceAmerican (current).
 *
 * If line_history isn't being captured, the card has no "moved from"
 * to compare against → line move section disappears.
 */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const slateDate = new Date().toISOString().split("T")[0];
  console.log(`MLB line-move probe for slate ${slateDate}\n`);

  // 1. Today's MLB games (game ids).
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate);
  const gameIds = (games ?? []).map((g) => (g as { id: number }).id);
  console.log(`MLB games today: ${gameIds.length}`);

  // 2. line_history coverage per (game, market) for ML + Total.
  const { data: lh } = await supabase
    .from("line_history")
    .select("game_id, market_type, sportsbook, side, odds_american, line_value, observed_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"])
    .order("observed_at", { ascending: true });
  const lhRows = (lh ?? []) as Array<{
    game_id: number;
    market_type: string;
    sportsbook: string;
    side: string;
    odds_american: number | null;
    line_value: number | null;
    observed_at: string;
  }>;
  console.log(`line_history rows for today's MLB ML+Total: ${lhRows.length}`);

  // 3. Group by game+market+side and report oldest vs newest per group.
  type Key = string;
  const groups = new Map<Key, typeof lhRows>();
  for (const r of lhRows) {
    const k = `${r.game_id}|${r.market_type}|${r.side}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  console.log(`Distinct (game, market, side) groups in line_history: ${groups.size}\n`);

  // 4. Compare against `lines` current to compute move.
  const { data: linesNow } = await supabase
    .from("lines")
    .select("game_id, market_type, sportsbook, side, odds_american, line_value")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"]);
  const currentByKey = new Map<string, Array<{ sportsbook: string; odds_american: number | null; line_value: number | null }>>();
  for (const r of linesNow ?? []) {
    const k = `${(r as { game_id: number }).game_id}|${(r as { market_type: string }).market_type}|${(r as { side: string }).side}`;
    if (!currentByKey.has(k)) currentByKey.set(k, []);
    currentByKey.get(k)!.push({
      sportsbook: (r as { sportsbook: string }).sportsbook,
      odds_american: (r as { odds_american: number | null }).odds_american,
      line_value: (r as { line_value: number | null }).line_value,
    });
  }
  console.log(`lines (current) rows for today's MLB ML+Total: ${linesNow?.length ?? 0}\n`);

  // 5. For each game, check ML home/away and Total over/under groups.
  for (const gid of gameIds) {
    const groupKeys = [
      `${gid}|moneyline|home`,
      `${gid}|moneyline|away`,
      `${gid}|total|over`,
      `${gid}|total|under`,
    ];
    const summary: string[] = [];
    for (const k of groupKeys) {
      const lhGroup = groups.get(k) ?? [];
      const cur = currentByKey.get(k) ?? [];
      const hasOpen = lhGroup.length > 0;
      const hasNow = cur.length > 0;
      const sideLabel = k.split("|").slice(1).join("/");
      summary.push(
        `${sideLabel}: lh=${lhGroup.length} now=${cur.length}${hasOpen ? "" : " ⚠ no-open"}${hasNow ? "" : " ⚠ no-current"}`,
      );
    }
    console.log(`  game ${gid}:`);
    for (const s of summary) console.log(`    ${s}`);
  }

  // 6. Quick prediction_records snapshot.lines_at_lock check for ML/Total.
  const { data: preds } = await supabase
    .from("prediction_records")
    .select("game_id, market, snapshot_json")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .in("market", ["moneyline", "total"]);
  let withLinesAtLock = 0;
  let withSignalAtLock = 0;
  for (const p of preds ?? []) {
    const sj = (p as { snapshot_json: Record<string, unknown> | null }).snapshot_json;
    if (sj === null) continue;
    const lines = (sj as { lines_at_lock?: unknown[] }).lines_at_lock;
    const sigs = (sj as { signal_rows_at_lock?: unknown[] }).signal_rows_at_lock;
    if (Array.isArray(lines) && lines.length > 0) withLinesAtLock += 1;
    if (Array.isArray(sigs) && sigs.length > 0) withSignalAtLock += 1;
  }
  console.log(`\nprediction_records ML+Total snapshot.lines_at_lock non-empty: ${withLinesAtLock} of ${preds?.length ?? 0}`);
  console.log(`prediction_records ML+Total snapshot.signal_rows_at_lock non-empty: ${withSignalAtLock} of ${preds?.length ?? 0}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
