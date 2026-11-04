import type { SupabaseClient } from "@supabase/supabase-js";
import type { NbaPlayerPropsCurrentState } from "./nbaPlayerPropsCurrentState";
import {
  decodeNbaPlayerPropsPrivatePayload,
  encodeNbaPlayerPropsPrivatePayload,
} from "./nbaPlayerPropsPrivateStore";
import { readNbaPlayerPropsPrivateTracking } from "./nbaPlayerPropsPrivateTrackingStore";
import type { NbaPlayerPropsPrivateTrackingRow } from "./nbaPlayerPropsPrivateTracking";

export const NBA_PLAYER_PROPS_SETTLEMENT_RELEASE =
  "nba_player_props_private_settlement_2026_11_04_r2_bounded_old_slate_catchup" as const;
const LEGACY_SETTLEMENT_RELEASE="nba_player_props_private_settlement_2026_10_21_r1_official_box_revisions" as const;
export const NBA_PROPS_SETTLEMENT_CATCHUP_MAX_DATES=3;
const MAX_TRACKED_SLATES=400;
const RETENTION_DAYS = 550;
type SlateReceipt=Readonly<{sourceVersion:string;rows:number}>;
async function readTrackingCatalog(client:SupabaseClient,season:number){
  const read=await client.from("lab_response_snapshots")
    .select("slate_date,generated_at,source_checksum:payload->>checksum")
    .like("snapshot_key",`nba::player-props-private-tracking::${season}::%`)
    .order("slate_date").limit(MAX_TRACKED_SLATES+1);
  if(read.error)throw new Error(`NBA props tracking catalog failed: ${read.error.message}`);
  const catalog=(read.data??[]).map(r=>({date:String(r.slate_date??""),sourceVersion:String(r.source_checksum??r.generated_at??"")}));
  planNbaPropsSettlementCatchup({requested:[],catalog,receipts:{}});
  return catalog;
}

export async function hasNbaPropsUnsettledTrackedSlates(client:SupabaseClient,season:number):Promise<boolean>{
  const previous=await readSettlement(client,season);
  const catalog=await readTrackingCatalog(client,season);
  return catalog.some(r=>previous?.slateReceipts?.[r.date]?.sourceVersion!==r.sourceVersion);
}

export function planNbaPropsSettlementCatchup(args:{requested:readonly string[];catalog:readonly {date:string;sourceVersion:string}[];receipts:Readonly<Record<string,SlateReceipt>>}):string[]{
  if(args.catalog.length>MAX_TRACKED_SLATES||args.requested.length>14)throw new Error("NBA props settlement date bound exceeded");
  if(new Set(args.catalog.map(r=>r.date)).size!==args.catalog.length||args.catalog.some(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!r.sourceVersion))throw new Error("Invalid NBA props tracking catalog");
  const requested=new Set(args.requested);
  return args.catalog.filter(r=>!requested.has(r.date)&&args.receipts[r.date]?.sourceVersion!==r.sourceVersion)
    .map(r=>r.date).sort().slice(0,NBA_PROPS_SETTLEMENT_CATCHUP_MAX_DATES);
}

export type NbaPlayerPropsSettlementRevision = Readonly<{
  rowKey: string;
  revision: number;
  actual: number | null;
  result: "win" | "loss" | "push" | "void";
  unitReturn: number;
  officialObservedAt: string;
}>;

export type NbaPlayerPropsSettlementHistory = Readonly<{
  release: typeof NBA_PLAYER_PROPS_SETTLEMENT_RELEASE | typeof LEGACY_SETTLEMENT_RELEASE;
  publicEnabled: false;
  season: number;
  createdAt: string;
  updatedAt: string;
  revisions: readonly NbaPlayerPropsSettlementRevision[];
  slateReceipts?:Readonly<Record<string,SlateReceipt>>;
}>;

export function buildNbaPlayerPropsSettlementRevision(args: {
  row: NbaPlayerPropsPrivateTrackingRow;
  box: NbaPlayerPropsCurrentState["boxes"][number] | null;
  prior: NbaPlayerPropsSettlementRevision | null;
  observedAt: string;
}): Readonly<{
  status: "added" | "corrected" | "preserved";
  revision: NbaPlayerPropsSettlementRevision;
}> {
  const actual = !args.box || args.box.minutes <= 0 ? null : actualForMarket(args.row.market, args.box);
  const result = actual === null ? "void" : actual === args.row.line ? "push"
    : (args.row.side === "over" ? actual > args.row.line : actual < args.row.line) ? "win" : "loss";
  const unitReturn = result === "win"
    ? (args.row.americanPrice > 0 ? args.row.americanPrice / 100 : 100 / -args.row.americanPrice)
    : result === "loss" ? -1 : 0;
  const revision: NbaPlayerPropsSettlementRevision = {
    rowKey: args.row.rowKey,
    revision: (args.prior?.revision ?? 0) + 1,
    actual,
    result,
    unitReturn,
    officialObservedAt: args.observedAt,
  };
  if (args.prior && args.prior.actual === actual && args.prior.result === result) {
    return { status: "preserved", revision: args.prior };
  }
  return { status: args.prior ? "corrected" : "added", revision };
}

export function nbaPlayerPropsSettlementKey(season: number): string {
  return `nba::player-props-private-settlement::${season}`;
}

