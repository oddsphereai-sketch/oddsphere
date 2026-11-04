/** Owner-reviewed historical outcome recovery; never edits a locked identity or payload.
 * Dry run: --audit=/private/tmp/recovery.json
 * Apply only after owner approval: --apply --audit=... --approved-sha=<printed digest>
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { supabase } from "../../lib/db/supabase";
import { acquireCronJobLease, releaseCronJobLease } from "../../lib/cron/leases";
import { NFL_PLAYER_PROPS_SETTLEMENT_RELEASE, settleNflPlayerPropsRecords, type NflPropsSettlementProposal } from "../../lib/services/football/nflPlayerPropsSettlement";

type Row = Record<string, unknown>;
type Audit = { kind: "nfl_props_settlement_identity_recovery_v2"; settlementRelease: typeof NFL_PLAYER_PROPS_SETTLEMENT_RELEASE; createdAt: string; readOnly: true;
  proposals: NflPropsSettlementProposal[]; unmatchedRecordIds: number[]; protectedHashes: Record<string, string> };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const protectedHash = (row: Row) => digest(JSON.stringify(Object.fromEntries(Object.entries(row)
  .filter(([key]) => !["result", "actual_value", "settled_at", "updated_at"].includes(key)).sort(([a], [b]) => a.localeCompare(b)))));
const flag = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

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
    const matched = new Set(proposals.map(proposal => proposal.id));
    const audit: Audit = { kind: "nfl_props_settlement_identity_recovery_v2", settlementRelease: NFL_PLAYER_PROPS_SETTLEMENT_RELEASE, createdAt: new Date().toISOString(), readOnly: true,
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
  if (audit.kind !== "nfl_props_settlement_identity_recovery_v2" || audit.settlementRelease !== NFL_PLAYER_PROPS_SETTLEMENT_RELEASE || audit.readOnly !== true
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
    const proposals: NflPropsSettlementProposal[] = [];
    const outcomes = await run(rows.filter(row => row.result === "pending"), true, proposal => {
      const expected = approved.get(proposal.id);
      if (JSON.stringify(proposal) !== JSON.stringify(expected)) throw new Error(`Official outcome/identity changed for ${proposal.id}; re-audit required.`);
      proposals.push(proposal);
    });
    const after = await loadRows([...approved.keys()]);
    if (after.some(row => protectedHash(row) !== audit.protectedHashes[String(row.id)])) throw new Error("Protected locked fields changed during recovery.");
    if (after.some(row => {
      const expected = approved.get(Number(row.id))!;
      return row.result !== expected.result || Number(row.actual_value) !== expected.actual;
    })) throw new Error("A recovered outcome differs from the approved official result.");
    const resultPath = `${auditPath}.applied-${runId}.json`;
    writeFileSync(resultPath, `${JSON.stringify({ at: new Date().toISOString(), approvedAuditSha256: digest(json),
      proposals, outcomes, protectedLockedFieldsUnchanged: true,
      remainingPending: after.filter(row => row.result === "pending").map(row => row.id) }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ settled: outcomes.reduce((sum, result) => sum + result.settled, 0), resultPath,
      protectedLockedFieldsUnchanged: true }));
  } finally { await releaseCronJobLease({ jobName: "prediction_pipeline:nfl", runId }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
