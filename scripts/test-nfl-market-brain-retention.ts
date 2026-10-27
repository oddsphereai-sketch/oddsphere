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

  const sharedRoute = readFileSync("app/api/cron/cleanup-stream-tables/route.ts", "utf8");
  assert.doesNotMatch(sharedRoute, /MarketBrain|market_brain/,
    "feature-off production cleanup must remain byte-for-byte independent of research retention");
  const route = readFileSync("app/api/cron/nfl-market-brain-retention/route.ts", "utf8");
  assert.match(route, /await purgeExpiredNflMarketBrainResearch/);
  assert.doesNotMatch(route, /NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED|NFL_MARKET_BRAIN_SHADOW_CANARY_APPROVED/,
    "retention must be independent of future capture activation");
  assert.match(route, /rawInputsDeleted/);
  assert.match(route, /raw_parser_inputs: 30/);
  const auth = readFileSync("lib/cron/auth.ts", "utf8");
  assert.match(auth,
    /"\/api\/cron\/nfl-market-brain-retention"[\s\S]*NFL_MARKET_BRAIN_RETENTION_CRON_ENABLED[\s\S]*defaultEnabled: false/);
  const schedule = readFileSync("vercel.json", "utf8");
  assert.doesNotMatch(schedule, /nfl-market-brain-retention/,
    "research retention must not be scheduled before operator approval");

  const migration = readFileSync("lib/db/schema-migration-v46-nfl-market-brain-proof-boundary.sql", "utf8");
  assert.match(migration, /raw_inputs_deleted integer/);
  assert.match(migration, /raw_input_bytes_remaining bigint/);
  assert.match(migration, /GET DIAGNOSTICS deleted_raw_inputs = ROW_COUNT/);

  console.log("NFL Market Brain retention independence, deletion counts, cap telemetry, and purge bounds passed.");
}

void main();