export async function settleNbaPlayerPropsTrackedSlates(args: {
  client: SupabaseClient;
  season: number;
  slateDates: readonly string[];
  state: NbaPlayerPropsCurrentState;
  observedAt: string;
}): Promise<{ written: boolean; added: number; corrected: number; preserved: number; total: number; catchupDates:readonly string[] }> {
  const previous = await readSettlement(args.client, args.season);
  const catalog=await readTrackingCatalog(args.client,args.season);
  const receipts={...previous?.slateReceipts};
  const catchupDates=planNbaPropsSettlementCatchup({requested:args.slateDates,catalog,receipts});
  const rows: NbaPlayerPropsPrivateTrackingRow[] = [];
  const loaded=new Map<string,readonly NbaPlayerPropsPrivateTrackingRow[]>();
  for (const slateDate of [...new Set([...args.slateDates,...catchupDates])]) {
    const history = await readNbaPlayerPropsPrivateTracking({ client: args.client, season: args.season, slateDate });
    rows.push(...(history?.rows ?? []));
    if(history)loaded.set(slateDate,history.rows);
  }
  const latestByRow = new Map<string, NbaPlayerPropsSettlementRevision>();
  for (const revision of previous?.revisions ?? []) {
    const prior = latestByRow.get(revision.rowKey);
    if (!prior || revision.revision > prior.revision) latestByRow.set(revision.rowKey, revision);
  }
  const gameIds = new Set(args.state.games.map((game) => game.gameId));
  const boxByGamePlayer = new Map(args.state.boxes.map((box) => [`${box.gameId}|${box.playerId}`, box]));
  const additions: NbaPlayerPropsSettlementRevision[] = [];
  let corrected = 0;
  let preserved = 0;
  for (const row of rows) {
    const gameId = Number(row.gameId.replace(/^.*:/, ""));
    const playerId = Number(row.playerId.replace(/^.*:/, ""));
    if (!gameIds.has(gameId)) continue;
    const box = boxByGamePlayer.get(`${gameId}|${playerId}`) ?? null;
    const prior = latestByRow.get(row.rowKey);
    const settlement = buildNbaPlayerPropsSettlementRevision({ row, box, prior: prior ?? null, observedAt: args.observedAt });
    if (settlement.status === "preserved") { preserved += 1; continue; }
    if (settlement.status === "corrected") corrected += 1;
    additions.push(settlement.revision);
  }
  for(const[date,tracked]of loaded){
    const source=catalog.find(r=>r.date===date);
    if(source&&tracked.every(row=>gameIds.has(Number(row.gameId.replace(/^.*:/,"")))))receipts[date]={sourceVersion:source.sourceVersion,rows:tracked.length};
  }
  if (additions.length === 0&&JSON.stringify(receipts)===JSON.stringify(previous?.slateReceipts??{})) return { written: false, added: 0, corrected, preserved, total: previous?.revisions.length ?? 0,catchupDates };
  const history: NbaPlayerPropsSettlementHistory = {
    release: NBA_PLAYER_PROPS_SETTLEMENT_RELEASE,
    publicEnabled: false,
    season: args.season,
    createdAt: previous?.createdAt ?? args.observedAt,
    updatedAt: args.observedAt,
    revisions: [...(previous?.revisions ?? []), ...additions],
    slateReceipts:receipts,
  };
  const payload = encodeNbaPlayerPropsPrivatePayload(history, "tracking_history");
  const retention = new Date(Date.parse(args.observedAt) + RETENTION_DAYS * 86_400_000).toISOString();
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: nbaPlayerPropsSettlementKey(args.season),
    kind: "tracking",
    sport: "nba",
    slate_date: null,
    payload,
    payload_version: NBA_PLAYER_PROPS_SETTLEMENT_RELEASE,
    source: NBA_PLAYER_PROPS_SETTLEMENT_RELEASE,
    generated_at: args.observedAt,
    expires_at: retention,
    stale_until: retention,
    updated_at: args.observedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NBA props settlement write failed: ${error.message}`);
  return { written: true, added: additions.length, corrected, preserved, total: history.revisions.length,catchupDates };
}

async function readSettlement(client: SupabaseClient, season: number): Promise<NbaPlayerPropsSettlementHistory | null> {
  const { data, error } = await client.from("lab_response_snapshots")
    .select("payload").eq("snapshot_key", nbaPlayerPropsSettlementKey(season)).maybeSingle();
  if (error) throw new Error(`NBA props settlement read failed: ${error.message}`);
  const history = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsSettlementHistory>(data?.payload, "tracking_history");
  if (!history) return null;
  if (![NBA_PLAYER_PROPS_SETTLEMENT_RELEASE,LEGACY_SETTLEMENT_RELEASE].includes(history.release) || history.publicEnabled !== false || history.season !== season) {
    throw new Error("NBA props settlement payload is corrupt or unsupported.");
  }
  return history;
}

function actualForMarket(market: string, box: NbaPlayerPropsCurrentState["boxes"][number]): number {
  const rebounds = box.oreb + box.dreb;
  if (market === "points") return box.points;
  if (market === "rebounds") return rebounds;
  if (market === "assists") return box.ast;
  if (market === "threes") return box.fg3m;
  if (market === "points_rebounds_assists") return box.points + rebounds + box.ast;
  if (market === "points_rebounds") return box.points + rebounds;
  if (market === "points_assists") return box.points + box.ast;
  if (market === "rebounds_assists") return rebounds + box.ast;
  throw new Error(`NBA props settlement does not support ${market}.`);
}
