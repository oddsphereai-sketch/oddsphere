import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { purgeExpiredNflMarketBrainResearch } from
  "../lib/services/football/nflMarketBrainShadowStore";

async function main() {
  let rpcCalls = 0;
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls += 1;
      assert.equal(name, "purge_expired_nfl_market_brain_research");
      assert.deepEqual(args, { p_limit: 5_000 });
      return Promise.resolve({ data: [{
        shadows_deleted: 5_000,
        artifacts_deleted: 2,
        raw_inputs_deleted: 3,
        shadow_bytes_remaining: 101,
        artifact_bytes_remaining: 202,
        raw_input_bytes_remaining: 303,
      }], error: null });
    },
  };
  const result = await purgeExpiredNflMarketBrainResearch({ client: client as never });
  assert.deepEqual(result, {
    shadowsDeleted: 5_000,
    artifactsDeleted: 2,
    rawInputsDeleted: 3,
    shadowBytesRemaining: 101,
    artifactBytesRemaining: 202,
    rawInputBytesRemaining: 303,
    capped: { shadows: true, artifacts: false, rawInputs: false },
  });
  assert.equal(rpcCalls, 1);
  await assert.rejects(
    () => purgeExpiredNflMarketBrainResearch({ client: client as never, limit: 10_001 }),
    /integer between 1 and 10000/,
  );
  assert.equal(rpcCalls, 1, "an invalid limit must fail before issuing an RPC");

  const route = readFileSync("app/api/cron/cleanup-stream-tables/route.ts", "utf8");
  assert.match(route, /nfl_market_brain_research = await purgeExpiredNflMarketBrainResearch/);
  assert.doesNotMatch(route, /NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED|NFL_MARKET_BRAIN_SHADOW_CANARY_APPROVED/,
    "retention must run whether future capture is enabled or disabled");
  assert.match(route, /nflMarketBrainPurgeError/);
  assert.match(route, /rawInputsDeleted/);
  assert.match(route, /nfl_market_brain_raw_parser_input_days: 30/);

  const migration = readFileSync("lib/db/schema-migration-v46-nfl-market-brain-proof-boundary.sql", "utf8");
  assert.match(migration, /raw_inputs_deleted integer/);
  assert.match(migration, /raw_input_bytes_remaining bigint/);
  assert.match(migration, /GET DIAGNOSTICS deleted_raw_inputs = ROW_COUNT/);

  console.log("NFL Market Brain retention independence, deletion counts, cap telemetry, and purge bounds passed.");
}

void main();
