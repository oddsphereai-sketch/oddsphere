/** Manual SELECT-only enrichment. No sports-provider calls or production writes. */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import { decodeMlbPropsBoardSnapshot, loadMlbPropsGameLocks } from "../../lib/mlb/props/boardSnapshotStore";
const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
async function main() {
  const input = arg("input"), out = arg("out"); if (!input || !out || !out.startsWith("/private/tmp/")) throw new Error("--input=LOCAL_EXPORT --out=/private/tmp/NEW_EXPORT required");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const [nflHistory, nbaCatalog, mlbIndex] = await Promise.all([
    readNflPlayerPropsCurrentSeasonState({ client, season: 2026 }),
    client.from("lab_response_snapshots").select("snapshot_key,kind,generated_at").eq("sport", "nba").order("generated_at", { ascending: false }).limit(101),
    client.from("admin_audit_log").select("target_id,after_state,created_at").eq("action_type", "mlb_props.board_snapshot_published").gte("created_at", "2026-09-01").order("created_at", { ascending: false }).limit(1000),
  ]);
  if (nbaCatalog.error || mlbIndex.error) throw new Error(nbaCatalog.error?.message ?? mlbIndex.error?.message);
  const byDate = new Map<string, { id: string; date: string }>();
  for (const row of mlbIndex.data ?? []) {
    const date = row.after_state?.slate_date;
    if (date && !byDate.has(date)) byDate.set(date, { id: String(row.target_id), date });
  }
  const chosen = [...byDate.values()].filter((_, i, all) => i < 4 || i === all.length - 1);
  const mlb = await Promise.all(chosen.map(async item => {
    const result = await client.from("prop_scoring_runs").select("metadata_json").eq("id", item.id).single();
    if (result.error) throw result.error;
    return { date: item.date, snapshot: decodeMlbPropsBoardSnapshot(result.data.metadata_json) };
  }));
  const mlbLocked = [];
  for (const item of chosen) {
    const locks = await loadMlbPropsGameLocks(item.date);
    const unique = [...new Map(locks.map(l => [l.board_snapshot_id, l])).values()].slice(0, 3);
    for (const lock of unique) {
      const ref = await client.from("admin_audit_log").select("target_id").eq("action_type", "mlb_props.board_snapshot_published").contains("after_state", { snapshot_id: lock.board_snapshot_id, slate_date: item.date }).limit(2);
      if (ref.error) throw ref.error;
      const id = ref.data?.[0]?.target_id; if (!id) continue;
      const result = await client.from("prop_scoring_runs").select("metadata_json").eq("id", id).single();
      if (result.error) throw result.error;
      const snapshot = decodeMlbPropsBoardSnapshot(result.data.metadata_json);
      if (snapshot) mlbLocked.push({ date: item.date, lock, snapshot });
    }
  }
  const nbaKeys = (nbaCatalog.data ?? []).filter(r => /current-only::live-copy/.test(r.snapshot_key)).slice(0, 2).map(r => r.snapshot_key);
  const nbaContext = nbaKeys.length ? await client.from("lab_response_snapshots").select("snapshot_key,payload,generated_at").in("snapshot_key", nbaKeys) : { data: [], error: null };
  if (nbaContext.error) throw nbaContext.error;
  const source = JSON.parse(readFileSync(input, "utf8"));
  writeFileSync(out, JSON.stringify({ ...source, enrichmentGeneratedAt: new Date().toISOString(), nflHistory, mlb, mlbLocked, nbaContext: nbaContext.data, sourceCatalog: { nba: nbaCatalog.data, mlbDates: [...byDate.keys()], mlbIndexTruncated: mlbIndex.data?.length === 1000 }, providerCalls: 0, productionWrites: 0 }), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ out, nflGames: nflHistory?.games.length ?? 0, nflPlayerLogs: nflHistory?.stats.length ?? 0, nbaContextRows: nbaContext.data?.length ?? 0, mlbLockedSources: mlbLocked.length, mlb: mlb.map(m => ({ date: m.date, games: m.snapshot?.data.summary.gamesWithProps, props: m.snapshot?.data.props.length, researchPlayers: Object.keys(m.snapshot?.data.research ?? {}).length })), mlbDatesAvailable: byDate.size }));
}
void main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
