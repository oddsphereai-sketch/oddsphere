/** SELECT-only preparation of current day-of evidence; no sports-provider calls or prediction writes. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readNbaPlayerPropsMarketHistory, readNbaPlayerPropsPrivateSnapshot } from "../../lib/services/nba/nbaPlayerPropsPrivateStore";
import { fromCachedExport } from "./adapters";
import { enrichCachedPacket, type EnrichedSource } from "./enrichment";
import { compileMarketReport } from "./market-report";
import { etDate, instant, invariant } from "./core";
const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
async function main() {
  const input = arg("input"), gameId = arg("game"), out = arg("out"); invariant(input && gameId && out && out.startsWith("/private/tmp/"), "--input=EXPORT --game=ID_OR_all --out=/private/tmp/NEW_FILE_OR_DIRECTORY required");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date().toISOString(), date = etDate(now);
  const [snapshot, market, context] = await Promise.all([
    readNbaPlayerPropsPrivateSnapshot({ client, slateDate: date }), readNbaPlayerPropsMarketHistory({ client, slateDate: date }),
    client.from("lab_response_snapshots").select("generated_at,payload").eq("snapshot_key", `nba::${date}::current-only::live-copy`).maybeSingle(),
  ]);
  if (context.error) throw context.error;
  invariant(snapshot && market, "Current NBA source snapshot/market history missing");
  const source = JSON.parse(readFileSync(input, "utf8")) as EnrichedSource;
  source.nba = [{ date, snapshot, market }]; source.generatedAt = now;
  if (context.data) source.nbaContext = [context.data as NonNullable<EnrichedSource["nbaContext"]>[number]];
  const selected = fromCachedExport(source).packets.filter(p => (gameId === "all" || p.gameId === gameId) && p.stage === "final" && etDate(p.start) === date && instant(now) < instant(p.lock)); invariant(selected.length, "Target unlocked games missing");
  const prepared = [];
  for (const raw of selected) {
  const enriched = enrichCachedPacket(raw, source);
  const packet = compileMarketReport({ ...enriched, cutoff: now, players: enriched.players.map(p => ({ ...p, evidence: p.evidence.filter(e => instant(e.availableAt) <= instant(now)) })), quotes: enriched.quotes.filter(q => instant(q.receivedAt) <= instant(now)),
    sourceLimitations: [...enriched.sourceLimitations, "manual prospective day-of evaluation; actual current source/issue timestamps, not a production lock review"] });
  const file = gameId === "all" ? `${out}/${packet.gameId.replace(/[^a-z0-9-]/gi, "_")}.json` : out;
  mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true, mode: 0o700 }); writeFileSync(file, JSON.stringify(packet), { mode: 0o600, flag: "wx" });
  prepared.push({ file, gameId: packet.gameId, players: packet.players.length, scopes: packet.players.reduce((n, p) => n + p.markets.length, 0) });
  }
  if (gameId === "all") writeFileSync(`${out}/manifest.json`, JSON.stringify({ cutoff: now, sourceGeneratedAt: snapshot.generatedAt, prepared }), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ out, cutoff: now, sourceGeneratedAt: snapshot.generatedAt, games: prepared.length, players: prepared.reduce((n, p) => n + p.players, 0), scopes: prepared.reduce((n, p) => n + p.scopes, 0), providerCalls: 0, productionWrites: 0 }));
}
void main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
