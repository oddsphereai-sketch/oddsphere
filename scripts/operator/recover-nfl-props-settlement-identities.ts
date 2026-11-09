/** Owner-reviewed historical outcome recovery; never edits a locked identity or payload.
 * Dry run: --audit=/private/tmp/recovery.json
 * Apply only after owner approval: --apply --audit=... --approved-sha=<printed digest>
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { supabase } from "../../lib/db/supabase";
import { acquireCronJobLease, releaseCronJobLease } from "../../lib/cron/leases";
import { NFL_PLAYER_PROPS_SETTLEMENT_RELEASE, settleNflPlayerPropsRecords, type NflPropsSettlementProposal } from "../../lib/services/football/nflPlayerPropsSettlement";
import { nflPlayerPropsSettlementNameKey, nflPlayerPropsSettlementTeamKey } from "../../lib/services/football/nflPlayerPropsSettlementIdentity";

type Row = Record<string, unknown>;
export type ReviewedDnpSource = { id:number;gameId:string;playerId:string;playerName:string;team:string;sourceUrl:string;sourcePath:string;sourceSha256:string;reviewedPage:number;providerConflict:boolean };
type Audit = { kind: "nfl_props_settlement_identity_recovery_v3"; settlementRelease: typeof NFL_PLAYER_PROPS_SETTLEMENT_RELEASE; createdAt: string; readOnly: true;
  proposals: NflPropsSettlementProposal[]; unmatchedRecordIds: number[]; protectedHashes: Record<string, string>;reviewedDnpSources:ReviewedDnpSource[] };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const protectedHash = (row: Row) => digest(JSON.stringify(Object.fromEntries(Object.entries(row)
  .filter(([key]) => !["result", "actual_value", "settled_at", "updated_at"].includes(key)).sort(([a], [b]) => a.localeCompare(b)))));
const flag = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Human-reviewed league evidence is never a recurring provider override.
 * Its exact bytes/record binding are included in the audit the owner approves. */
export function reviewedDnpProposal(row:Row,source:ReviewedDnpSource):NflPropsSettlementProposal {
  const url=new URL(source.sourceUrl);
  if(row.id!==source.id||String(row.provider_game_id)!==source.gameId||row.provider_player_id!==source.playerId
    ||nflPlayerPropsSettlementNameKey(String(row.player_name))!==nflPlayerPropsSettlementNameKey(source.playerName)
    ||nflPlayerPropsSettlementTeamKey(String(row.team))!==nflPlayerPropsSettlementTeamKey(source.team)
    ||url.protocol!=="https:"||url.hostname!=="static.www.nfl.com"||!url.pathname.endsWith(".pdf")
    ||!(resolve(source.sourcePath).startsWith("/private/tmp/")||resolve(source.sourcePath).startsWith(resolve(tmpdir())+sep))||!Number.isSafeInteger(source.reviewedPage)||source.reviewedPage<1
    ||typeof source.providerConflict!=="boolean")throw Error("Reviewed DNP source does not bind the exact locked record");
  const bytes=readFileSync(source.sourcePath);
  if(bytes.subarray(0,5).toString()!=="%PDF-"||createHash("sha256").update(bytes).digest("hex")!==source.sourceSha256)throw Error("Reviewed DNP league document changed; re-audit required");
  return{id:source.id,gameId:source.gameId,resolvedPlayerId:source.playerId,actual:null,result:"void"};
}

async function loadRows(ids?: number[]): Promise<Row[]> {
  let query = supabase.from("nfl_player_prop_records").select("*").order("id").limit(1_000);
  query = ids ? query.in("id", ids) : query.eq("result", "pending").is("provider_player_id", null);
  const { data, error } = await query;
  if (error) throw new Error(`Recovery read failed: ${error.message}`);
  if (data.length >= 1_000) throw new Error("Recovery cohort reached its audit bound.");
  return data as Row[];
}

async function run(rows: Row[], apply: boolean, onProposal: (proposal: NflPropsSettlementProposal) => void) {
  const gameIds = [...new Set(rows.map(row => String(row.provider_game_id)))];
  const outcomes = [];
  for (let index = 0; index < gameIds.length; index += 18) {
    const games = new Set(gameIds.slice(index, index + 18));
    const ids = rows.filter(row => games.has(String(row.provider_game_id))).map(row => Number(row.id));
    outcomes.push(await settleNflPlayerPropsRecords({ client: supabase, apiKey: process.env.BALLDONTLIE_API_KEY!,
      now: new Date().toISOString(), recoverMissingIdentityRecordIds: ids, apply, onProposal }));
  }
  return outcomes;
}

async function main() {
  const auditPath = flag("audit");
  if (!auditPath || !process.env.BALLDONTLIE_API_KEY) throw new Error("--audit and configured provider credentials are required.");
  const apply = process.argv.includes("--apply");
  if (!apply) {
    const selected = flag("record-ids");
    const ids = selected?.split(",").map(Number);
    if (ids && (ids.length > 1_000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)) throw new Error("Invalid bounded recovery record IDs.");
    const rows = await loadRows(ids);
    if (ids && (rows.length !== ids.length || rows.some(row => row.result !== "pending"))) throw new Error("Selected recovery cohort is incomplete or no longer pending.");
    const proposals: NflPropsSettlementProposal[] = [];
    const outcomes = await run(rows, false, proposal => proposals.push(proposal));
    const sourcePath=flag("reviewed-dnp-sources");
    const reviewedDnpSources:ReviewedDnpSource[]=sourcePath?JSON.parse(readFileSync(sourcePath,"utf8")):[];
    if(!Array.isArray(reviewedDnpSources)||reviewedDnpSources.length>10||new Set(reviewedDnpSources.map(s=>s.id)).size!==reviewedDnpSources.length)throw Error("Invalid bounded reviewed DNP sources");
    for(const source of reviewedDnpSources){const row=rows.find(r=>r.id===source.id);if(!row)throw Error("Reviewed DNP record is outside the pending cohort");const manual=reviewedDnpProposal(row,source),found=proposals.find(p=>p.id===source.id);if(found&&JSON.stringify(found)!==JSON.stringify(manual))throw Error("Provider outcome conflicts with reviewed DNP; owner review required");if(!found)proposals.push(manual);}
    const matched = new Set(proposals.map(proposal => proposal.id));
    const audit: Audit = { kind: "nfl_props_settlement_identity_recovery_v3", settlementRelease: NFL_PLAYER_PROPS_SETTLEMENT_RELEASE, createdAt: new Date().toISOString(), readOnly: true,reviewedDnpSources,
      proposals, unmatchedRecordIds: rows.filter(row => !matched.has(Number(row.id))).map(row => Number(row.id)),
      protectedHashes: Object.fromEntries(rows.map(row => [String(row.id), protectedHash(row)])) };
    const json = `${JSON.stringify(audit, null, 2)}\n`;
    writeFileSync(auditPath, json, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ readOnly: true, proposals: proposals.length, unresolved: audit.unmatchedRecordIds.length,
      apiCalls: outcomes.reduce((sum, result) => sum + result.apiCalls, 0), auditPath, sha256: digest(json) }));
    return;
  }
  const json = readFileSync(auditPath, "utf8");
  if (!flag("approved-sha") || digest(json) !== flag("approved-sha")) throw new Error("Owner-reviewed audit digest is required and must match exactly.");
  const audit = JSON.parse(json) as Audit;
  if (audit.kind !== "nfl_props_settlement_identity_recovery_v3" || audit.settlementRelease !== NFL_PLAYER_PROPS_SETTLEMENT_RELEASE || audit.readOnly !== true
    || !Array.isArray(audit.proposals) || audit.proposals.length === 0 || audit.proposals.length > 1_000) throw new Error("Invalid approved audit.");
  const approved = new Map(audit.proposals.map(proposal => [proposal.id, proposal]));
  if (approved.size !== audit.proposals.length) throw new Error("Duplicate approved record.");
  const runId = randomUUID();
  const lease = await acquireCronJobLease({ jobName: "prediction_pipeline:nfl", runId, leaseSeconds: 480 });
  if (lease.mode !== "acquired") throw new Error(`Recovery cannot proceed: ${lease.mode}`);
  try {
    const rows = await loadRows([...approved.keys()]);
    if (rows.length !== approved.size) throw new Error("Approved cohort changed or is incomplete.");
    for (const row of rows) if (protectedHash(row) !== audit.protectedHashes[String(row.id)]) {
      throw new Error(`Locked evidence changed for ${row.id}; obtain a fresh audit before continuing.`);
    }
    for(const row of rows){const expected=approved.get(Number(row.id))!;if(row.result!=='pending'
      &&(row.result!==expected.result||(expected.actual===null?row.actual_value!==null:Number(row.actual_value)!==expected.actual)))throw Error('An existing settled outcome differs from the approved audit; re-audit required');}
    const manual=new Map<number,NflPropsSettlementProposal>();
    if(!Array.isArray(audit.reviewedDnpSources)||audit.reviewedDnpSources.length>10)throw Error("Invalid reviewed DNP evidence inventory");
    for(const source of audit.reviewedDnpSources){const row=rows.find(r=>r.id===source.id);if(!row||manual.has(source.id))throw Error("Invalid reviewed DNP record");const proposal=reviewedDnpProposal(row,source);if(JSON.stringify(proposal)!==JSON.stringify(approved.get(source.id)))throw Error("Reviewed DNP differs from owner-approved outcome");manual.set(source.id,proposal);}
    const proposals: NflPropsSettlementProposal[] = [];
    const outcomes = await run(rows.filter(row => row.result === "pending"), true, proposal => {
      const expected = approved.get(proposal.id);
      if (JSON.stringify(proposal) !== JSON.stringify(expected)) throw new Error(`Official outcome/identity changed for ${proposal.id}; re-audit required.`);
      proposals.push(proposal);
    });
    for(const row of rows.filter(row=>row.result==='pending'&&manual.has(Number(row.id))&&!proposals.some(p=>p.id===row.id))){
      const proposal=manual.get(Number(row.id))!;
      const {error}=await supabase.from('nfl_player_prop_records').update({result:'void',actual_value:null,settled_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',row.id).eq('result','pending');
      if(error)throw Error(`Reviewed DNP outcome write failed: ${error.message}`);proposals.push(proposal);
    }
    const after = await loadRows([...approved.keys()]);
    if (after.some(row => protectedHash(row) !== audit.protectedHashes[String(row.id)])) throw new Error("Protected locked fields changed during recovery.");
    if (after.some(row => {
      const expected = approved.get(Number(row.id))!;
      return row.result !== expected.result || (expected.actual === null ? row.actual_value !== null : Number(row.actual_value) !== expected.actual);
    })) throw new Error("A recovered outcome differs from the approved official result.");
    const resultPath = `${auditPath}.applied-${runId}.json`;
    writeFileSync(resultPath, `${JSON.stringify({ at: new Date().toISOString(), approvedAuditSha256: digest(json),
      proposals, outcomes, protectedLockedFieldsUnchanged: true,
      remainingPending: after.filter(row => row.result === "pending").map(row => row.id) }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ settled: outcomes.reduce((sum, result) => sum + result.settled, 0), resultPath,
      protectedLockedFieldsUnchanged: true }));
  } finally { await releaseCronJobLease({ jobName: "prediction_pipeline:nfl", runId }); }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
